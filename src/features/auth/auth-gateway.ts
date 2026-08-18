import type { AuthError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  adjustedAuthNowMs,
  browserSupabaseSessionStorageKey,
  buildAuthCallbackUrl,
  clearAuthFlow,
  clearBrowserSupabaseSessionStorage,
  clearPendingAuthDeposit,
  ContinuationHttpError,
  ContinuationResponseLostError,
  clearAuthFlowUserDismissed,
  createAuthFlow,
  isAuthFlowUserDismissed,
  markAuthFlowUserDismissed,
  readAuthFlow,
  readPendingAuthDeposit,
  sanitizeLoginReturnPath,
  sanitizeReturnPath,
  writePendingAuthDeposit,
  createContinuationApi,
  type AuthFlow,
  type ContinuationApi,
} from "./auth-flow";
import {
  clearAuthContinuationCompletion,
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
} from "./auth-continuation-completion";
import {
  isAuthContinuationExchangeInFlight,
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
import { EMAIL_OTP_SEND_FAILED } from "./email-otp-copy";
import {
  armIntentionalAuthSessionSwitch,
  clearIntentionalAuthSessionSwitch,
  liveAuthSessionMarkAppearedOrUpdated,
  liveAuthSessionMarkProtectsFingerprint,
  readLiveAuthSessionMark,
  writeLiveAuthSessionMark,
  type LiveAuthSessionMark,
} from "./live-auth-session-mark";
import { normalizeOtpDigits } from "./otp-digit-field";

/** 互換 re-export（正本は async-timeout.ts） */
export { IMMEDIATE_CLAIM_TIMEOUT_MS };

/**
 * C-R1 / C6: discard 後の getSession 指紋取り。AuthProvider の
 * COLD_START_GET_SESSION_TIMEOUT_MS と同値。auth-gateway は AuthProvider を
 * import できない（循環）ため、ここに同値を置く。緩めない。
 */
const GET_SESSION_PROBE_TIMEOUT_MS = 5_000;

/**
 * C1/C2: deposit 1 試行の hang 上限（claim 即時経路と同窓）。
 * never-settle でも completeCallback が settle し、secret を hangWatchdog 前に awaiting へ渡せる。
 */
const DEPOSIT_ATTEMPT_TIMEOUT_MS = IMMEDIATE_CLAIM_TIMEOUT_MS;
/**
 * C1/C3: code を閉包（および同一ブラウザ pending cache）に保持したまま
 * 429/5xx/transport/timeout を再試行する回数（初回含む）。
 * completeCallback 内 budget 後も resume が pending から再 deposit する。
 */
const DEPOSIT_MAX_ATTEMPTS = 3;
/** 試行間 backoff（ms）。attempt index に対応（0 は初回で未使用）。 */
const DEPOSIT_BACKOFF_MS = [0, 1_000, 2_000] as const;
/**
 * RR2: depositWithRetry の最悪壁時計（3×timeout + backoff 1s+2s）。
 * soft TTL / recovery 再入がこの窓より短いとゾンビ re-deposit と第二 run が並走する。
 */
const DEPOSIT_RETRY_WALL_MS =
  DEPOSIT_MAX_ATTEMPTS * DEPOSIT_ATTEMPT_TIMEOUT_MS + DEPOSIT_BACKOFF_MS[1] + DEPOSIT_BACKOFF_MS[2];
/**
 * C4: dual exchange loser の getSession 遅延を待つ短い再検査。
 * 他タブが session 確立済みなら secret を焼かず complete に収束する。
 */
const EXCHANGE_LOSER_SESSION_PROBE_ATTEMPTS = 3;
const EXCHANGE_LOSER_SESSION_PROBE_GAP_MS = 200;

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
  // token_hash magic: メールはアプリへ直着地（GET /verify を踏まない）。type は email / magiclink
  "token_hash",
  "type",
  "error",
  "error_description",
  "error_uri",
  "error_code",
]);

/**
 * GoTrue の PKCE エラー redirect が fragment に載せ得るキー（prepErrorRedirectURL）。
 * query 側と同型の error_* / message のみ。session 材料は含めない。
 */
const COMPLETE_CALLBACK_ALLOWED_HASH_KEYS = new Set([
  "error",
  "error_description",
  "error_uri",
  "error_code",
  "message",
  // GoTrue v2.189.0 prepErrorRedirectURL / prepRedirectURL が常に hq.Set("sb", "") する
  // （Supabase Auth 識別子）。未許可だと otp_expired 等が unbound に誤写される。
  "sb",
]);

/** fragment にあれば即 fail-closed する implicit grant 系（C7）。 */
const COMPLETE_CALLBACK_REJECT_HASH_KEYS = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "token_type",
  "expires_in",
  "expires_at",
]);

/**
 * C7 / iOS magic-link:
 * - access_token 等の implicit fragment は従来どおり unbound（取り込まない）。
 * - GoTrue PKCE の失敗 redirect は query と fragment の両方に error_* を載せる
 *   （prepErrorRedirectURL）。旧実装は hash 非空だけで unbound にし、
 *   otp_expired / 再利用を「確認できませんでした」に誤写していた。
 * - Gmail リンク保護が /verify を先に踏むとトークン消費 → ユーザー開封時は
 *   error+hash 付き redirect になりやすく、本分岐が必須。
 */
function isRejectedAuthCallbackHash(hash: string): boolean {
  if (hash === "" || hash === "#") return false;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return true;
  }
  for (const key of params.keys()) {
    if (COMPLETE_CALLBACK_REJECT_HASH_KEYS.has(key)) return true;
    if (!COMPLETE_CALLBACK_ALLOWED_HASH_KEYS.has(key)) return true;
  }
  return false;
}

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
  /**
   * token_hash magic: ページ表示だけでは OTP を消費しない。
   * iOS 長押しプレビュー / Gmail 安全確認の GET では verify せず、ユーザー操作後に confirmMagicLink。
   */
  | {
      kind: "needs_confirmation";
      flowId: string;
      returnTo: string;
      tokenHash: string;
      /** URL の type。verifyOtp へは email に正規化する */
      otpType: "email" | "magiclink";
      state: string | null;
    }
  | {
      kind: "error";
      code: "oauth_cancelled" | "auth_callback_failed" | "unbound_callback";
      returnTo: string;
      /** C4: recovery onResult が当該 flow だけを焼けるよう任意で載せる */
      flowId?: string;
    };

export type ConfirmMagicLinkInput = {
  flowId: string;
  tokenHash: string;
  otpType: "email" | "magiclink";
  state: string | null;
};

/**
 * resumeFlow / recovery が返す結果。needs_confirmation は completeCallback 専用
 * （ユーザー操作待ちであり claim ポーリングでは出ない）。
 */
export type AuthResumeResult = Exclude<AuthCallbackResult, { kind: "needs_confirmation" }>;

/**
 * C-R3 / C-R5: 同一 flow の in-flight resume をプロセス内で単一化する。
 * createAuthGateway ごとだと callback ページと AuthProvider が別 Map を持ち、
 * 同一タブ／同一プロセスでも dual exchange が再成立し得るためモジュール共有にする。
 * （タブ横断は storage の callback pre-lease + AUTH-R2 が担う。）
 *
 * withTimeout は元 Promise を cancel しない。先着 Promise に join し、
 * C3 冪等 re-claim は settle 後の再呼び出しで従来どおり。C4 hang 中 secret 保持も維持。
 *
 * C11 / RR2: soft TTL で Map エントリを外し、外側 withTimeout 後に後続が新規 run を立てられる。
 * 旧 run は放置（cancel 不能）。exchange lease は R2/R3 が dual exchange を抑止する。
 * soft TTL は deposit 再試行最悪壁時計 + IMMEDIATE_CLAIM 窓に揃え、recovery 30s timeout 後の
 * 再入がゾンビ re-deposit と並走しないようにする（RR2）。
 */
type InflightResumeEntry = {
  generation: number;
  promise: Promise<AuthResumeResult>;
};
const inflightResumeByFlowId = new Map<string, InflightResumeEntry>();
let inflightResumeGeneration = 0;
/**
 * Map 保持の soft TTL。depositWithRetry 最悪壁 + claim/exchange 外側窓。
 * 旧 IMMEDIATE_CLAIM 単独だと re-deposit hang 中に Map が外れ dual deposit が起き得た（RR2）。
 */
export const INFLIGHT_RESUME_MAP_TTL_MS = DEPOSIT_RETRY_WALL_MS + IMMEDIATE_CLAIM_TIMEOUT_MS;
/**
 * RR2: 同一プロセスで flow 単位の re-deposit を直列化する。
 * soft TTL 経過後や Map 離脱後でも、先着の depositWithRetry が生きていれば第二 run は
 * re-deposit を重ねず claim のみ試す（deposit IP 予算の自己枯渇を抑止）。
 */
const redepositInFlightByFlowId = new Set<string>();

/**
 * C3: SDK 単一 PKCE キーへの並行 signInWithOAuth を直列化する。
 * BrowserSupabaseClient / AuthFlow は再定義せず、開始だけ待つ。
 * C-R1: Locks 非対応の別 browsing context は chain を共有しないため、
 * 注入 storage（本番は localStorage）でも同じ開始旗で待つ。
 */
const GOOGLE_START_LOCK_NAME = "kondate.auth.google-start";
const GOOGLE_START_STORAGE_LOCK_KEY = "kondate.auth.google-start.lock";
/**
 * 死亡タブが開始旗を残しても後着が入れる窓。continuation / origin TTL とは別。
 * signInWithOAuth の壁時計は短いが、hang 時に 30s 超えて二重開始しないよう claim 窓に揃える。
 */
const GOOGLE_START_STORAGE_LOCK_TTL_MS = IMMEDIATE_CLAIM_TIMEOUT_MS;
/** 他タブの setItem が見えるまでの確認遅延（exchange lease と同型）。 */
const GOOGLE_START_STORAGE_LOCK_CONFIRM_MS = 40;
const GOOGLE_START_STORAGE_LOCK_POLL_MS = 20;
let googleStartChain: Promise<void> = Promise.resolve();

type GoogleStartStorageLock = {
  ownerId: string;
  expiresAtMs: number;
};

const googleStartStorageLockSchema = z
  .object({
    ownerId: z.string().min(1),
    expiresAtMs: z.number(),
  })
  .strict();

