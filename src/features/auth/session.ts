import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { withTimeout } from "./async-timeout";

/** ローカルに session が無い／取得できない */
export class AuthSessionRequiredError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "AuthSessionRequiredError";
  }
}

/**
 * access token の期限切れや refresh 失敗など、再ログインが必要な状態。
 * message は API の closed code と揃え、生成フロー等で isAuthSessionFailure 判定できるようにする。
 */
export class AuthSessionExpiredError extends Error {
  constructor() {
    super("auth_required");
    this.name = "AuthSessionExpiredError";
  }
}

/**
 * C9: getSession / refreshSession が timeout したときの一時障害。
 * 端末の refresh token が失効したとは限らないため isAuthSessionFailure には含めない
 * （生成等は offline/retry 扱い。false re-login + storage clear を避ける）。
 * fail-open はしない: token は返さず呼び出し側は操作を中断する。
 */
export class AuthSessionProbeTimeoutError extends Error {
  constructor() {
    super("auth_session_probe_timeout");
    this.name = "AuthSessionProbeTimeoutError";
  }
}

/**
 * R2: React pin user と共有 client session user の一時乖離（multi-tab clobber 等）。
 * C1 の Bearer 拒否は維持するが、真の session 失効ではないため isAuthSessionFailure には含めない
 * （生成等は offline/retry。false な sessionExpired 誘導 + free-form 草稿 wipe を避ける — C12 と同型）。
 * fail-open はしない: token は返さず data plane も AuthProvider 側で B を落とす（R1）。
 */
export class AuthSessionPinMismatchError extends Error {
  constructor() {
    super("auth_session_pin_mismatch");
    this.name = "AuthSessionPinMismatchError";
  }
}

/** 期限切れ N 秒前から refresh を試み、失効を早めに検知する */
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;

/**
 * refreshSession の上限。半開き回線で never-settle すると生成 UI が固着する（A1）。
 * 短すぎると遅い回線で誤失効、長すぎるとスピナーが残る。
 */
export const ACCESS_TOKEN_REFRESH_TIMEOUT_MS = 5_000;

/**
 * getSession の上限（AP2）。
 * cold-start / refresh と同窓。削除・feedback 等が getSession hang で pending 固着しないようにする。
 */
export const ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS = 5_000;

/**
 * C1: AuthProvider の React session pin と共有 Supabase client の Bearer 乖離を防ぐゲート。
 * pin 済み user と getSession/refresh の user が不一致なら Function 向け token を出さない。
 * AuthProvider.applyAuthSession が更新する。module 単体テストは resetAccessTokenPinGateForTests。
 */
let accessTokenPinnedUserId: string | null = null;

/**
 * R1: pin と client storage/memory が一致しない、または pin 維持中に client を落とした状態。
 * requireAccessToken と assertBrowserDataPlaneAligned が fail-closed する。
 * AuthProvider が pin mismatch cleanup / restore 成否で更新する。
 */
let accessTokenPinDataPlaneBlocked = false;

/** C1: pin の user id を requireAccessToken と共有する（null = pin 無し / 未ログイン） */
export function setAccessTokenPinnedUserId(userId: string | null): void {
  accessTokenPinnedUserId = userId;
  // pin 解除時は data plane block も同時に閉じる（ログアウト・soft null と同期）
  if (userId === null) {
    accessTokenPinDataPlaneBlocked = false;
  }
}

/**
 * R1: pin と client の一時乖離中は PostgREST/RPC/Function とも data plane を閉じる。
 * AuthProvider が pin reject / client B 掃除 / restore 成否で立て下ろす。
 */
export function setAccessTokenPinDataPlaneBlocked(blocked: boolean): void {
  accessTokenPinDataPlaneBlocked = blocked;
}

/** R1: data plane が pin により閉じられているか（UI degraded と同期してよい） */
export function isAccessTokenPinDataPlaneBlocked(): boolean {
  return accessTokenPinDataPlaneBlocked;
}

/** テスト専用: pin ゲートを初期化する */
export function resetAccessTokenPinGateForTests(): void {
  accessTokenPinnedUserId = null;
  accessTokenPinDataPlaneBlocked = false;
}

/**
 * C1: session の user が pin と一致するか。pin 無しは常に true。
 * user.id 欠落は不一致扱い（fail-closed）。
 */
function sessionMatchesAccessTokenPin(session: { user?: { id?: string } | null }): boolean {
  if (accessTokenPinnedUserId === null) return true;
  const userId = session.user?.id;
  return typeof userId === "string" && userId === accessTokenPinnedUserId;
}

/**
 * R1: 共有 client の PostgREST/RPC/Realtime が pin と食い違う JWT で走らないようにする事前ゲート。
 * pin 無しは no-op。block 中・session 無し（pin 維持中）・user 不一致は PinMismatch で fail-closed。
 * requireAccessToken と同じ分類（R2: isAuthSessionFailure 外）を返す。
 */
export async function assertBrowserDataPlaneAligned(client: BrowserSupabaseClient): Promise<void> {
  if (accessTokenPinnedUserId === null) return;
  if (accessTokenPinDataPlaneBlocked) {
    throw new AuthSessionPinMismatchError();
  }
  let sessionResult: Awaited<ReturnType<BrowserSupabaseClient["auth"]["getSession"]>>;
  try {
    sessionResult = await withTimeout(
      client.auth.getSession(),
      ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS,
    );
  } catch {
    throw new AuthSessionProbeTimeoutError();
  }
  const { data, error } = sessionResult;
  // pin 維持中に client session が無い = multi-tab 掃除後の data plane 閉鎖。真の未ログインではない。
  if (error !== null || data.session === null) {
    throw new AuthSessionPinMismatchError();
  }
  if (!sessionMatchesAccessTokenPin(data.session)) {
    throw new AuthSessionPinMismatchError();
  }
}

