import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/shared/types/database";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { withTimeout } from "./async-timeout";
import { isAuthSelfReturnPath, sanitizeReturnPath } from "./auth-flow";
import { clearLocalAuthAndDrafts } from "./auth-cleanup";

/** 二重 replace を避ける（並列 401 や POST+GET 同時失敗用） */
let redirectInFlight = false;

/**
 * cleanup 全体の上限。signOut timeout 後の storage 掃除は同期なので、
 * 実質は signOut 上限 + 余裕。ここを超えても必ず location.replace する（A2）。
 */
export const SESSION_EXPIRY_CLEANUP_TIMEOUT_MS = 5_000;

export type RedirectToLoginForExpiredSessionOptions = {
  /** 再ログイン後の復帰先。未指定なら現在 path+search を安全化する */
  returnTo?: string;
  client?: SupabaseClient<Database>;
  /** テスト用: location.replace の差し替え */
  replaceLocation?: (url: string) => void;
  /** テスト用: cleanup 上限の差し替え */
  cleanupTimeoutMs?: number;
};

/**
 * セッション失効時に端末の認証キャッシュを消し、再ログイン画面へフル遷移する。
 * RequireSession の navigate 競合を避けるため window.location.replace を使う（ログアウトと同型）。
 * cleanup が hang しても replace は必ず実行する。
 */
export async function redirectToLoginForExpiredSession(
  options: RedirectToLoginForExpiredSessionOptions = {},
): Promise<void> {
  if (redirectInFlight) return;
  redirectInFlight = true;

  const client = options.client ?? getBrowserSupabaseClient();
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? SESSION_EXPIRY_CLEANUP_TIMEOUT_MS;

  // URL は cleanup 前に確定（cleanup hang でも returnTo を失わない）
  const rawReturnTo =
    options.returnTo ??
    (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/");
  const returnTo = sanitizeReturnPath(rawReturnTo);
  const params = new URLSearchParams({ sessionExpired: "1" });
  // /login・/auth/callback 自己参照や welcome 既定は returnTo に載せない（C1 / 旧 C7）
  if (returnTo !== "/welcome" && !isAuthSelfReturnPath(returnTo)) {
    params.set("returnTo", returnTo);
  }
  const url = `/login?${params.toString()}`;
  const replace =
    options.replaceLocation ??
    ((href: string) => {
      window.location.replace(href);
    });

  try {
    try {
      await withTimeout(clearLocalAuthAndDrafts(client), cleanupTimeoutMs);
    } catch {
      // timeout / storage 例外でもログイン画面へ進める
    }
    replace(url);
  } finally {
    // C9: replace 成功・noop・throw のいずれでも解除。埋め込み WebView で文書が残る場合の
    // 永久 no-op を防ぐ。並列中の 2 本目は in-flight 中のみ抑止する。
    redirectInFlight = false;
  }
}

/** テスト専用: in-flight ガードを戻す */
export function resetSessionExpiryRedirectForTests(): void {
  redirectInFlight = false;
}