function readGoogleStartStorageLock(storage: Storage): GoogleStartStorageLock | null {
  try {
    const raw = storage.getItem(GOOGLE_START_STORAGE_LOCK_KEY);
    if (raw === null) return null;
    const parsed = googleStartStorageLockSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeGoogleStartStorageLock(storage: Storage, lock: GoogleStartStorageLock): boolean {
  try {
    storage.setItem(GOOGLE_START_STORAGE_LOCK_KEY, JSON.stringify(lock));
    return true;
  } catch {
    return false;
  }
}

function releaseGoogleStartStorageLock(storage: Storage, ownerId: string): void {
  try {
    const current = readGoogleStartStorageLock(storage);
    if (current === null || current.ownerId !== ownerId) return;
    storage.removeItem(GOOGLE_START_STORAGE_LOCK_KEY);
  } catch {
    // best-effort。死亡タブは TTL で失効する
  }
}

function isGoogleStartStorageLockHeld(lock: GoogleStartStorageLock | null, nowMs: number): boolean {
  return lock !== null && lock.expiresAtMs > nowMs;
}

/**
 * C-R1: Web Locks が無い UA のタブ間排他。
 * write → 即 re-read → 確認遅延 → 再 re-read で双方 null 読取の dual owner を潰す。
 * 負けたら解放せず待ち、死亡タブは TTL 後に奪取する。
 */
async function withGoogleStartStorageLock<T>(storage: Storage, run: () => Promise<T>): Promise<T> {
  const ownerId = `google-start-${Math.random().toString(36).slice(2, 12)}`;
  for (;;) {
    const nowMs = Date.now();
    const existing = readGoogleStartStorageLock(storage);
    if (!isGoogleStartStorageLockHeld(existing, nowMs)) {
      const next: GoogleStartStorageLock = {
        ownerId,
        expiresAtMs: nowMs + GOOGLE_START_STORAGE_LOCK_TTL_MS,
      };
      if (!writeGoogleStartStorageLock(storage, next)) {
        // storage 不能なら PKCE も書けないので進行する
        return run();
      }
      if (readGoogleStartStorageLock(storage)?.ownerId === ownerId) {
        await sleepMs(GOOGLE_START_STORAGE_LOCK_CONFIRM_MS);
        if (readGoogleStartStorageLock(storage)?.ownerId === ownerId) {
          try {
            return await run();
          } finally {
            releaseGoogleStartStorageLock(storage, ownerId);
          }
        }
      }
    }
    await sleepMs(GOOGLE_START_STORAGE_LOCK_POLL_MS);
  }
}

async function withSerializedGoogleStart<T>(storage: Storage, run: () => Promise<T>): Promise<T> {
  const previous = googleStartChain;
  let releaseInProcess: () => void = () => undefined;
  googleStartChain = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  await previous.catch(() => undefined);
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks !== undefined && typeof locks.request === "function") {
      return await locks.request(GOOGLE_START_LOCK_NAME, run);
    }
    return await withGoogleStartStorageLock(storage, run);
  } finally {
    releaseInProcess();
  }
}

/** テスト専用: never-settle resume が Map に残ったあとの隔離用。本番コードからは呼ばない。 */
export function resetInflightResumeForTests(): void {
  inflightResumeByFlowId.clear();
  redepositInFlightByFlowId.clear();
  googleStartChain = Promise.resolve();
}

/**
 * テスト専用: soft TTL による Map 脱落だけを再現する（redeposit in-flight は残す）。
 * RR2 ガード検証用。本番コードからは呼ばない。
 */
export function dropInflightResumeMapForTests(): void {
  inflightResumeByFlowId.clear();
}

export interface AuthGateway {
  signInWithGoogle(returnTo: string): Promise<void>;
  sendMagicLink(email: string, returnTo: string): Promise<SentMagicLink>;
  /**
   * 同じタブの 6 桁メール番号。AuthFlow / Continuation / emailRedirectTo は付けない。
   */
  sendEmailOtp(email: string): Promise<{ email: string; resendAvailableAt: string }>;
  /**
   * ちょうど 6 桁だけ verifyOtp する。returnTo は返さない（画面が持つ）。
   */
  verifyEmailOtp(input: {
    email: string;
    token: string;
  }): Promise<{ kind: "complete" } | { kind: "mismatch" } | { kind: "unavailable" }>;
  completeCallback(url: URL): Promise<AuthCallbackResult>;
  /**
   * token_hash magic のユーザー確認後。verifyOtp(POST) で初めて OTP を消費する。
   * 同一ブラウザは session 確立、secret 無しは deposit のみ。
   */
  confirmMagicLink(input: ConfirmMagicLinkInput): Promise<AuthCallbackResult>;
  resumeFlow(flowId: string): Promise<AuthResumeResult>;
}

/** supabase-js: magiclink type は deprecated。email で magic / signup OTP を扱う。 */
function verifyOtpType(): "email" {
  return "email";
}

/**
 * C3: 後勝ち Google 開始で先行 OAuth（authorization_code）を明示キャンセルする。
 * PKCE verifier は SDK 単一キーのため、先行 flow を残すと先着 callback の exchange が
 * 上書き後の verifier で失敗し terminal になる。
 * C5: token_hash も dismiss する。Google 成功後の magic verify が勝者 session を上書きし、
 * absent-baseline の loser signOut で両方失う窓を閉じる。secret は残す（C6）。
 */
function dismissSiblingOauthAuthorizationFlows(currentFlowId: string, storage: Storage): void {
  // listUnexpiredAuthFlows は TTL 正規化で secret を消し得る。
  // 開始直後の sibling 列挙は read だけにし、今作った flow を巻き込まない。
  const prefix = "kondate.auth.flow.";
  const flowIds: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) === true) {
      flowIds.push(key.slice(prefix.length));
    }
  }
  for (const flowId of flowIds) {
    if (flowId === currentFlowId) continue;
    const existing = readAuthFlow(flowId, storage);
    if (existing === null) continue;
    markAuthFlowUserDismissed(existing.id, storage);
  }
}

/**
 * claim した平文を verifyOtp に渡すか PKCE code exchange に渡すか。
 * - token_hash フローの正規経路: 長い hash（ハイフン無し）
 * - 旧 / ローカル ConfirmationURL（GET /verify）: UUID 形の authorization code
 *   → credentialKind が token_hash でも exchangeCodeForSession する（移行・e2e 両立）
 */
function shouldExchangeClaimedAsTokenHash(
  credentialKind: AuthFlow["credentialKind"],
  claimed: string,
): boolean {
  if (credentialKind !== "token_hash") return false;
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(claimed);
  return !uuidLike;
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

/**
 * メール 6 桁確認の GoTrue code 写像。
 * 不正も期限切れも mismatch。未知は fail-closed で unavailable。サーバ文は出さない。
 */
function mapEmailOtpVerifyKind(code: string | undefined): "mismatch" | "unavailable" {
  if (code === "otp_expired" || code === "token_expired") return "mismatch";
  return "unavailable";
}

/**
 * C4/C1: exchange 直前の session 指紋。
 * - absent: 未ログイン
 * - present: 既に session あり（キーは userId:access_token）
 * - unknown: getSession 失敗 → session 経路では complete しない（completion bus のみ）
 *
 * C-R6: present 時は access/refresh を保持し、exchange 後 discard で pin 相当へ setSession 復元する。
 */
type SessionProbeBaseline =
  | { kind: "absent" }
  | { kind: "present"; key: string; accessToken: string; refreshToken: string }
  | { kind: "unknown" };

/** exchange / verify 成功結果から live 印用 userId を取る。無いときは undefined。 */
function userIdFromAuthResultData(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("session" in data)) return undefined;
  const session = data.session;
  if (typeof session !== "object" || session === null || !("user" in session)) return undefined;
  const user = session.user;
  if (typeof user !== "object" || user === null || !("id" in user)) return undefined;
  const userId = user.id;
  return typeof userId === "string" && userId !== "" ? userId : undefined;
}

/** loser probe 用。token 変化 or 新規出現だけ sibling 成功とみなす。 */
function sessionProbeKey(
  session: { access_token?: string; user?: { id?: string } } | null,
): string | null {
  if (session === null) return null;
  const token = session.access_token;
  if (typeof token !== "string" || token.length === 0) return null;
  const userId = session.user?.id;
  return `${typeof userId === "string" ? userId : ""}:${token}`;
}

async function captureSessionProbeBaseline(
  client: BrowserSupabaseClient,
): Promise<SessionProbeBaseline> {
  try {
    const sessionResult = await client.auth.getSession();
    const session = sessionResult.data.session;
    const key = sessionProbeKey(session);
    if (key === null || session === null) return { kind: "absent" };
    const accessToken = typeof session.access_token === "string" ? session.access_token : "";
    const refreshToken = typeof session.refresh_token === "string" ? session.refresh_token : "";
    return { kind: "present", key, accessToken, refreshToken };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * C5: 敗者 flow 以外に completion があれば、勝者 publish 済み。
 * loser の verify/exchange が勝者 session を上書きしたあと signOut すると両方失う。
 */
function hasSiblingAuthContinuationCompletion(loserFlowId: string, storage: Storage): boolean {
  const prefix = "kondate.auth.supabase.continuation-complete.";
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(prefix)) continue;
    const siblingFlowId = key.slice(prefix.length);
    if (siblingFlowId === "" || siblingFlowId === loserFlowId) continue;
    if (readAuthContinuationCompletion(siblingFlowId, storage) !== null) return true;
  }
  return false;
}

/**
 * C-R1: discard 直後の session 指紋。C6 / AuthProvider と同型 timeout。
 * hang / throw / session 無しは null（呼び出し側が sibling 無しなら local clear）。
 */
async function probeDiscardedExchangeSessionKey(
  client: BrowserSupabaseClient,
): Promise<string | null> {
  try {
    const postExchange = await withTimeout(client.auth.getSession(), GET_SESSION_PROBE_TIMEOUT_MS);
    return sessionProbeKey(postExchange.data.session);
  } catch {
    return null;
  }
}

/**
 * C1: 番号成功は continuation-complete を書かない。live 印（userId あり）または
 * 同一タブ 60s 番号印があれば、discard した Google が baseline 復元 / 無条件 signOut してはいけない。
 * Google commit の userId 無し印は OTP 勝者ではない（C-R6 の baseline 復元を残す）。
 */
function isEmailOtpSiblingWinner(
  liveMarkAtStart: LiveAuthSessionMark | null,
  storage: Storage,
): boolean {
  if (isFreshEmailOtpCompletedMark()) return true;
  const now = readLiveAuthSessionMark(storage);
  if (now === null || now.userId === undefined) return false;
  if (liveMarkAtStart === null) return true;
  if (now.userId !== liveMarkAtStart.userId) return true;
  return liveAuthSessionMarkAppearedOrUpdated(liveMarkAtStart, now);
}

