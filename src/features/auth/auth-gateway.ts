import type { AuthError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buildAuthCallbackUrl,
  clearAuthFlow,
  ContinuationHttpError,
  ContinuationResponseLostError,
  createAuthFlow,
  listUnexpiredAuthFlows,
  readAuthFlow,
  sanitizeReturnPath,
  createContinuationApi,
  type ContinuationApi,
} from "./auth-flow";
import {
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
} from "./auth-continuation-completion";
import {
  isAuthContinuationExchangeInFlightOwner,
  releaseAuthContinuationCallbackPreLease,
  releaseAuthContinuationExchangeInFlight,
  startAuthContinuationCallbackPreLease,
  startAuthContinuationExchangeInFlightHeartbeat,
  tryAcquireAuthContinuationExchangeInFlight,
} from "./auth-continuation-recovery";
import { getPublicEnv, type PublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import { IMMEDIATE_CLAIM_TIMEOUT_MS, withTimeout } from "./async-timeout";

/** 互換 re-export（正本は async-timeout.ts） */
export { IMMEDIATE_CLAIM_TIMEOUT_MS };

/**
 * C1/C2: deposit 1 試行の hang 上限（claim 即時経路と同窓）。
 * never-settle でも completeCallback が settle し、secret を hangWatchdog 前に awaiting へ渡せる。
 */
const DEPOSIT_ATTEMPT_TIMEOUT_MS = IMMEDIATE_CLAIM_TIMEOUT_MS;
/** C1: code を閉包に保持したまま 429/5xx/transport/timeout を再試行する回数（初回含む）。 */
const DEPOSIT_MAX_ATTEMPTS = 3;
/** 試行間 backoff（ms）。attempt index に対応（0 は初回で未使用）。 */
const DEPOSIT_BACKOFF_MS = [0, 1_000, 2_000] as const;

type DepositOutcome = "ok" | "timeout" | "transient" | "terminal";

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "timeout";
}

function isRetryableDepositError(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof ContinuationHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * C1/C2: deposit を timeout 付きで再試行する。
 * code は呼び出し側閉包に残り、URL strip 後も budget 内は再 deposit できる。
 * - ok: 204 相当
 * - timeout: 最終試行が hang（late 204 の可能性 → 同一ブラウザは secret 保持で awaiting）
 * - transient: 最終が 429/5xx/TypeError（budget 尽きたら terminal）
 * - terminal: 非リトライ 4xx 等
 */
async function depositWithRetry(depositOnce: () => Promise<void>): Promise<DepositOutcome> {
  let last: DepositOutcome = "transient";
  for (let attempt = 0; attempt < DEPOSIT_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // as const タプルの固定添字は number に絞れる（noUncheckedIndexedAccess でも）
      const backoffMs = attempt === 1 ? DEPOSIT_BACKOFF_MS[1] : DEPOSIT_BACKOFF_MS[2];
      await sleepMs(backoffMs);
    }
    try {
      await withTimeout(depositOnce(), DEPOSIT_ATTEMPT_TIMEOUT_MS);
      return "ok";
    } catch (error) {
      if (!isRetryableDepositError(error)) {
        return "terminal";
      }
      last = isTimeoutError(error) ? "timeout" : "transient";
    }
  }
  return last;
}

/**
 * completeCallback が受け付けるクエリキー。
 * OAuth 標準 + アプリ flow 束縛 + Supabase OTP の error_code（期限切れ判定）。
 * access_token / refresh_token 等の未知キーは unbound_callback（C7）。
 */
const COMPLETE_CALLBACK_ALLOWED_QUERY_KEYS = new Set([
  "flow",
  "state",
  "code",
  "error",
  "error_description",
  "error_uri",
  "error_code",
]);

export type SentMagicLink = {
  flowId: string;
  email: string;
  resendAvailableAt: string;
};

