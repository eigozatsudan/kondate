/**
 * react-router のブラウザ履歴（createBrowserRouter）が `window.history.state.idx` に積む、
 * タブ内での entry の通し番号を読む。
 *
 * - react-router 8.3 の getUrlBasedHistory は、push で idx + 1、replace で同じ idx を書き、
 *   popstate では移った先の entry の idx と直前の idx の差を delta にする。
 * - memory router（テスト）や、react-router 以外が書いた state では idx が無いので null を返す。
 *   呼び出し側は null を「分からない」として従来どおりの挙動に倒す。
 */
export function readHistoryIndex(): number | null {
  if (typeof window === "undefined") return null;
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("idx" in state)) return null;
  const idx: unknown = state.idx;
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
}