type DiscardedExchangeClearContext = {
  loserFlowId: string;
  storage: Storage;
  awaitLocalSignOutSettle?: boolean;
  liveMarkAtStart?: LiveAuthSessionMark | null;
};

/**
 * C-R9: discard した exchange 自身の session が共有 storage に残っているときだけ local clear。
 * 現在 session が discarded fingerprint と一致するときのみ触る（別 token の勝者を壊さない）。
 * pin は AuthProvider 側のタブ local 権威。gateway は fingerprint 一致をその proxy とする。
 * C5: 勝者 completion があるときは signOut しない（上書き済み勝者を一緒に消さない）。
 * C1: 番号勝者印があるときも signOut しない（OTP は continuation-complete を書かない）。
 * C-R1: 指紋無し（timeout / throw / null）でも sibling が無い loser は local clear。
 * verify 成功後は persist に magic が書かれている。指紋待ちで掃除しないと pin が後勝ち Google を拒む。
 */
async function clearDiscardedExchangeSessionIfStillPresent(
  client: BrowserSupabaseClient,
  discardedExchangeSessionKey: string | null,
  context?: DiscardedExchangeClearContext,
): Promise<void> {
  if (
    context !== undefined &&
    (hasSiblingAuthContinuationCompletion(context.loserFlowId, context.storage) ||
      isEmailOtpSiblingWinner(context.liveMarkAtStart ?? null, context.storage))
  ) {
    return;
  }
  if (discardedExchangeSessionKey !== null) {
    try {
      const sessionResult = await withTimeout(
        client.auth.getSession(),
        GET_SESSION_PROBE_TIMEOUT_MS,
      );
      const currentKey = sessionProbeKey(sessionResult.data.session);
      // 既に無い、または別 session（勝者等）が載っている → 触らない
      if (currentKey === null || currentKey !== discardedExchangeSessionKey) return;
    } catch {
      // 指紋があるのに current を確認できないときは勝者を壊さない
      return;
    }
  } else if (context === undefined) {
    // 指紋も sibling 判定も無い → 従来どおり触らない
    return;
  }
  // local-only: 共有 session キー + client メモリ。global signOut はしない。
  if (typeof window !== "undefined") {
    try {
      clearBrowserSupabaseSessionStorage(window.localStorage);
    } catch {
      // best-effort
    }
    try {
      clearBrowserSupabaseSessionStorage(window.sessionStorage);
    } catch {
      // best-effort
    }
  }
  if (typeof client.auth.signOut === "function") {
    try {
      // hang でも discard 経路を永久待ちにしない（A2 と同型）
      // method call のまま呼び unbound-method を避ける
      const signOutPromise = client.auth.signOut({ scope: "local" });
      try {
        await withTimeout(signOutPromise, 2_000);
      } catch {
        if (context?.awaitLocalSignOutSettle === true) {
          // C-R3: 2s 数値は伸ばさず、timeout で掃除を終わらせ startGoogle を進める。
          // withTimeout は元 Promise を cancel しない。後着 _removeSession は
          // armLeftoverSignOutPkceProtection が新規 PKCE を戻す（C-R2）。
          const pkceStorage = typeof window !== "undefined" ? window.localStorage : context.storage;
          armLeftoverSignOutPkceProtection(signOutPromise, pkceStorage);
        }
      }
    } catch {
      // storage は上で消済み。メモリ clear 失敗は AuthProvider / 次回 getSession に委ねる
    }
  }
}

/** leftover 成功印。login-page と同キー。storedAt のみ。番号は載せない。 */
const EMAIL_OTP_COMPLETED_MARK_KEY = "kondate.auth.emailOtpCompleted";
/**
 * leftover 成功印の鮮度。login-page の MAGIC_RESIDUAL_TTL_MS と同値。
 * leftover が番号成功直後の session を leftover と誤認しないための短寿命印。
 */
const EMAIL_OTP_COMPLETED_MARK_TTL_MS = 60_000;

/**
 * leftover 成功印が 60s 以内か。login-page の reader は循環になるのでここへ複製する。
 * 期限切れ印は消さない（logout cleanup が正）。読めなければ fresh ではない。
 */
function isFreshEmailOtpCompletedMark(nowMs: number = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(EMAIL_OTP_COMPLETED_MARK_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (typeof storedAt !== "string") return false;
    const storedMs = Date.parse(storedAt);
    if (Number.isNaN(storedMs)) return false;
    return nowMs - storedMs <= EMAIL_OTP_COMPLETED_MARK_TTL_MS;
  } catch {
    return false;
  }
}

function wipeBrowserSupabasePersistOnly(): void {
  if (typeof window === "undefined") return;
  try {
    clearBrowserSupabaseSessionStorage(window.localStorage);
  } catch {
    // best-effort
  }
  try {
    clearBrowserSupabaseSessionStorage(window.sessionStorage);
  } catch {
    // best-effort
  }
}

/**
 * C-R4: leftover-capable Login が pin 前に leftover persist を落とす。
 * C6 hangWatchdog は persist を消さず leave するため、ここで local signOut しないと
 * leftover が live pin され後勝ち Google を拒む。
 * C5: 任意の勝者 completion があるときは触らない（loserFlowId 空 = 全 completion が sibling）。
 * C-R3: leftover 掃除は 2s で終わる（hang で startGoogle を永久待ちにしない）。
 * C-R2: timeout 後の後着 _removeSession は新規 PKCE verifier を消さない。
 *
 * C1: 指紋 null + context ありで clearDiscarded すると persist 無条件 wipe + signOut する。
 * leftover 専用経路は clearDiscarded を呼ばない（C-R9 の discarded-exchange 意味は変えない）。
 * 番号成功印・指紋変化では触らない。指紋が取れないときは persist だけ消し signOut しない。
 * C1/C3: origin 共有 live 印が指紋と一致すれば leftover ではない（60s/300s TTL 切れ後も守る）。
 * C2: afterWipe probe のあと印を再読する。probe 中の番号成功を後着 signOut しない。
 */
export async function clearLeftoverLoginSessionIfNoSiblingCompletion(
  client?: BrowserSupabaseClient,
  storage: Storage = window.localStorage,
): Promise<void> {
  try {
    const resolved = client ?? getBrowserSupabaseClient();
    const liveMarkAtStart = readLiveAuthSessionMark(storage);
    const shouldSpare = (sessionKey: string | null): boolean => {
      if (isFreshEmailOtpCompletedMark()) return true;
      return liveAuthSessionMarkProtectsFingerprint(sessionKey, storage);
    };
    if (isFreshEmailOtpCompletedMark()) return;

    const startKey = await probeDiscardedExchangeSessionKey(resolved);
    if (hasSiblingAuthContinuationCompletion("", storage)) return;
    if (shouldSpare(startKey)) return;

    const currentKey = await probeDiscardedExchangeSessionKey(resolved);
    if (shouldSpare(currentKey)) return;
    // 番号成功や勝者で session が現れた／変わった。触らない
    if (currentKey !== startKey) return;

    if (startKey === null) {
      // 指紋なしの signOut は後勝ち session を殺し得るので persist だけ消す
      // live 印がある probe miss は live persist の hang であり消さない（C1）
      if (readLiveAuthSessionMark(storage) !== null) return;
      wipeBrowserSupabasePersistOnly();
      return;
    }

    // 指紋一致 leftover。wipe 直前にも印・指紋を再確認する（C-R4 はここから signOut し得る）
    if (shouldSpare(startKey)) return;
    const beforeWipeKey = await probeDiscardedExchangeSessionKey(resolved);
    if (shouldSpare(beforeWipeKey)) return;
    if (beforeWipeKey !== startKey) return;

    wipeBrowserSupabasePersistOnly();

    // persist 掃除中に番号成功が載った／指紋が変わったならメモリ signOut しない
    if (shouldSpare(startKey)) return;
    const afterWipeKey = await probeDiscardedExchangeSessionKey(resolved);
    // C2: probe 後に印を再読する。in-flight leftover 指紋のままでも番号成功を殺さない
    if (isFreshEmailOtpCompletedMark()) return;
    const liveMarkAfterProbe = readLiveAuthSessionMark(storage);
    if (liveAuthSessionMarkAppearedOrUpdated(liveMarkAtStart, liveMarkAfterProbe)) return;
    if (shouldSpare(afterWipeKey)) return;
    if (afterWipeKey !== startKey) return;

    if (typeof resolved.auth.signOut === "function") {
      const pkceStorage = typeof window !== "undefined" ? window.localStorage : storage;
      const liveMarkAtSignOut = readLiveAuthSessionMark(pkceStorage);
      const signOutPromise = resolved.auth.signOut({ scope: "local" });
      // C3: timeout 前後を問わず後着 _removeSession から番号 persist を守る。wrap は発行前に武装。
      armLeftoverSignOutPkceProtection(signOutPromise, pkceStorage, liveMarkAtSignOut);
      try {
        await withTimeout(signOutPromise, 2_000);
      } catch {
        // C-R3: 2s で掃除を終わらせ startGoogle を進める。後着は PKCE / 番号 persist 保護。
      }
    }
  } catch {
    // leftover 掃除失敗でも Login は出す（C-R3）。pin は AuthProvider に残し得る。
  }
}

/**
 * C-R6 / C-R9 / C-R10: exchange 成功後に sibling clear で complete を discard するとき、
 * 置換済み client/storage session を baseline（exchange 前 = pin 相当）へ best-effort 復元する。
 *
 * - baseline present + token あり → setSession 復元（AuthProvider pin と協調）
 *   C-R10: setSession の `{ error }` も throw と同型の復元失敗として扱う
 * - absent / unknown / token 不足 / setSession 無し → C-R9:
 *   discarded exchange の session がまだ current なら local session clear
 *   （別 token の勝者 session は fingerprint 不一致で触らない）
 */
async function restoreSessionAfterDiscardedExchange(
  client: BrowserSupabaseClient,
  baseline: SessionProbeBaseline,
  discardedExchangeSessionKey: string | null = null,
  context?: DiscardedExchangeClearContext,
): Promise<void> {
  // C1: 番号勝者が書いた session を baseline leftover/live A で巻き戻さない。
  // sibling Google completion があるときは C-R6 どおり baseline 復元する。
  if (
    context !== undefined &&
    !hasSiblingAuthContinuationCompletion(context.loserFlowId, context.storage) &&
    isEmailOtpSiblingWinner(context.liveMarkAtStart ?? null, context.storage)
  ) {
    return;
  }
  if (
    baseline.kind === "present" &&
    baseline.accessToken.length > 0 &&
    baseline.refreshToken.length > 0 &&
    typeof client.auth.setSession === "function"
  ) {
    try {
      // method call のまま呼び unbound-method を避ける（this は client.auth）
      const result = await client.auth.setSession({
        access_token: baseline.accessToken,
        refresh_token: baseline.refreshToken,
      });
      // C-R10: SDK は throw せず error を返すことがある。AuthProvider pin 復元と同型に検査する
      if (result.error === null) {
        return;
      }
      // C-R12: restore 失敗後も fingerprint 一致なら loser clear（pin 復元は AuthProvider 側）
    } catch {
      // C-R12: throw 後も同様に clear へフォールスルー
    }
  }
  // C-R9 / C-R12: restore 不能・失敗で loser session が共有 storage に残るのを縮退
  await clearDiscardedExchangeSessionIfStillPresent(client, discardedExchangeSessionKey, context);
}

