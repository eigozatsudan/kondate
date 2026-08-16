/**
 * 開発サーバでは SW を登録しない。HMR と混ぜず、残存 SW の解除もしない。
 * 失敗してもオンライン SPA のまま進める。クエリや例外は残さない。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // 登録失敗はオンライン SPA のまま。クエリや例外メッセージを残さない
  });
}