export type AuthCallbackResult =
  | {
      kind: "complete";
      continuation: "same_browser";
      returnTo: string;
      flowId: string;
    }
  | { kind: "deposited"; continuation: "original_browser"; flowId: string; returnTo: string }
  | { kind: "awaiting_completion"; flowId: string; returnTo: string }
  | { kind: "expired"; flowId: string; returnTo: string }
  | {
      kind: "error";
      code: "oauth_cancelled" | "auth_callback_failed" | "unbound_callback";
      returnTo: string;
      /** C4: recovery onResult が当該 flow だけを焼けるよう任意で載せる */
      flowId?: string;
    };

/**
 * C-R3 / C-R5: 同一 flow の in-flight resume をプロセス内で単一化する。
 * createAuthGateway ごとだと callback ページと AuthProvider が別 Map を持ち、
 * 同一タブ／同一プロセスでも dual exchange が再成立し得るためモジュール共有にする。
 * （タブ横断は storage の callback pre-lease + AUTH-R2 が担う。）
 *
 * withTimeout は元 Promise を cancel しない。先着 Promise に join し、
 * C3 冪等 re-claim は settle 後の再呼び出しで従来どおり。C4 hang 中 secret 保持も維持。
 *
 * C11: soft TTL で Map エントリを外し、外側 withTimeout 後に後続が新規 run を立てられる。
 * 旧 run は放置（cancel 不能）。exchange lease は R2/R3 が dual exchange を抑止する。
 */
type InflightResumeEntry = {
  generation: number;
  promise: Promise<AuthCallbackResult>;
};
const inflightResumeByFlowId = new Map<string, InflightResumeEntry>();
let inflightResumeGeneration = 0;
/** Map 保持の soft TTL。IMMEDIATE_CLAIM_TIMEOUT と同値（外側 withTimeout と揃える）。 */
const INFLIGHT_RESUME_MAP_TTL_MS = IMMEDIATE_CLAIM_TIMEOUT_MS;

/** テスト専用: never-settle resume が Map に残ったあとの隔離用。本番コードからは呼ばない。 */
export function resetInflightResumeForTests(): void {
  inflightResumeByFlowId.clear();
}

export interface AuthGateway {
  signInWithGoogle(returnTo: string): Promise<void>;
  sendMagicLink(email: string, returnTo: string): Promise<SentMagicLink>;
  completeCallback(url: URL): Promise<AuthCallbackResult>;
  resumeFlow(flowId: string): Promise<AuthCallbackResult>;
}

export type AuthGatewayDeps = {
  getPublicEnv(): Pick<PublicEnv, "authContinuationTtlMs" | "authProviderMode" | "oauthMockOrigin">;
  fetchImpl: typeof fetch;
  appOrigin: string;
  navigate(url: string): void;
};
const browserAuthGatewayDeps: AuthGatewayDeps = {
  getPublicEnv,
  fetchImpl: (...args) => fetch(...args),
  appOrigin: window.location.origin,
  navigate: (url) => {
    window.location.assign(url);
  },
};
const localCredentialsSchema = z
  .object({
    email: z.email(),
    password: z.string().min(16),
  })
  .strict();

function isExpired(error: AuthError | null, url: URL): boolean {
  const code = error?.code ?? url.searchParams.get("error_code");
  return code === "otp_expired" || code === "otp_disabled" || code === "token_expired";
}

function replaceExistingAuthFlows(storage: Storage): void {
  for (const flow of listUnexpiredAuthFlows(storage, new Date())) {
    clearAuthFlow(flow.id, storage);
  }
}