/**
 * C1: baseline と異なる session だけ dual-exchange sibling 成功とみなす。
 * 同一指紋 = 既ログインの pre-existing session → false complete しない。
 */
function isSessionChangedFromBaseline(
  baseline: SessionProbeBaseline,
  currentKey: string | null,
): boolean {
  if (currentKey === null) return false;
  if (baseline.kind === "unknown") return false;
  if (baseline.kind === "absent") return true;
  return baseline.key !== currentKey;
}

/**
 * C-R1: in-flight resume が sibling clear 後もメモリ secret で exchange しないための再確認。
 * R2 どおり claim/exchange 自体は abort 不可 → **結果適用直前**で discard する。
 * - 当該 flow の completion がある → discard せず complete へ（呼び出し側）
 * - flow 行が storage に無い → sibling clear / 外部 clear 済み → discard
 */
function isInFlightResumeDiscardedByStorage(flowId: string, storage: Storage): boolean {
  if (readAuthContinuationCompletion(flowId, storage) !== null) return false;
  return readAuthFlow(flowId, storage) === null;
}

/**
 * C-R2: in-flight の dismiss 再検査。sibling clear（flow 行欠如）とは別で、
 * 後勝ち Google が secret を残したまま dismiss したときに exchange しない。
 * completion があるときは既存 discard と同じく complete 側へ委ねる。
 */
function isInFlightResumeDismissed(flowId: string, storage: Storage): boolean {
  if (readAuthContinuationCompletion(flowId, storage) !== null) return false;
  return isAuthFlowUserDismissed(flowId, storage);
}

/**
 * C-R2-1: SDK 単一 PKCE キー（createBrowserSupabaseClient の storageKey + "-code-verifier"）。
 * signInWithOAuth は dismiss より先に V2 を書く。失敗時に V1 を戻し、
 * in-flight exchange は generation 変化を dismiss 無しの non-terminal 条件にする。
 * generation に TTL は無い（上書き試行の世代カウンタ。BrowserSupabaseClient は再定義しない）。
 * C-R2-3: 失敗復元は自分の bump 世代が残っているときだけ（自 V2）。並行成功の V3 は消さない。
 */
const PKCE_CODE_VERIFIER_KEY = `${browserSupabaseSessionStorageKey}-code-verifier`;
const PKCE_VERIFIER_GENERATION_KEY = `${PKCE_CODE_VERIFIER_KEY}-generation`;

function readPkceCodeVerifier(storage: Storage): string | null {
  try {
    return storage.getItem(PKCE_CODE_VERIFIER_KEY);
  } catch {
    return null;
  }
}

function restorePkceCodeVerifier(storage: Storage, value: string | null): void {
  try {
    if (value === null) {
      storage.removeItem(PKCE_CODE_VERIFIER_KEY);
    } else {
      storage.setItem(PKCE_CODE_VERIFIER_KEY, value);
    }
  } catch {
    // best-effort。storage 障害でも Google 開始失敗の throw は止めない
  }
}

/**
 * leftover local signOut が 2s timeout 後に後着 _removeSession するとき、
 * その後に書かれた PKCE verifier を消させない（C-R2）。掃除自体は 2s で終える（C-R3）。
 * C-R4: signInWithOAuth は verifier を先に setItem し generatePKCEChallenge を await する。
 * protect はそのあとなので、書込時点で控えを取らないと後着 settle が空のままガードを消す。
 */
type LeftoverPkceGuard = {
  storage: Storage;
  protectedValue: string | null;
  /** leftover signOut 中に番号が書いた persist。後着 _removeSession のあと戻す（C3） */
  protectedSessionValue: string | null;
  liveMarkAtArm: LiveAuthSessionMark | null;
  /**
   * C-R1: callback の unmarked leftover 拒否で武装した leftover token。
   * 控え persist が別 token（Google B）なら OTP 印なしでも戻す。
   */
  leftoverAccessTokenAtArm: string | null;
  /**
   * C-R5: leftover 拒否武装時の leftover user。回転 A2 は token が違うが同一 user。
   * persist が武装前に消えていても呼び出し側から渡す。
   */
  leftoverUserIdAtArm: string | null;
};

function readPersistAccessTokenFromRaw(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("access_token" in parsed)) {
      return null;
    }
    const token = parsed.access_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function readPersistUserIdFromRaw(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("user" in parsed)) {
      return null;
    }
    const user = parsed.user;
    if (typeof user !== "object" || user === null || !("id" in user)) {
      return null;
    }
    const userId = user.id;
    return typeof userId === "string" && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

/** leftover 拒否武装時に persist がまだ leftover なら userId を拾う。wipe 済みなら null。 */
function readLeftoverPersistUserIdAtArm(
  storage: Storage,
  leftoverAccessToken: string,
): string | null {
  try {
    const raw = storage.getItem(browserSupabaseSessionStorageKey);
    if (raw === null || raw === "") return null;
    if (readPersistAccessTokenFromRaw(raw) !== leftoverAccessToken) return null;
    return readPersistUserIdFromRaw(raw);
  } catch {
    return null;
  }
}

const leftoverPkceGuards = new Set<LeftoverPkceGuard>();

/** storage インスタンスの setItem 差し戻し。never-settle leftover でも reset で外す。 */
const leftoverPkceSetItemRestores = new Map<Storage, () => void>();
/** jsdom localStorage はインスタンス代入を無視し得るので prototype も見る。 */
let leftoverPkceProtoSetItemRestore: (() => void) | null = null;

function restoreLeftoverProtectedPkce(guard: LeftoverPkceGuard): void {
  if (
    guard.protectedValue !== null &&
    readPkceCodeVerifier(guard.storage) !== guard.protectedValue
  ) {
    restorePkceCodeVerifier(guard.storage, guard.protectedValue);
  }
}

function restoreLeftoverProtectedWinnerSession(guard: LeftoverPkceGuard): void {
  if (guard.protectedSessionValue === null) return;
  const capturedToken = readPersistAccessTokenFromRaw(guard.protectedSessionValue);
  const capturedUserId = readPersistUserIdFromRaw(guard.protectedSessionValue);
  // C-R1: leftover 拒否後に書いた Google persist は OTP 印を待たず戻す
  // C-R5: leftover user の回転 A2 は token が違っても勝者にしない
  const leftoverRefuseWinner =
    guard.leftoverAccessTokenAtArm !== null &&
    capturedToken !== null &&
    capturedToken !== guard.leftoverAccessTokenAtArm &&
    (guard.leftoverUserIdAtArm === null ||
      capturedUserId === null ||
      capturedUserId !== guard.leftoverUserIdAtArm);
  const shouldRestore =
    leftoverRefuseWinner ||
    isFreshEmailOtpCompletedMark() ||
    liveAuthSessionMarkAppearedOrUpdated(
      guard.liveMarkAtArm,
      readLiveAuthSessionMark(guard.storage),
    );
  if (!shouldRestore) return;
  try {
    if (guard.storage.getItem(browserSupabaseSessionStorageKey) !== guard.protectedSessionValue) {
      guard.storage.setItem(browserSupabaseSessionStorageKey, guard.protectedSessionValue);
    }
  } catch {
    // best-effort。storage 障害でも leftover 掃除の完了は止めない
  }
}

function rememberPkceVerifierWrite(storage: Storage, key: string, value: string): void {
  for (const guard of leftoverPkceGuards) {
    if (guard.storage !== storage) continue;
    if (key === PKCE_CODE_VERIFIER_KEY) {
      guard.protectedValue = value;
    }
    if (key === browserSupabaseSessionStorageKey) {
      if (value === "") continue;
      // leftover 拒否武装中は leftover 自身 / 空書きを控えにしない（winner を上書きしない）
      if (guard.leftoverAccessTokenAtArm !== null) {
        const token = readPersistAccessTokenFromRaw(value);
        if (token === null || token === guard.leftoverAccessTokenAtArm) continue;
        const incomingUserId = readPersistUserIdFromRaw(value);
        // C-R5: leftover 回転 A2 は token ≠ leftover A だが同一 user。last-wins 控えしない
        if (guard.leftoverUserIdAtArm !== null && incomingUserId === guard.leftoverUserIdAtArm) {
          continue;
        }
        // leftover user が取れないときは、既に控えた別 user の勝者を後着で上書きしない
        if (guard.leftoverUserIdAtArm === null && guard.protectedSessionValue !== null) {
          const capturedUserId = readPersistUserIdFromRaw(guard.protectedSessionValue);
          if (
            capturedUserId !== null &&
            incomingUserId !== null &&
            incomingUserId !== capturedUserId
          ) {
            continue;
          }
        }
      }
      guard.protectedSessionValue = value;
    }
  }
}

function wrapStoragePrototypeSetItemToCapturePkce(): void {
  if (leftoverPkceProtoSetItemRestore !== null || typeof Storage === "undefined") {
    return;
  }
  const proto = Storage.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "setItem");
  if (desc?.value === undefined || desc.configurable === false) {
    return;
  }
  const protoOriginal = desc.value as (this: Storage, key: string, value: string) => void;
  try {
    Object.defineProperty(proto, "setItem", {
      ...desc,
      value: function leftoverPkceCapturingSetItem(
        this: Storage,
        key: string,
        value: string,
      ): void {
        protoOriginal.call(this, key, value);
        rememberPkceVerifierWrite(this, key, value);
      },
    });
    leftoverPkceProtoSetItemRestore = () => {
      Object.defineProperty(proto, "setItem", desc);
    };
  } catch {
    // prototype を触れない環境ではインスタンス wrap に委ねる
  }
}

