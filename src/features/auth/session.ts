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

/** 期限切れ N 秒前から refresh を試み、失効を早めに検知する */
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;

/**
 * refreshSession の上限。半開き回線で never-settle すると生成 UI が固着する（A1）。
 * 短すぎると遅い回線で誤失効、長すぎるとスピナーが残る。
 */
export const ACCESS_TOKEN_REFRESH_TIMEOUT_MS = 5_000;

/**
 * Function / PostgREST 向けの Bearer を返す。
 * getSession はローカルキャッシュのみなので、期限切れ直前・期限切れは refreshSession で
 * サーバ側失効（他端末での強制ログアウト等）も検知する。
 */
export async function requireAccessToken(client: BrowserSupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error !== null || data.session === null) throw new AuthSessionRequiredError();

  const session = data.session;
  const expiresAtMs =
    typeof session.expires_at === "number" ? session.expires_at * 1000 : undefined;
  const needsRefresh =
    expiresAtMs !== undefined && expiresAtMs <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS;

  if (!needsRefresh) {
    return session.access_token;
  }

  // hang / 失敗はいずれも再ログイン対象（offline 永久待ちにしない）
  let refreshed: Awaited<ReturnType<BrowserSupabaseClient["auth"]["refreshSession"]>>;
  try {
    refreshed = await withTimeout(client.auth.refreshSession(), ACCESS_TOKEN_REFRESH_TIMEOUT_MS);
  } catch {
    throw new AuthSessionExpiredError();
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
 */
export function isAuthSessionFailure(error: unknown): boolean {
  if (error instanceof AuthSessionRequiredError || error instanceof AuthSessionExpiredError) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  return error.message === "auth_required" || error.message === "ログインが必要です";
}
