import type { AuthError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buildAuthCallbackUrl,
  clearAuthFlow,
  clearClaimedAuthFlow,
  ContinuationHttpError,
  ContinuationResponseLostError,
  createAuthFlow,
  listUnexpiredAuthFlows,
  readAuthFlow,
  sanitizeReturnPath,
  createContinuationApi,
  type ContinuationApi,
} from "./auth-flow";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import { getPublicEnv, type PublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import { IMMEDIATE_CLAIM_TIMEOUT_MS, withTimeout } from "./async-timeout";

/** 互換 re-export（正本は async-timeout.ts） */
export { IMMEDIATE_CLAIM_TIMEOUT_MS };

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
      if (isExpired(null, url)) return { kind: "expired", flowId: flowId ?? "", returnTo };
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
      try {
        // C2: 同一ブラウザは secret を付けて毒 first-wins を上書きできるようにする
        await continuationApi.deposit(
          flowId,
          stored === null ? { state, code } : { state, code, secret: stored.secret },
        );
      } catch {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      if (stored === null) {
        return {
          kind: "deposited",
          continuation: "original_browser",
          flowId,
          returnTo: "/planner",
        };
      }
      // 同一ブラウザ: deposit 直後に即 claim/exchange する。
      // iOS 等で recovery の 5s poll / タイマー抑制に依存すると「確認中」が長く見える。
      // 一時失敗・timeout は awaiting を返し、AuthCallbackPage の recovery + TTL がフォールバックする。
      // claim 後 exchange が hang しても resumeFlow 側が complete 時に completion を publish する（C4）。
      try {
        return await withTimeout(gateway.resumeFlow(flowId), IMMEDIATE_CLAIM_TIMEOUT_MS);
      } catch {
        // withTimeout は "timeout" Error のみ reject。下層 resumeFlow は kind で返す。
        return {
          kind: "awaiting_completion",
          flowId,
          returnTo,
        };
      }
    },

    async resumeFlow(flowId) {
      const flow = readAuthFlow(flowId, storage);
      if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      // exchange 失敗（provider 拒否）だけ terminal。claim 成功後も secret は exchange 成功まで残す（C3/C4）。
      let exchangeStarted = false;
      try {
        const claimedCode = await continuationApi.claim(flow.id, {
          secret: flow.secret,
          state: flow.state,
        });
        // C3/C4: claim はサーバ側で冪等再提示。secret は exchange 成功後に破棄し、
        // body 欠落や exchange hang でも recovery が再 claim → 再 exchange できる。
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
        // exchange 成功後に secret を破棄（所有証跡は clearClaimed で整理）
        clearClaimedAuthFlow(flow.id, storage);
        // F-AUTH-002: claim 成功の returnTo も再 sanitize（create 経路の防御を二重化）
        const safeReturnTo = sanitizeReturnPath(claimedCode.returnTo);
        // C4: withTimeout で結果が discard されても storage 経由で recovery/listener が拾えるよう公開。
        // gateway に注入された storage と同じ領域へ書き、テストの MapStorage とも一致させる。
        try {
          publishAuthContinuationCompletion({ flowId: flow.id, returnTo: safeReturnTo }, storage);
        } catch {
          // localStorage 障害は complete 結果自体を妨げない
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
        // C3: 2xx body 欠落は冪等 re-claim で回復。secret を残して awaiting。
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
      }
    },
  };
  return gateway;
}