function wrapStorageSetItemToCapturePkce(storage: Storage): void {
  wrapStoragePrototypeSetItemToCapturePkce();
  if (leftoverPkceSetItemRestores.has(storage)) {
    return;
  }
  const ownDesc = Object.getOwnPropertyDescriptor(storage, "setItem");
  if (ownDesc?.value === undefined) {
    leftoverPkceSetItemRestores.set(storage, () => undefined);
    return;
  }
  const originalSetItem = ownDesc.value as (this: Storage, key: string, value: string) => void;
  try {
    Object.defineProperty(storage, "setItem", {
      ...ownDesc,
      value: function leftoverPkceCapturingOwnSetItem(key: string, value: string): void {
        originalSetItem.call(storage, key, value);
        rememberPkceVerifierWrite(storage, key, value);
      },
    });
    leftoverPkceSetItemRestores.set(storage, () => {
      Object.defineProperty(storage, "setItem", ownDesc);
    });
  } catch {
    leftoverPkceSetItemRestores.set(storage, () => undefined);
  }
}

function unwrapLeftoverPkceSetItemCaptures(): void {
  for (const restore of leftoverPkceSetItemRestores.values()) {
    restore();
  }
  leftoverPkceSetItemRestores.clear();
  leftoverPkceProtoSetItemRestore?.();
  leftoverPkceProtoSetItemRestore = null;
}

function unwrapStorageSetItemIfIdle(storage: Storage): void {
  for (const guard of leftoverPkceGuards) {
    if (guard.storage === storage) {
      return;
    }
  }
  leftoverPkceSetItemRestores.get(storage)?.();
  leftoverPkceSetItemRestores.delete(storage);
  if (leftoverPkceGuards.size === 0) {
    leftoverPkceProtoSetItemRestore?.();
    leftoverPkceProtoSetItemRestore = null;
  }
}

function armLeftoverSignOutPkceProtection(
  signOutPromise: Promise<unknown>,
  storage: Storage,
  liveMarkAtArm: LiveAuthSessionMark | null = readLiveAuthSessionMark(storage),
  leftoverAccessTokenAtArm: string | null = null,
  leftoverUserIdAtArm: string | null = null,
): void {
  const guard: LeftoverPkceGuard = {
    storage,
    protectedValue: null,
    protectedSessionValue: null,
    liveMarkAtArm,
    leftoverAccessTokenAtArm,
    leftoverUserIdAtArm,
  };
  leftoverPkceGuards.add(guard);
  // C-R4: protect より前の setItem を控える。後着 _removeSession が書込〜protect に入っても戻せる。
  // C3: 番号が書いた persist も同じ wrap で控え、後着 wipe のあと戻す。
  wrapStorageSetItemToCapturePkce(storage);
  void signOutPromise
    .catch(() => undefined)
    .then(() => {
      leftoverPkceGuards.delete(guard);
      restoreLeftoverProtectedPkce(guard);
      restoreLeftoverProtectedWinnerSession(guard);
      unwrapStorageSetItemIfIdle(storage);
    });
}

/**
 * C-R1: callback が unmarked leftover を拒否して出した local signOut の後着
 * `_removeSession` から、途中で書いた Google persist を戻す。
 * OTP leftover 掃除の PKCE 保護と同じ wrap を使い、戻し条件だけ leftover token 不一致を足す。
 * leftoverUserId は C-R5 の回転 A2 控えを抑止する。省略時は武装時点 persist から読む。
 */
export function armLeftoverRefuseSignOutWinnerPersistProtection(
  signOutPromise: Promise<unknown>,
  leftoverAccessToken: string,
  storage: Storage = window.localStorage,
  leftoverUserId?: string | null,
): void {
  const leftoverUserIdAtArm =
    leftoverUserId === undefined || leftoverUserId === null || leftoverUserId === ""
      ? readLeftoverPersistUserIdAtArm(storage, leftoverAccessToken)
      : leftoverUserId;
  armLeftoverSignOutPkceProtection(
    signOutPromise,
    storage,
    readLiveAuthSessionMark(storage),
    leftoverAccessToken,
    leftoverUserIdAtArm,
  );
}

/**
 * OAuth 開始直後の PKCE を後着 leftover _removeSession から守る。
 * leftover timeout 前は no-op。
 * C-R4: 書込時点の控えを、後着 remove 後の null で上書きしない。
 */
export function protectPkceVerifierFromLateLeftoverSignOut(
  storage: Storage = window.localStorage,
): void {
  const value = readPkceCodeVerifier(storage);
  for (const guard of leftoverPkceGuards) {
    if (guard.storage !== storage) {
      continue;
    }
    if (value !== null) {
      guard.protectedValue = value;
    }
  }
}

/** テスト専用: never-settle leftover signOut が残した控えを隔離する。本番からは呼ばない。 */
export function resetLeftoverPkceProtectionForTests(): void {
  leftoverPkceGuards.clear();
  unwrapLeftoverPkceSetItemCaptures();
}

/**
 * C-R2-3: 失敗時の V1 復元は、自分の bump 世代がまだ最新のときだけ。
 * 後続タブがさらに bump して V3 を書いた並行成功は消さない。
 * bump 前の失敗（oauth_mock 等）は世代が無いので従来どおり戻す。
 */
function restorePkceCodeVerifierAfterFailedGoogle(
  storage: Storage,
  generationAfterBump: number | null,
  previousVerifier: string | null,
): void {
  if (generationAfterBump !== null && readPkceVerifierGeneration(storage) !== generationAfterBump) {
    return;
  }
  restorePkceCodeVerifier(storage, previousVerifier);
}

