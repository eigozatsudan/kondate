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

/**
 * pathname が /auth/callback のときだけ、code/state 等を history から除き閉包に保持する。
 * 冪等。main とページ側の二重呼び出しに耐える。
 */
export function captureAndStripAuthCallbackUrl(
  href: string = typeof window !== "undefined" ? window.location.href : "",
  replaceState: (url: string) => void = (url) => {
    if (typeof window === "undefined") return;
    window.history.replaceState(window.history.state, "", url);
  },
): void {
  if (stripApplied) return;
  if (href === "") return;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.pathname !== "/auth/callback") return;
  stripApplied = true;
  // 初回だけ完全 URL を保持（StrictMode 二重読取でも同じ code を completeCallback へ渡す）
  if (capturedCallbackUrl === null) {
    capturedCallbackUrl = new URL(url.href);
  }
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
