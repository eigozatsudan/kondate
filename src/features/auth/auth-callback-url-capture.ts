/**
 * C7: OAuth/magic の認可 code は初回ナビゲーション URL に載る。
 * AuthCallbackPage の useEffect より前（main bootstrap）で可視 URL から除き、
 * アドレスバー・history・同一タブ Referer への滞在時間を最短化する。
 *
 * エッジ access log / プロキシログの初回 URL 記録はインフラ管轄でアプリ JS では消せない
 * （netlify.toml の Referrer-Policy: no-referrer は中継 Referer のみ抑止）。
 */

let capturedCallbackUrl: URL | null = null;
let stripApplied = false;

/** capture 対象の認可パラメータ（strip 後 URL との区別用） */
const AUTH_CALLBACK_SECRET_PARAMS = [
  "code",
  "token_hash",
  "access_token",
  "error",
  "error_code",
] as const;

function authCallbackHasSecrets(url: URL): boolean {
  for (const key of AUTH_CALLBACK_SECRET_PARAMS) {
    if (url.searchParams.has(key)) return true;
  }
  // implicit fragment（稀）
  if (url.hash.includes("access_token") || url.hash.includes("code=")) return true;
  return false;
}

/**
 * C-R5: 同一 entry（StrictMode 二重呼び出し）か。flow + 認可系 query が一致すれば同一。
 */
function isSameAuthCallbackEntry(a: URL, b: URL): boolean {
  const keys = [
    "flow",
    "code",
    "state",
    "token_hash",
    "type",
    "error",
    "error_code",
    "error_description",
  ];
  for (const key of keys) {
    if ((a.searchParams.get(key) ?? null) !== (b.searchParams.get(key) ?? null)) return false;
  }
  return a.hash === b.hash;
}

/**
 * C7: `/auth/callback` 以外へ出たら module sticky を解除する。
 * SPA soft-nav 再入場で 2 回目の code を recapture できるようにする。
 * 本番 leave は location.replace 既定でフルリロードするため通常は不要だが、
 * テスト / 将来 router の soft-nav に備える defense-in-depth。
 */
export function resetAuthCallbackUrlCaptureIfLeftCallback(pathname: string): void {
  if (pathname === "/auth/callback" || pathname.startsWith("/auth/callback/")) return;
  capturedCallbackUrl = null;
  stripApplied = false;
}

/**
 * pathname が /auth/callback または /auth/callback/ のとき、code/state 等を history から除き閉包に保持する。
 * 同一 entry では冪等（StrictMode / main+page 二重呼び出し）。
 * C-R5: leave 無しの soft-nav で **別 code/query** が来たら recapture する。
 * callback 外の href では sticky を解除する（C7 SPA 再入場）。
 */
export function captureAndStripAuthCallbackUrl(
  href: string = typeof window !== "undefined" ? window.location.href : "",
  replaceState: (url: string) => void = (url) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", url);
  },
): void {
  if (href === "") return;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  // C10: SW の isAuthCallbackPath と同型。`/auth/callback/` も strip しないと
  // IdP / 手動 URL で code が可視 URL に残る。`/auth/callback/extra` は対象外。
  if (url.pathname !== "/auth/callback" && url.pathname !== "/auth/callback/") {
    // C7: callback 外では sticky を落とし、次の入場で recapture 可能にする
    resetAuthCallbackUrlCaptureIfLeftCallback(url.pathname);
    return;
  }
  if (stripApplied) {
    // strip 済み visible URL（secrets 無し）の再呼び出し → sticky 維持
    if (!authCallbackHasSecrets(url)) return;
    // 同一 entry の二重 capture → 冪等
    if (capturedCallbackUrl !== null && isSameAuthCallbackEntry(capturedCallbackUrl, url)) {
      return;
    }
    // C-R5: 別 code/query の soft-nav 再入場 → recapture
  }
  stripApplied = true;
  capturedCallbackUrl = new URL(url.href);
  const visible = new URL(url.href);
  for (const key of [...visible.searchParams.keys()]) {
    if (key !== "flow") {
      visible.searchParams.delete(key);
    }
  }
  visible.hash = "";
  replaceState(`${visible.pathname}${visible.search}${visible.hash}`);
}

/**
 * completeCallback 用の URL。bootstrap で capture 済みなら code 付き、
 * 未 capture（単体テスト等）なら現在 location を返す。
 */
export function takeCapturedAuthCallbackUrl(
  fallbackHref: string = typeof window !== "undefined" ? window.location.href : "http://127.0.0.1/",
): URL {
  if (capturedCallbackUrl !== null) {
    return new URL(capturedCallbackUrl.href);
  }
  return new URL(fallbackHref);
}

/** テスト専用: モジュール共有 state を隔離する */
export function resetAuthCallbackUrlCaptureForTests(): void {
  capturedCallbackUrl = null;
  stripApplied = false;
}
