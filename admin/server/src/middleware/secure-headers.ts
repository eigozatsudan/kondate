/**
 * AO6 / A8: loopback 運用 UI でも iframe 埋め込みと MIME 嗅ぎ分けを閉じる。
 * Host ガードは iframe 先 Host を通すため、XFO / CSP frame-ancestors と nosniff を全応答に付ける。
 * Cache-Control: no-store は共有キャッシュに feedback / preview が残る余地を潰す。
 * script-src は 'self' のみ。inline は足さず、既存 Vite 外部 script を壊さない。
 */
import type { Context, Next } from "hono";

/** 静的・API・エラー応答で同じヘッダを付ける。 */
export function applyAdminSecurityHeaders(c: Context): void {
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "frame-ancestors 'none'; script-src 'self'");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
}

export async function adminSecureHeaders(c: Context, next: Next): Promise<void> {
  applyAdminSecurityHeaders(c);
  await next();
}