export function createAuthGateway(
  providedClient?: BrowserSupabaseClient,
  continuationApi: ContinuationApi = createContinuationApi(),
  storage: Storage = window.localStorage,
  deps: AuthGatewayDeps = browserAuthGatewayDeps,
): AuthGateway {
  const client = providedClient ?? getBrowserSupabaseClient();
  // completeCallback から同一オブジェクトの resumeFlow を呼ぶため、先に束縛する。
  const gateway: AuthGateway = {
    async signInWithGoogle(returnTo) {
      replaceExistingAuthFlows(storage);
      const provider = deps.getPublicEnv();
      const flow = await createAuthFlow(
        returnTo,
        continuationApi,
        storage,
        undefined,
        provider.authProviderMode,
      );
      try {
        const redirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
        if (provider.authProviderMode === "oauth_mock") {
          if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
            throw new Error("invalid mock origin");
          }
          const authorize = new URL("/authorize", provider.oauthMockOrigin);
          authorize.searchParams.set(
            "redirect_uri",
            new URL("/auth/callback", deps.appOrigin).href,
          );
          authorize.searchParams.set("flow", flow.id);
          authorize.searchParams.set("state", flow.state);
          deps.navigate(authorize.href);
          return;
        }
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error !== null) {
          throw new Error("Googleログインを開始できませんでした");
        }
      } catch {
        clearAuthFlow(flow.id, storage);
        throw new Error("Googleログインを開始できませんでした");
      }
    },

    async sendMagicLink(email, returnTo) {
      replaceExistingAuthFlows(storage);
      const flow = await createAuthFlow(returnTo, continuationApi, storage);
      const emailRedirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
      try {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo, shouldCreateUser: true },
        });
        if (error !== null) throw new Error("magic link failed");
      } catch {
        clearAuthFlow(flow.id, storage);
        throw new Error("ログイン用メールを送信できませんでした");
      }
      return {
        flowId: flow.id,
        email,
        resendAvailableAt: new Date(
          Date.now() + getPublicEnv().magicLinkResendSeconds * 1_000,
        ).toISOString(),
      };
    },

    async completeCallback(url) {
      if (url.hash !== "") return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      // C7: 許可クエリ以外（access_token 等）は fail-closed
      for (const key of url.searchParams.keys()) {
        if (!COMPLETE_CALLBACK_ALLOWED_QUERY_KEYS.has(key)) {
          return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
        }
      }
      const flowId = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const stored = flowId === null ? null : readAuthFlow(flowId, storage);
      const returnTo = sanitizeReturnPath(stored?.returnTo);
      // C1: code+state があるときは spoofable な URL error_code より deposit を優先する。
      // 攻撃者が有効な code に error_code=otp_expired を足しても short-circuit で捨てない。
      const hasCodeAndState = state !== null && code !== null;
      if (!hasCodeAndState && isExpired(null, url)) {
        // C1: ローカル flow があるときは provider-error と同様に state 照合してから expired を受理。
        // flow UUID だけで error_code を付けた未束縛 URL は unbound（秘密を焼かない）。
        // AuthCallbackPage は kind=expired で clear するため、ここで state 束縛しないと DoS になる。
        if (stored !== null && state !== stored.state) {
          return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
        }
        return { kind: "expired", flowId: flowId ?? "", returnTo };
      }
      // code+state がある場合は error クエリがあっても deposit へ進む（上の C1 と同趣旨）。
      if (!hasCodeAndState) {
        const providerError = url.searchParams.get("error");
        if (providerError !== null) {
          if (stored !== null && state !== stored.state) {
            return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
          }
          if (flowId !== null) clearAuthFlow(flowId, storage);
          return {
            kind: "error",
            code: providerError === "access_denied" ? "oauth_cancelled" : "auth_callback_failed",
            returnTo,
          };
        }
      }
      if (flowId === null) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // AUTH-R1: strip 後のリロードでは code/state が消える。同ブラウザに未失効 secret があれば
      // deposit 済み想定で claim/recovery を再開し、clearAuthFlow で秘密を焼かない。
      if (state === null || code === null) {
        if (stored !== null) {
          return {
            kind: "awaiting_completion",
            flowId,
            returnTo,
          };
        }
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // U1-M3: ローカル flow があるときは URL state と一致してから deposit する。
      // 不一致のまま deposit すると後続 claim が binding 不一致で空になる。
      if (stored !== null && state !== stored.state) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // クロスブラウザ（secret 無し）: deposit のみ。pre-lease は立てない（元タブ global を塞がない）。
      // C2: 匿名 deposit は未 claim なら last-wins（毒 first-wins を正当 WebView が覆せる）。
      // R1 residual-intentional: 正当 deposit 後の後着毒も last-wins で上書きし得る（可用性 DoS、
      // アカウント奪取ではない）。first-wins に戻すと C2 が再発するため維持。deposit API は
      // code 形式を厳格化して明らかなゴミを弾くが、形式を通る毒は閉じない。
      // C1: 429/5xx/transport は code 閉包保持のまま backoff 再試行。budget 後のみ terminal。
      if (stored === null) {
        const depositOutcome = await depositWithRetry(() =>
          continuationApi.deposit(flowId, { state, code }),
        );
        if (depositOutcome === "ok") {
          return {
            kind: "deposited",
            continuation: "original_browser",
            flowId,
            returnTo: "/planner",
          };
        }
        // secret 無し。late 204 は元ブラウザの claim に委ね、WebView 側は unbound で再ログイン案内。
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // 同一ブラウザ: deposit 直後に即 claim/exchange する。
      // iOS 等で recovery の 5s poll / タイマー抑制に依存すると「確認中」が長く見える。
      // 一時失敗・timeout は awaiting を返し、AuthCallbackPage の recovery + TTL がフォールバックする。
      // claim 後 exchange が hang しても resumeFlow 側が complete 時に completion を publish する（C4）。
      // C-R5: target recovery lease 前の pre-lease 窓で他タブ global が orphan claim → dual
      // exchange しないよう、deposit 前から pre-lease を heartbeat する。
      const stopPreLease = startAuthContinuationCallbackPreLease(flowId, storage);
      // C3: awaiting 手渡し時は heartbeat を止めず、lease TTL 切れの orphan 誤認窓を閉じる。
      let keepPreLeaseHeartbeat = false;
      try {
        // C1/C2: deposit は timeout+backoff 再試行。URL strip 後も code は本閉包に残る。
        // 同一ブラウザは secret 付きで毒 last-wins を上書きできる（owner overwrite）。
        const depositOutcome = await depositWithRetry(() =>
          continuationApi.deposit(flowId, {
            state,
            code,
            secret: stored.secret,
          }),
        );
        if (depositOutcome !== "ok") {
          // C2: hang/timeout の late 204 を救うため secret を残し awaiting へ（recovery が claim）。
          // C1: 確定的 transient 尽きた場合は terminal（code 再 deposit 不能・claim も 404）。
          if (depositOutcome === "timeout") {
            keepPreLeaseHeartbeat = true;
            return {
              kind: "awaiting_completion",
              flowId,
              returnTo,
            };
          }
          releaseAuthContinuationCallbackPreLease(flowId, storage);
          return { kind: "error", code: "unbound_callback", returnTo };
        }
        try {
          const result = await withTimeout(gateway.resumeFlow(flowId), IMMEDIATE_CLAIM_TIMEOUT_MS);
          // awaiting は target recovery へ手渡しするため pre-lease を残す（TTL+recovery が引き継ぐ）。
          if (result.kind === "awaiting_completion") {
            keepPreLeaseHeartbeat = true;
          } else {
            releaseAuthContinuationCallbackPreLease(flowId, storage);
          }
          return result;
        } catch {
          // withTimeout は "timeout" Error のみ reject。下層 resumeFlow は kind で返す。
          // hang 中も pre-lease heartbeat を残し、他タブ dual exchange を抑止する（C3）。
          keepPreLeaseHeartbeat = true;
          return {
            kind: "awaiting_completion",
            flowId,
            returnTo,
          };
        }
      } finally {
        if (!keepPreLeaseHeartbeat) stopPreLease();
      }
    },

    async resumeFlow(flowId) {
      const existing = inflightResumeByFlowId.get(flowId);
      if (existing !== undefined) {
        return existing.promise;
      }
      // C11: generation で Map 除去を世代一致に限定（soft TTL / settle の競合でも後続を壊さない）
      const generation = (inflightResumeGeneration += 1);
      const runPromise = runResumeFlow(flowId);
      const entry: InflightResumeEntry = {
        generation,
        promise: runPromise.finally(() => {
          const current = inflightResumeByFlowId.get(flowId);
          if (current?.generation === generation) {
            inflightResumeByFlowId.delete(flowId);
          }
        }),
      };
      inflightResumeByFlowId.set(flowId, entry);
      // soft TTL: withTimeout 後も Map に hang Promise が残り続けるのを防ぐ。
      // 旧 run は cancel しない。lease 保持中なら後続は acquire 失敗で awaiting に倒れる。
      const softTtlTimer = setTimeout(() => {
        const current = inflightResumeByFlowId.get(flowId);
        if (current?.generation === generation) {
          inflightResumeByFlowId.delete(flowId);
        }
      }, INFLIGHT_RESUME_MAP_TTL_MS);
      void runPromise.finally(() => {
        clearTimeout(softTtlTimer);
      });
      return entry.promise;
    },
  };

  async function runResumeFlow(flowId: string): Promise<AuthCallbackResult> {
    const flow = readAuthFlow(flowId, storage);
    if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
    // exchange 失敗（provider 拒否）だけ terminal。claim 成功後も secret は exchange 成功まで残す（C3/C4）。
    let exchangeStarted = false;
    // C3/R2: タブ横断 dual exchange 抑止用。claim 成功後に acquire（locks + 確認遅延）し、
    // 完了/terminal で解放する。R3: 生存中は heartbeat で TTL を延長する。
    const exchangeInstanceId = `exchange-${flow.id}-${Math.random().toString(36).slice(2, 10)}`;
    let holdsExchangeLease = false;
    let stopExchangeHeartbeat: (() => void) | undefined;
    try {
      const claimedCode = await continuationApi.claim(flow.id, {
        secret: flow.secret,
        state: flow.state,
      });
      // C3/C4: claim はサーバ側で冪等再提示。secret は exchange 成功後に破棄し、
      // body 欠落や exchange hang でも recovery が再 claim → 再 exchange できる。
      // R2: Web Locks + write/re-read/確認遅延。失敗時は他タブ exchange 中とみなし待たせる。
      if (
        !(await tryAcquireAuthContinuationExchangeInFlight(
          flow.id,
          exchangeInstanceId,
          storage,
          Date.now(),
        ))
      ) {
        // 他タブが exchange 中。secret を残し、completion / 次周期に委ねる。
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      holdsExchangeLease = true;
      // R3: exchange hang 中も lease を延命。JS 死亡時は timer 停止 → TTL 失効で他タブ回復。
      stopExchangeHeartbeat = startAuthContinuationExchangeInFlightHeartbeat(
        flow.id,
        exchangeInstanceId,
        storage,
      );
      // R2: acquire 成功後も exchange 開始直前に owner 再確認（遅延後の後着 write を検出）
      if (
        !isAuthContinuationExchangeInFlightOwner(flow.id, exchangeInstanceId, storage, Date.now())
      ) {
        stopExchangeHeartbeat();
        stopExchangeHeartbeat = undefined;
        // 他 owner のキーは release しない（holds を外して finally の自 owner 解放もスキップ）
        holdsExchangeLease = false;
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      exchangeStarted = true;
      const result =
        flow.sessionExchange === "oauth_mock"
          ? await (async () => {
              const provider = deps.getPublicEnv();
              if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
                throw new Error("invalid mock origin");
              }
              const response = await deps.fetchImpl(`${provider.oauthMockOrigin}/exchange`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: claimedCode.code }),
              });
              if (!response.ok) throw new Error("mock exchange failed");
              return client.auth.signInWithPassword(
                localCredentialsSchema.parse(await response.json()),
              );
            })()
          : client.auth.exchangeCodeForSession(claimedCode.code);
      const { error } = await result;
      if (error !== null) throw new Error("provider exchange failed");
      // F-AUTH-002: claim 成功の returnTo も再 sanitize（create 経路の防御を二重化）
      const safeReturnTo = sanitizeReturnPath(claimedCode.returnTo);
      // C1 / C10: secret 消去は publishAuthContinuationCompletion（setItem 成功後の clear）に一本化。
      // 先に clearClaimed すると setItem 失敗時に他タブ re-claim 不能・completion 未公開でスタックする。
      // C4: withTimeout で結果が discard されても storage 経由で recovery/listener が拾えるよう公開。
      // gateway に注入された storage と同じ領域へ書き、テストの MapStorage とも一致させる。
      try {
        publishAuthContinuationCompletion({ flowId: flow.id, returnTo: safeReturnTo }, storage);
      } catch {
        // setItem 失敗時 publish は clear しない → secret 残存（他タブ re-claim / ページ側再 publish 可）。
        // セッションは既に確立済みなので outer catch の terminal clear に落とさず complete を返す。
        // （throw を外へ出すと exchangeStarted 分岐が secret を焼いて C1 が再発する。）
      }
      return {
        kind: "complete",
        continuation: "same_browser",
        returnTo: safeReturnTo,
        flowId: flow.id,
      };
    } catch (error) {
      // provider exchange が明示失敗したときだけ terminal（hang/timeout は下層で kind 返却しない）
      const isRetryableTransport =
        error instanceof ContinuationHttpError ||
        error instanceof ContinuationResponseLostError ||
        error instanceof TypeError;
      if (exchangeStarted && !isRetryableTransport) {
        // C5: bg throttle で lease が切れ dual exchange した loser でも、
        // 他タブが既に session/completion を確立していれば fail-closed で UX を壊さない。
        const existingCompletion = readAuthContinuationCompletion(flow.id, storage);
        if (existingCompletion !== null) {
          // 完了済みなら secret は不要（publish 済みの clear をここで揃える）
          clearAuthFlow(flow.id, storage);
          return {
            kind: "complete",
            continuation: "same_browser",
            returnTo: existingCompletion.returnTo,
            flowId: flow.id,
          };
        }
        try {
          const sessionResult = await client.auth.getSession();
          if (sessionResult.data.session !== null) {
            const safeReturnTo = sanitizeReturnPath(flow.returnTo);
            try {
              publishAuthContinuationCompletion(
                { flowId: flow.id, returnTo: safeReturnTo },
                storage,
              );
            } catch {
              // setItem 失敗でも session は確立済み。complete を返し terminal clear を避ける。
            }
            return {
              kind: "complete",
              continuation: "same_browser",
              returnTo: safeReturnTo,
              flowId: flow.id,
            };
          }
        } catch {
          // getSession 失敗時は従来どおり terminal へ（曖昧な成功扱いをしない）
        }
        // mock/provider の失敗 Error。"timeout" は withTimeout 側で resumeFlow の外。
        clearAuthFlow(flow.id, storage);
        return {
          kind: "error",
          code: "unbound_callback",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // B-I4: 404（未 deposit / 競合待ち）・429・5xx・ネットワークはリトライ可能。
      // フローと secret を残し、待機タブを /login へ落とさない。
      // 410（decrypt 失敗）は terminal unbound。
      if (error instanceof ContinuationHttpError) {
        if (error.status === 404) {
          return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
        }
        if (error.status === 429 || error.status >= 500) {
          return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
        }
        // 410 ほか非リトライ 4xx: secret を消し recovery の poll を止める
        clearAuthFlow(flow.id, storage);
        return {
          kind: "error",
          code: "unbound_callback",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // C3/C7: 2xx body 欠落・Zod parse 失敗は冪等 re-claim で回復。secret を残して awaiting。
      if (error instanceof ContinuationResponseLostError) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      if (error instanceof TypeError) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      clearAuthFlow(flow.id, storage);
      return {
        kind: "error",
        code: "unbound_callback",
        returnTo: flow.returnTo,
        flowId: flow.id,
      };
    } finally {
      // settle 時のみ解放。exchange hang 中は Promise が終わらないので heartbeat+lease が残り、
      // 他タブ dual exchange を抑止する（C3/R3）。JS 死亡時は heartbeat 停止後 TTL で失効。
      if (holdsExchangeLease) {
        stopExchangeHeartbeat?.();
        releaseAuthContinuationExchangeInFlight(flowId, storage, exchangeInstanceId);
      }
    }
  }

  return gateway;
}