function readPkceVerifierGeneration(storage: Storage): number {
  try {
    const raw = storage.getItem(PKCE_VERIFIER_GENERATION_KEY);
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function bumpPkceVerifierGeneration(storage: Storage): void {
  try {
    storage.setItem(PKCE_VERIFIER_GENERATION_KEY, String(readPkceVerifierGeneration(storage) + 1));
  } catch {
    // best-effort。世代が上がらなくても失敗経路は V1 復元を試みる
  }
}

function wasPkceVerifierOverwrittenDuringExchange(
  storage: Storage,
  generationAtStart: number,
  verifierAtStart: string | null,
): boolean {
  return (
    readPkceVerifierGeneration(storage) !== generationAtStart ||
    readPkceCodeVerifier(storage) !== verifierAtStart
  );
}

/**
 * C4: dual exchange / loser 収束用。
 * - completion bus: 常に見てよい（当該 flow の完了印）。
 * - session: exchange 開始後（または claim 後）だけ見る。
 *   開始前に session を見ると「既ログイン中の新規 magic/OAuth」を誤って complete してしまう。
 * - C1: session 経路は baseline から変化したときだけ complete（pre-existing 据え置きを拒否）。
 */
async function resolveAlreadyAuthenticated(
  flowId: string,
  returnTo: string,
  storage: Storage,
  client: BrowserSupabaseClient,
  options: { checkSession: boolean; baseline?: SessionProbeBaseline },
): Promise<AuthResumeResult | null> {
  const existingCompletion = readAuthContinuationCompletion(flowId, storage);
  if (existingCompletion !== null) {
    // C9 / C-R4: completion 印は TTL 内でも、live session が無い soft residual 後は complete にしない。
    // checkSession:false（pre-exchange）でも completion 単独 complete は禁止。
    try {
      const sessionResult = await client.auth.getSession();
      if (sessionResult.data.session !== null) {
        clearAuthFlow(flowId, storage);
        return {
          kind: "complete",
          continuation: "same_browser",
          returnTo: existingCompletion.returnTo,
          flowId,
        };
      }
    } catch {
      // getSession 失敗は session 無しと同型
    }
    if (!options.checkSession) {
      // pre-exchange: 印を残し re-exchange しない（dual exchange / コード二重消費を避ける）。
      // resume 先頭 short-circuit 側が stale 印 clear + re-claim を担当する（C-R4）。
      return {
        kind: "awaiting_completion",
        flowId,
        returnTo: existingCompletion.returnTo,
      };
    }
    // loser probe: stale 印を落として baseline session 判定へ
    clearAuthContinuationCompletion(flowId, storage);
  }
  if (!options.checkSession) return null;
  try {
    const sessionResult = await client.auth.getSession();
    const session = sessionResult.data.session;
    if (session === null) return null;
    const currentKey = sessionProbeKey(session);
    // baseline 未指定は fail-closed（session だけで complete しない）。loser probe は必ず渡す。
    const baseline = options.baseline ?? { kind: "unknown" };
    if (!isSessionChangedFromBaseline(baseline, currentKey)) {
      return null;
    }
    // C10: completion に載せる returnTo は自己参照 path を落とす
    const safeReturnTo = sanitizeLoginReturnPath(returnTo);
    try {
      publishAuthContinuationCompletion({ flowId, returnTo: safeReturnTo }, storage);
    } catch {
      // setItem 失敗でも session は確立済み
    }
    return {
      kind: "complete",
      continuation: "same_browser",
      returnTo: safeReturnTo,
      flowId,
    };
  } catch {
    // getSession 失敗は「未確立」とみなし caller が terminal / 次 probe へ
  }
  return null;
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
      // C3: 単一 PKCE キーへの並行開始を直列化。create も含め後着は先着の OAuth 完了を待つ。
      // C-R1: Locks 非対応でも注入 storage の開始旗でタブ間直列化する。
      return withSerializedGoogleStart(storage, async () => {
        // C6: 既存 unexpired secret は焼かない。旧 magic/OAuth リンクが deposit されても
        // 元ブラウザが claim できるよう複数 flow を TTL まで併存させる。
        // （旧 replaceExistingAuthFlows は再送時に flow A secret を消し、A のリンクを orphan にしていた）
        // C3: ただし PKCE verifier は SDK 単一キー。後勝ちの Google 開始は先行 OAuth を
        // 明示 dismiss し、死んだ verifier で先着 callback が terminal になる窓を閉じる。
        // C5: token_hash も dismiss する（secret は残す）。
        // C-R1: dismiss は OAuth 成功後。失敗時に先行 flow を oauth_cancelled にしない。
        // 成功後に自 flow の dismiss を戻し、同時双方 dismiss を後勝ちで閉じる。
        // C-R2-1: SDK は await 前に V2 を書く。失敗時は V1 を戻し、世代だけ残して
        // in-flight の exchangeStarted 失敗を dismiss 無しでも non-terminal にする。
        // C-R2-3: 戻すのは自分の bump 世代が残っているときだけ。並行成功の V3 は残す。
        const provider = deps.getPublicEnv();
        const flow = await createAuthFlow(
          returnTo,
          continuationApi,
          storage,
          undefined,
          provider.authProviderMode,
        );
        const previousPkceVerifier = readPkceCodeVerifier(storage);
        let pkceGenerationAfterBump: number | null = null;
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
            dismissSiblingOauthAuthorizationFlows(flow.id, storage);
            clearAuthFlowUserDismissed(flow.id, storage);
            return;
          }
          // 世代は SDK 書き込みより前に上げる。失敗後に V1 を戻しても in-flight が上書きを観測できる。
          bumpPkceVerifierGeneration(storage);
          pkceGenerationAfterBump = readPkceVerifierGeneration(storage);
          const { error } = await client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
          if (error !== null) {
            throw new Error("Googleログインを開始できませんでした");
          }
          // C-R2: leftover timeout 後の後着 _removeSession から今書いた verifier を守る
          protectPkceVerifierFromLateLeftoverSignOut(storage);
          dismissSiblingOauthAuthorizationFlows(flow.id, storage);
          clearAuthFlowUserDismissed(flow.id, storage);
        } catch {
          restorePkceCodeVerifierAfterFailedGoogle(
            storage,
            pkceGenerationAfterBump,
            previousPkceVerifier,
          );
          clearAuthFlow(flow.id, storage);
          throw new Error("Googleログインを開始できませんでした");
        }
      });
    },

    async sendMagicLink(email, returnTo) {
      // C6: 上記 signInWithGoogle と同型。再送で旧 secret を焼かない。
      // credentialKind=token_hash: メールはアプリ着地 + verifyOtp。GET /verify 一発消費を避ける。
      const flow = await createAuthFlow(
        returnTo,
        continuationApi,
        storage,
        undefined,
        "supabase",
        "token_hash",
      );
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

    async sendEmailOtp(email) {
      // 番号送信は同じタブで完結する。リダイレクト URL も AuthFlow も作らない。
      const trimmed = email.trim();
      try {
        const { error } = await client.auth.signInWithOtp({
          email: trimmed,
          options: { shouldCreateUser: true },
        });
        if (error !== null) throw new Error("email otp send failed");
      } catch {
        throw new Error(EMAIL_OTP_SEND_FAILED);
      }
      return {
        email: trimmed,
        resendAvailableAt: new Date(
          Date.now() + getPublicEnv().magicLinkResendSeconds * 1_000,
        ).toISOString(),
      };
    },

    async verifyEmailOtp(input) {
      // ちょうど 6 桁だけサーバへ送る。7 桁以上は normalize が先頭 6 に切るので切る前も見る。
      const digits = normalizeOtpDigits(input.token);
      const unslicedLength = input.token.normalize("NFKC").replace(/\D/gu, "").length;
      if (digits.length !== 6 || unslicedLength !== 6) {
        return { kind: "mismatch" };
      }
      try {
        // C2: leftover pin A が verify 中の SIGNED_IN B を拒否しないよう、verify 前に武装する
        armIntentionalAuthSessionSwitch("email_otp");
        const { error } = await client.auth.verifyOtp({
          email: input.email,
          token: digits,
          type: "email",
        });
        if (error === null) {
          // C1/C3: 番号成功は origin 共有 live 印。他タブ leftover 掃除が live session を消さない
          try {
            const sessionResult = await client.auth.getSession();
            const session = sessionResult.data.session;
            const userId = session === null ? undefined : session.user.id;
            writeLiveAuthSessionMark(typeof userId === "string" ? userId : undefined);
          } catch {
            writeLiveAuthSessionMark();
          }
          return { kind: "complete" };
        }
        clearIntentionalAuthSessionSwitch();
        return { kind: mapEmailOtpVerifyKind(error.code) };
      } catch {
        // 未知・通信失敗も fail-closed。raw GoTrue 文は出さない。
        clearIntentionalAuthSessionSwitch();
        return { kind: "unavailable" };
      }
    },

    async completeCallback(url) {
      // C7: implicit token fragment と未知 fragment は fail-closed。
      // GoTrue PKCE の error-only fragment は許可し、query の error_code 判定へ進む。
      if (isRejectedAuthCallbackHash(url.hash)) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // C7: 許可クエリ以外（access_token 等）は fail-closed
      for (const key of url.searchParams.keys()) {
        if (!COMPLETE_CALLBACK_ALLOWED_QUERY_KEYS.has(key)) {
          return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
        }
      }
      const flowId = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const stored = flowId === null ? null : readAuthFlow(flowId, storage);
      const returnTo = sanitizeReturnPath(stored?.returnTo);
      // 旧 token_hash リンクは pending / 確認 UI / verify / deposit しない。
      // code 同時載りも従来どおり unbound（どちらを優先するか曖昧）。
      if (tokenHash !== null) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // C1: code+state があるときは spoofable な URL error_code より deposit を優先する。
      // 攻撃者が有効な code に error_code=otp_expired を足しても short-circuit で捨てない。
      const hasCodeAndState = state !== null && code !== null;
      if (!hasCodeAndState && isExpired(null, url)) {
        // C1: ローカル flow があるときは provider-error と同様に state 照合してから expired を受理。
        // flow UUID だけで error_code を付けた未束縛 URL は unbound（秘密を焼かない）。
        // AuthCallbackPage は kind=expired で secret を焼かない（C5）。state 束縛しないと DoS になる。
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
          // C5: code 無し provider error では secret を即焼かない。
          // state は redirect 初回 URL に載り得るため、一致だけを根拠に clear すると
          // ログ観測者による in-flight 秘密破壊 DoS になる。正当 cancel も TTL / 明示 logout で収束。
          // （AuthCallbackPage 側も oauth_cancelled / auth_callback_failed で clear しない。）
          // C3: flowId を載せ page が user-dismiss 印を付け、遅延 success の silent complete を防ぐ。
          return {
            kind: "error",
            code: providerError === "access_denied" ? "oauth_cancelled" : "auth_callback_failed",
            returnTo,
            ...(flowId !== null ? { flowId } : {}),
          };
        }
      }
      if (flowId === null) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // C3: cancel/期限切れ UI で dismiss 済みの flow は deposit/claim しない
      // （secret は DoS ロックで TTL まで残し、C2 で listUnexpired の TTL 掃除 / pending は dismiss 時消去）
      if (isAuthFlowUserDismissed(flowId, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo,
          flowId,
        };
      }
      // AUTH-R1: strip 後のリロードでは code/state/token_hash が消える。
      if (state === null || code === null) {
        // C-ML1: token_hash magic は confirm 前に pending へ載せている。strip 後も確認 UI を再構成する。
        if (stored?.credentialKind === "token_hash") {
          const pending = readPendingAuthDeposit(
            flowId,
            storage,
            adjustedAuthNowMs(Date.now(), stored.clockSkewMs),
          );
          if (pending !== null && pending.code.length >= 16) {
            return {
              kind: "needs_confirmation",
              flowId,
              returnTo,
              tokenHash: pending.code,
              otpType: "email",
              state: pending.state,
            };
          }
        }
        if (stored !== null) {
          // C-RR2: 同一ブラウザ strip reload でも callback-prelease を立て、claim→exchange
          // lease 取得前の hangWatchdog / failClosed が secret を焼かない（C9 と同型）。
          // awaiting 手渡しのため heartbeat は止めない（target recovery と併存可。TTL で失効）。
          startAuthContinuationCallbackPreLease(flowId, storage);
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
      // R1 residual-intentional / C7: 正当 deposit 後の後着毒も last-wins で上書きし得る（可用性 DoS、
      // アカウント奪取ではない）。first-wins に戻すと毒 first-wins（旧 C2）が再発するため維持。
      // C7 は回帰テストとコメントで residual を固定するだけで、RPC / last-wins は変えない。
      // deposit API は code 形式を厳格化して明らかなゴミを弾くが、形式を通る毒は閉じない。
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
        // C3: URL strip 後も recovery が re-deposit できるよう pending に短寿命保存する。
        // expiresAt は flow のサーバ期限があればそれを使い、無ければローカル TTL。
        const pendingExpiresAtMs =
          stored.expiresAt !== undefined
            ? new Date(stored.expiresAt).getTime()
            : Date.now() + deps.getPublicEnv().authContinuationTtlMs;
        writePendingAuthDeposit(flowId, { state, code, expiresAtMs: pendingExpiresAtMs }, storage);
        // C1/C2: deposit は timeout+backoff 再試行。URL strip 後も code は本閉包 + pending に残る。
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
          // C3: 429/5xx/transport 尽きた場合も terminal にせず awaiting へ。
          // pending deposit + resume の re-deposit で rate-limit 窓明けを待つ。
          // 非リトライ 4xx（terminal outcome）のみ pending を消し unbound。
          if (depositOutcome === "timeout" || depositOutcome === "transient") {
            keepPreLeaseHeartbeat = true;
            return {
              kind: "awaiting_completion",
              flowId,
              returnTo,
            };
          }
          clearPendingAuthDeposit(flowId, storage);
          releaseAuthContinuationCallbackPreLease(flowId, storage);
          return { kind: "error", code: "unbound_callback", returnTo };
        }
        clearPendingAuthDeposit(flowId, storage);
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

    async confirmMagicLink(input) {
      // otpType は ConfirmMagicLinkInput 互換で受け取るが、verifyOtp は常に email に正規化する
      const { flowId, tokenHash, state } = input;
      if (tokenHash.length < 16) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      const stored = readAuthFlow(flowId, storage);
      const returnTo = sanitizeReturnPath(stored?.returnTo);
      if (stored !== null && state !== null && state !== stored.state) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // C5: Google 開始後の dismiss を confirm 入口で見て、awaitingConfirm を外さない。
      if (stored !== null && isAuthFlowUserDismissed(stored.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo,
          flowId: stored.id,
        };
      }
      // クロスブラウザ（secret 無し）: token_hash を deposit し元ブラウザへ。ここでは session を作らない。
      if (stored === null) {
        if (state === null) {
          return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
        }
        const depositOutcome = await depositWithRetry(() =>
          continuationApi.deposit(flowId, { state, code: tokenHash }),
        );
        if (depositOutcome === "ok") {
          return {
            kind: "deposited",
            continuation: "original_browser",
            flowId,
            returnTo: "/planner",
          };
        }
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      // 同一ブラウザ: deposit は他タブ用 best-effort。本丸は verifyOtp(POST) で OTP 消費 + session。
      const stopPreLease = startAuthContinuationCallbackPreLease(flowId, storage);
      let keepPreLeaseHeartbeat = false;
      try {
        const pendingExpiresAtMs =
          stored.expiresAt !== undefined
            ? new Date(stored.expiresAt).getTime()
            : Date.now() + deps.getPublicEnv().authContinuationTtlMs;
        writePendingAuthDeposit(
          flowId,
          { state: stored.state, code: tokenHash, expiresAtMs: pendingExpiresAtMs },
          storage,
        );
        const depositOutcome = await depositWithRetry(() =>
          continuationApi.deposit(flowId, {
            state: stored.state,
            code: tokenHash,
            secret: stored.secret,
          }),
        );
        // C7: ok に加え terminal（非リトライ 4xx）でも pending を消す。
        // redeposit / completeCallback 初回 terminal と対称にし、recovery 経由の
        // OTP re-deposit と IP rate 自己消費を閉じる。timeout/transient は late 204 用に残置。
        if (depositOutcome === "ok" || depositOutcome === "terminal") {
          clearPendingAuthDeposit(flowId, storage);
        }
        // deposit 失敗でも URL 由来 token_hash で verify を試みる（continuation TTL 切れ等）。
        try {
          const result = await withTimeout(
            establishSessionFromTokenHash(flowId, tokenHash),
            IMMEDIATE_CLAIM_TIMEOUT_MS,
          );
          if (result.kind === "awaiting_completion") {
            keepPreLeaseHeartbeat = true;
          } else {
            releaseAuthContinuationCallbackPreLease(flowId, storage);
          }
          return result;
        } catch {
          keepPreLeaseHeartbeat = true;
          return { kind: "awaiting_completion", flowId, returnTo };
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

  async function runResumeFlow(flowId: string): Promise<AuthResumeResult> {
    const flow = readAuthFlow(flowId, storage);
    if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
    // C3: dismiss 済みは residual recovery でも拾わない（secret は TTL まで残る）
    if (isAuthFlowUserDismissed(flow.id, storage)) {
      return { kind: "error", code: "oauth_cancelled", returnTo: flow.returnTo, flowId: flow.id };
    }
    // C4: 当該 flow の completion 済みなら claim/exchange しない。
    // C9: completion **有無**の読取は同期（in-flight join が Map 登録前に分岐しない）。
    // C-R4: complete 返却前に live session を確認する。null なら stale 印を捨て re-claim へ
    // （soft residual 後の RequireSession bounce を TTL 窓内でも閉じる）。
    // join 契約: 複数 resume は同一 Promise を共有するため、先頭 run だけがここを通る。
    const existingCompletion = readAuthContinuationCompletion(flow.id, storage);
    if (existingCompletion !== null) {
      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.data.session !== null) {
          clearAuthFlow(flow.id, storage);
          return {
            kind: "complete",
            continuation: "same_browser",
            returnTo: existingCompletion.returnTo,
            flowId: flow.id,
          };
        }
      } catch {
        // getSession 失敗は stale 扱い
      }
      // session 無し: completion を落として claim へ進む（deposit が残っていれば回復）
      clearAuthContinuationCompletion(flow.id, storage);
    }
    // C3: completeCallback の deposit budget 後も pending code があれば re-deposit してから claim。
    // C15: flow.clockSkewMs で now を補正し、進みすぎクライアントでも pending を flow 寿命と揃える。
    const pendingDeposit = readPendingAuthDeposit(
      flow.id,
      storage,
      adjustedAuthNowMs(Date.now(), flow.clockSkewMs),
    );
    // C1: confirm 前の token_hash pending は re-deposit も claim もしない。
    // ciphertext（匿名 last-wins 毒や他端末 deposit）があっても verify/exchange しない。
    // 他端末 confirm の拾いは、awaitingConfirm が無い元ブラウザ residual（WebView 側 pending）に委ねる。
    if (pendingDeposit !== null && pendingDeposit.awaitingConfirm === true) {
      return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
    }
    if (pendingDeposit !== null) {
      // RR2: 他 run が既に exchange 中なら re-deposit を重ねず recovery へ委ねる。
      if (isAuthContinuationExchangeInFlight(flow.id, storage, Date.now())) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // RR2: 同一プロセスで re-deposit 進行中なら deposit を重ねず claim のみ試す。
      // soft TTL 離脱後の第二 run がゾンビ depositWithRetry と並走して rate を焼くのを防ぐ。
      if (!redepositInFlightByFlowId.has(flow.id)) {
        redepositInFlightByFlowId.add(flow.id);
        try {
          const redepositOutcome = await depositWithRetry(() =>
            continuationApi.deposit(flow.id, {
              state: pendingDeposit.state,
              code: pendingDeposit.code,
              secret: flow.secret,
            }),
          );
          // C8: ok に加え terminal（非リトライ 4xx）でも pending を消す。
          // completeCallback 初回 deposit の terminal 分岐と対称にし、recovery poll 経由の
          // 無限 re-deposit と IP rate 自己消費・code 平文の TTL までの残置を閉じる。
          // timeout/transient は late 204 / 窓明け再試行のため残置（意図的）。
          if (redepositOutcome === "ok" || redepositOutcome === "terminal") {
            clearPendingAuthDeposit(flow.id, storage);
          }
        } finally {
          redepositInFlightByFlowId.delete(flow.id);
        }
      }
      // timeout/transient / re-deposit スキップ: pending を残し claim を試みる（late 204 の可能性）
      // re-deposit await 後も sibling completion があれば dual exchange を避ける
      // C-R4: live session 無しの stale completion は complete にしない
      const afterRedepositCompletion = readAuthContinuationCompletion(flow.id, storage);
      if (afterRedepositCompletion !== null) {
        try {
          const sessionResult = await client.auth.getSession();
          if (sessionResult.data.session !== null) {
            clearAuthFlow(flow.id, storage);
            return {
              kind: "complete",
              continuation: "same_browser",
              returnTo: afterRedepositCompletion.returnTo,
              flowId: flow.id,
            };
          }
        } catch {
          // stale 扱い
        }
        clearAuthContinuationCompletion(flow.id, storage);
      }
      // C-R2: redeposit 中に後勝ち Google が dismiss したら exchange しない
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // C-R1: redeposit 中に sibling clear されていたら claim/exchange しない
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
    }
    // exchange 失敗（provider 拒否）だけ terminal。claim 成功後も secret は exchange 成功まで残す（C3/C4）。
    let exchangeStarted = false;
    // C1: exchange 直前 fingerprint。catch の loser probe から参照するため try 外で保持する。
    let sessionBaseline: SessionProbeBaseline = { kind: "unknown" };
    // C1: exchange 開始時の live 印。番号勝者が後から書いた印と区別する。
    let liveMarkAtExchangeStart: LiveAuthSessionMark | null = null;
    // C-R2-1: exchange 開始時の PKCE 世代/値。catch から参照するため try 外。
    let pkceGenerationAtExchangeStart = 0;
    let pkceVerifierAtExchangeStart: string | null = null;
    // C3/R2: タブ横断 dual exchange 抑止用。claim 成功後に acquire（locks + 確認遅延）し、
    // 完了/terminal で解放する。R3: 生存中は heartbeat で TTL を延長する。
    const exchangeInstanceId = `exchange-${flow.id}-${Math.random().toString(36).slice(2, 10)}`;
    let holdsExchangeLease = false;
    let stopExchangeHeartbeat: (() => void) | undefined;
    try {
      // C-R2: claim 直前の dismiss 再検査（入口通過後の後勝ち Google）
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // C-R1: claim 直前にも storage を再確認（redeposit await 中の sibling clear）
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // storage 上の最新 secret/state を優先（クリア済みは上で discard）
      const claimFlow = readAuthFlow(flow.id, storage) ?? flow;
      const claimedCode = await continuationApi.claim(flow.id, {
        secret: claimFlow.secret,
        state: claimFlow.state,
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
      // C4: lease 取得後〜exchange 直前は completion bus を再確認。
      // C-R4: completion があっても live session 無しなら complete にしない（resolve 内）。
      // session 単独での complete はしない（既ログイン中の新規 OAuth/magic を old session で complete しない）。
      // session 検査（baseline）は provider exchange 失敗後の loser probe に限定する。
      const preExchangeDone = await resolveAlreadyAuthenticated(
        flow.id,
        flow.returnTo,
        storage,
        client,
        { checkSession: false },
      );
      if (preExchangeDone !== null) {
        return preExchangeDone;
      }
      // C-R2: exchange 直前の dismiss 再検査（claim 中に後勝ち Google が verifier を上書き）
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // C-R1: sibling clear 後はメモリ secret / claimed code で exchange しない（結果適用 discard）
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // C1: exchange 直前の session 指紋。loser probe は「変化した session」だけ complete する。
      sessionBaseline = await captureSessionProbeBaseline(client);
      liveMarkAtExchangeStart = readLiveAuthSessionMark(storage);
      // C-R2: baseline await 後の最終 dismiss 再検査
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // baseline await 後の最終 discard（C-R1）
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      pkceGenerationAtExchangeStart = readPkceVerifierGeneration(storage);
      pkceVerifierAtExchangeStart = readPkceCodeVerifier(storage);
      // C4: leftover first-pin A が後着 Google B を拒否しないよう exchange 前に武装する
      armIntentionalAuthSessionSwitch("google_callback");
      exchangeStarted = true;
      const result =
        claimFlow.sessionExchange === "oauth_mock"
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
          : shouldExchangeClaimedAsTokenHash(claimFlow.credentialKind, claimedCode.code)
            ? // magic token_hash: claim した平文は OTP hash。PKCE code exchange ではない。
              client.auth.verifyOtp({
                token_hash: claimedCode.code,
                type: verifyOtpType(),
              })
            : client.auth.exchangeCodeForSession(claimedCode.code);
      const { data: exchangeData, error } = await result;
      if (error !== null) {
        // token_hash 期限切れは resume でも expired に写す（unbound より再送 UI へ）
        if (
          shouldExchangeClaimedAsTokenHash(claimFlow.credentialKind, claimedCode.code) &&
          isExpired(error, new URL("http://local/"))
        ) {
          clearAuthFlow(flow.id, storage);
          return { kind: "expired", flowId: flow.id, returnTo: flow.returnTo };
        }
        throw new Error("provider exchange failed");
      }
      // F-AUTH-002 / C10: claim 成功の returnTo も Login create と同型で再 sanitize
      // （自己参照 path を completion / navigate に載せない）
      const safeReturnTo = sanitizeLoginReturnPath(claimedCode.returnTo);
      // C-R1: exchange 後も sibling が先に publish して当該 flow を消していたら
      // 自 complete を bus に載せない（navigate/onComplete の loser 適用を抑止）。
      // C-R6/C-R9: client/storage session は既に loser に置換済みになり得る
      // → baseline present なら setSession 復元、absent/unknown なら loser fingerprint 一致時のみ local clear
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        clearIntentionalAuthSessionSwitch();
        clearPendingAuthDeposit(flow.id, storage);
        // discard 時点の session 指紋（exchange 結果）。C-R9 clear の一致判定に使う
        const discardedExchangeSessionKey = await probeDiscardedExchangeSessionKey(client);
        await restoreSessionAfterDiscardedExchange(
          client,
          sessionBaseline,
          discardedExchangeSessionKey,
          { loserFlowId: flow.id, storage, liveMarkAtStart: liveMarkAtExchangeStart },
        );
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // C1 / C10: secret 消去は publishAuthContinuationCompletion（setItem 成功後の clear）に一本化。
      // 先に clearClaimed すると setItem 失敗時に他タブ re-claim 不能・completion 未公開でスタックする。
      // C4: withTimeout で結果が discard されても storage 経由で recovery/listener が拾えるよう公開。
      // gateway に注入された storage と同じ領域へ書き、テストの MapStorage とも一致させる。
      try {
        publishAuthContinuationCompletion(
          { flowId: flow.id, returnTo: safeReturnTo },
          storage,
          userIdFromAuthResultData(exchangeData),
        );
      } catch {
        // setItem 失敗時 publish は clear しない → secret 残存（他タブ re-claim / ページ側再 publish 可）。
        // セッションは既に確立済みなので outer catch の terminal clear に落とさず complete を返す。
        // （throw を外へ出すと exchangeStarted 分岐が secret を焼いて C1 が再発する。）
      }
      clearPendingAuthDeposit(flow.id, storage);
      return {
        kind: "complete",
        continuation: "same_browser",
        returnTo: safeReturnTo,
        flowId: flow.id,
      };
    } catch (error) {
      clearIntentionalAuthSessionSwitch();
      // provider exchange が明示失敗したときだけ terminal（hang/timeout は下層で kind 返却しない）
      const isRetryableTransport =
        error instanceof ContinuationHttpError ||
        error instanceof ContinuationResponseLostError ||
        error instanceof TypeError;
      if (exchangeStarted && !isRetryableTransport) {
        // C-R2: exchange 開始後に後勝ち Google が dismiss したなら terminal clear しない。
        // 死んだ verifier での失敗を unbound にしない（secret は TTL まで残す）。
        if (isInFlightResumeDismissed(flow.id, storage)) {
          return {
            kind: "error",
            code: "oauth_cancelled",
            returnTo: flow.returnTo,
            flowId: flow.id,
          };
        }
        // C-R2-1: dismiss 前の verifier 上書き（失敗後勝ち / write→dismiss 窓）。
        // V1 復元後でも世代差が残るので、比較が V1==V1 でも terminal にしない。
        if (
          wasPkceVerifierOverwrittenDuringExchange(
            storage,
            pkceGenerationAtExchangeStart,
            pkceVerifierAtExchangeStart,
          )
        ) {
          return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
        }
        // C4/C5: dual exchange loser や getSession ラグでも sibling 成功を取りこぼさない。
        // 短間隔で completion / session を再検査してから terminal clear する。
        // C1: session は baseline から変化したときだけ complete（pre-existing 据え置きは拒否）。
        for (let probe = 0; probe < EXCHANGE_LOSER_SESSION_PROBE_ATTEMPTS; probe += 1) {
          if (probe > 0) {
            await sleepMs(EXCHANGE_LOSER_SESSION_PROBE_GAP_MS);
          }
          const recovered = await resolveAlreadyAuthenticated(
            flow.id,
            flow.returnTo,
            storage,
            client,
            { checkSession: true, baseline: sessionBaseline },
          );
          if (recovered !== null) return recovered;
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

  /**
   * 同一ブラウザ confirmMagicLink 用: claim を経ず token_hash を verifyOtp して session を立てる。
   * resumeFlow と同じ exchange lease / completion publish 契約。
   * C-R2: verify / publish 前に dismiss を再検査し、後勝ち Google を焼かない。
   * C-R6: runResumeFlow と同型の sibling-clear discard 再確認（pre/post verifyOtp）と baseline 復元。
   */
  async function establishSessionFromTokenHash(
    flowId: string,
    tokenHash: string,
  ): Promise<AuthResumeResult> {
    const flow = readAuthFlow(flowId, storage);
    if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
    // C3: dismiss 済みは confirm 経路でも silent complete しない
    if (isAuthFlowUserDismissed(flow.id, storage)) {
      return { kind: "error", code: "oauth_cancelled", returnTo: flow.returnTo, flowId: flow.id };
    }
    // C-R4: completion short-circuit も live session 必須（resumeFlow と同型）
    const existingCompletion = readAuthContinuationCompletion(flow.id, storage);
    if (existingCompletion !== null) {
      try {
        const sessionResult = await client.auth.getSession();
        if (sessionResult.data.session !== null) {
          clearAuthFlow(flow.id, storage);
          return {
            kind: "complete",
            continuation: "same_browser",
            returnTo: existingCompletion.returnTo,
            flowId: flow.id,
          };
        }
      } catch {
        // stale 扱い
      }
      clearAuthContinuationCompletion(flow.id, storage);
    }
    const exchangeInstanceId = `exchange-${flow.id}-${Math.random().toString(36).slice(2, 10)}`;
    let holdsExchangeLease = false;
    let stopExchangeHeartbeat: (() => void) | undefined;
    let exchangeStarted = false;
    let sessionBaseline: SessionProbeBaseline = { kind: "unknown" };
    let liveMarkAtExchangeStart: LiveAuthSessionMark | null = null;
    try {
      // C-R6: lease 前に sibling clear 済みなら verifyOtp しない
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      if (
        !(await tryAcquireAuthContinuationExchangeInFlight(
          flow.id,
          exchangeInstanceId,
          storage,
          Date.now(),
        ))
      ) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      holdsExchangeLease = true;
      stopExchangeHeartbeat = startAuthContinuationExchangeInFlightHeartbeat(
        flow.id,
        exchangeInstanceId,
        storage,
      );
      if (
        !isAuthContinuationExchangeInFlightOwner(flow.id, exchangeInstanceId, storage, Date.now())
      ) {
        stopExchangeHeartbeat();
        stopExchangeHeartbeat = undefined;
        holdsExchangeLease = false;
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // C-R2: lease 待ち中の後勝ち Google。入口通過後でも verify しない
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      const preExchangeDone = await resolveAlreadyAuthenticated(
        flow.id,
        flow.returnTo,
        storage,
        client,
        { checkSession: false },
      );
      if (preExchangeDone !== null) return preExchangeDone;
      // C-R2: resumeFlow と同型。後勝ち Google の dismiss を verify 前に再検査する
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // C-R6: sibling clear 後は verifyOtp しない（結果適用 discard / コード消費を避ける）
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      sessionBaseline = await captureSessionProbeBaseline(client);
      liveMarkAtExchangeStart = readLiveAuthSessionMark(storage);
      // C-R2: baseline await 後の最終 dismiss 再検査
      if (isInFlightResumeDismissed(flow.id, storage)) {
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      // baseline await 後の最終 discard（C-R6 / runResumeFlow と同型）
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      exchangeStarted = true;
      const { data: magicVerifyData, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: verifyOtpType(),
      });
      if (error !== null) {
        if (isExpired(error, new URL("http://local/"))) {
          clearAuthFlow(flow.id, storage);
          return { kind: "expired", flowId: flow.id, returnTo: flow.returnTo };
        }
        throw new Error("provider exchange failed");
      }
      // C-R6/C-R9: verify 後 sibling clear 済みなら complete を publish せず baseline 復元 or loser clear
      if (isInFlightResumeDiscardedByStorage(flow.id, storage)) {
        clearPendingAuthDeposit(flow.id, storage);
        const discardedExchangeSessionKey = await probeDiscardedExchangeSessionKey(client);
        await restoreSessionAfterDiscardedExchange(
          client,
          sessionBaseline,
          discardedExchangeSessionKey,
          { loserFlowId: flow.id, storage, liveMarkAtStart: liveMarkAtExchangeStart },
        );
        return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
      }
      // C-R2: verify 成功後も dismiss なら publish しない（後勝ち Google の secret を焼かない）
      // C2: sibling-clear と同型。破棄した magic session を baseline 復元 or loser 指紋一致時だけ local clear。
      // 残すと Login の authenticated Navigate と pin が後勝ち Google を拒む。
      // C-R1: 指紋 getSession は timeout。指紋無しでも sibling 無しなら local clear。
      if (isInFlightResumeDismissed(flow.id, storage)) {
        clearPendingAuthDeposit(flow.id, storage);
        const discardedExchangeSessionKey = await probeDiscardedExchangeSessionKey(client);
        await restoreSessionAfterDiscardedExchange(
          client,
          sessionBaseline,
          discardedExchangeSessionKey,
          { loserFlowId: flow.id, storage, liveMarkAtStart: liveMarkAtExchangeStart },
        );
        return {
          kind: "error",
          code: "oauth_cancelled",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      const safeReturnTo = sanitizeLoginReturnPath(flow.returnTo);
      try {
        publishAuthContinuationCompletion(
          { flowId: flow.id, returnTo: safeReturnTo },
          storage,
          userIdFromAuthResultData(magicVerifyData),
        );
      } catch {
        // publish 失敗時も session は確立済み。complete を返す（resume と同型）。
      }
      clearPendingAuthDeposit(flow.id, storage);
      return {
        kind: "complete",
        continuation: "same_browser",
        returnTo: safeReturnTo,
        flowId: flow.id,
      };
    } catch (error) {
      const isRetryableTransport =
        error instanceof ContinuationHttpError ||
        error instanceof ContinuationResponseLostError ||
        error instanceof TypeError;
      if (exchangeStarted && !isRetryableTransport) {
        // C-R2: verify 開始後の後勝ち Google。terminal clear せず secret を残す
        if (isInFlightResumeDismissed(flow.id, storage)) {
          return {
            kind: "error",
            code: "oauth_cancelled",
            returnTo: flow.returnTo,
            flowId: flow.id,
          };
        }
        for (let probe = 0; probe < EXCHANGE_LOSER_SESSION_PROBE_ATTEMPTS; probe += 1) {
          if (probe > 0) {
            await sleepMs(EXCHANGE_LOSER_SESSION_PROBE_GAP_MS);
          }
          const recovered = await resolveAlreadyAuthenticated(
            flow.id,
            flow.returnTo,
            storage,
            client,
            { checkSession: true, baseline: sessionBaseline },
          );
          if (recovered !== null) return recovered;
        }
        clearAuthFlow(flow.id, storage);
        return {
          kind: "error",
          code: "unbound_callback",
          returnTo: flow.returnTo,
          flowId: flow.id,
        };
      }
      if (error instanceof ContinuationHttpError) {
        if (error.status === 404 || error.status === 429 || error.status >= 500) {
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
      if (error instanceof ContinuationResponseLostError || error instanceof TypeError) {
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
      if (holdsExchangeLease) {
        stopExchangeHeartbeat?.();
        releaseAuthContinuationExchangeInFlight(flowId, storage, exchangeInstanceId);
      }
    }
  }

  return gateway;
}
