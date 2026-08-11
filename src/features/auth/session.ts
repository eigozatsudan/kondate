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
 * Function / PostgREST 向けの Bearer を返す。
 * getSession はローカルキャッシュのみなので、期限切れ直前・期限切れは refreshSession で
 * サーバ側失効（他端末での強制ログアウト等）も検知する。
 */
export async function requireAccessToken(client: BrowserSupabaseClient): Promise<string> {
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
  if (error !== null || data.session === null) throw new AuthSessionRequiredError();

  const session = data.session;
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
  return refreshed.data.session.access_token;
}

/**
 * 生成 API・Function の認証失敗を「通信断」ではなく再ログイン対象として扱う判定。
 * - AuthSessionRequiredError / AuthSessionExpiredError
 * - Function の closed code `auth_required`
 * - requireAccessToken の日本語メッセージ（後方互換）
 * - AuthSessionProbeTimeoutError は含めない（一時 hang → offline/retry）
 */
export function isAuthSessionFailure(error: unknown): boolean {
  if (error instanceof AuthSessionRequiredError || error instanceof AuthSessionExpiredError) {
    return true;
  }
  if (!(error instanceof Error)) return false;
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