/**
 * Function / PostgREST 向けの Bearer を返す。
 * getSession はローカルキャッシュのみなので、期限切れ直前・期限切れは refreshSession で
 * サーバ側失効（他端末での強制ログアウト等）も検知する。
 * C1/R1: AuthProvider pin 済み user と client session user が食い違うときは token を出さない
 * （multi-tab clobber 後の React-A / Bearer-B を fail-closed）。
 * R2: その拒否は AuthSessionPinMismatchError（isAuthSessionFailure 外）で草稿 wipe しない。
 */
export async function requireAccessToken(client: BrowserSupabaseClient): Promise<string> {
  // R1: AuthProvider が pin 乖離を検知して data plane を閉じている間は Bearer を出さない
  if (accessTokenPinDataPlaneBlocked && accessTokenPinnedUserId !== null) {
    throw new AuthSessionPinMismatchError();
  }

  // AP2: getSession が never-settle でも UI を止めない（AuthProvider cold-start と同型）
  let sessionResult: Awaited<ReturnType<BrowserSupabaseClient["auth"]["getSession"]>>;
  try {
    sessionResult = await withTimeout(
      client.auth.getSession(),
      ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS,
    );
  } catch {
    // C9: hang は期限切れではない。再ログイン誘導せず probe timeout で fail-closed。
    throw new AuthSessionProbeTimeoutError();
  }
  const { data, error } = sessionResult;
  if (error !== null || data.session === null) {
    // R1/R2: pin 維持中の session 欠落は multi-tab cleanup 後の一時乖離。真の未ログインとは分け、
    // 生成の sessionExpired wipe に落とさない。
    if (accessTokenPinnedUserId !== null) {
      throw new AuthSessionPinMismatchError();
    }
    throw new AuthSessionRequiredError();
  }

  const session = data.session;
  // C1/R2: pin と client storage の user が不一致なら Bearer を発行しない（PinMismatch）
  if (!sessionMatchesAccessTokenPin(session)) {
    throw new AuthSessionPinMismatchError();
  }

  // expires_at 欠落・非 number は期限不明とみなし refresh を試みる（C10）
  const needsRefresh =
    typeof session.expires_at !== "number" ||
    session.expires_at * 1000 <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS;

  if (!needsRefresh) {
    return session.access_token;
  }

  // refresh 明示失敗は期限切れ。hang は C9 どおり probe timeout（storage を焼かない）。
  let refreshed: Awaited<ReturnType<BrowserSupabaseClient["auth"]["refreshSession"]>>;
  try {
    refreshed = await withTimeout(client.auth.refreshSession(), ACCESS_TOKEN_REFRESH_TIMEOUT_MS);
  } catch {
    throw new AuthSessionProbeTimeoutError();
  }
  if (refreshed.error !== null || refreshed.data.session === null) {
    throw new AuthSessionExpiredError();
  }
  // C1/R2: refresh 後も pin と一致する token だけ返す（不一致は PinMismatch、失効 wipe しない）
  if (!sessionMatchesAccessTokenPin(refreshed.data.session)) {
    throw new AuthSessionPinMismatchError();
  }
  return refreshed.data.session.access_token;
}

/**
 * 生成 API・Function の認証失敗を「通信断」ではなく再ログイン対象として扱う判定。
 * - AuthSessionRequiredError / AuthSessionExpiredError
 * - Function の closed code `auth_required`
 * - requireAccessToken の日本語メッセージ（後方互換）
 * - AuthSessionProbeTimeoutError / AuthSessionPinMismatchError は含めない
 *   （一時 hang / multi-tab pin 乖離 → offline/retry。false re-login + storage clear を避ける）
 */
export function isAuthSessionFailure(error: unknown): boolean {
  if (error instanceof AuthSessionRequiredError || error instanceof AuthSessionExpiredError) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  // R2: pin mismatch の closed message は auth 失効扱いにしない
  if (error.message === "auth_session_pin_mismatch") return false;
  return error.message === "auth_required" || error.message === "ログインが必要です";
}

/**
 * C12: probe timeout 専用判定。isAuthSessionFailure とは排他（storage clear / 再ログイン誘導しない）。
 * 呼び出し側は offline/retry UX を出し、Authenticated shell が stale になり得ることを示す。
 */
export function isAuthSessionProbeTimeout(error: unknown): boolean {
  if (error instanceof AuthSessionProbeTimeoutError) return true;
  return error instanceof Error && error.message === "auth_session_probe_timeout";
}

/**
 * R2: pin mismatch 専用判定。isAuthSessionFailure とは排他（草稿 wipe / sessionExpired 誘導しない）。
 * 呼び出し側は offline/retry または degraded UX。R1 で data plane は閉じ済み。
 */
export function isAuthSessionPinMismatch(error: unknown): boolean {
  if (error instanceof AuthSessionPinMismatchError) return true;
  return error instanceof Error && error.message === "auth_session_pin_mismatch";
}
