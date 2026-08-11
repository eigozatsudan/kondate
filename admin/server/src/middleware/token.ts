/**
 * ADMIN_LOCAL_TOKEN が設定されているとき、/api/* に Bearer を要求する。
 * /api/health は任意で免除可能。
 */
import type { Context, Next } from "hono";
import { unauthorized } from "../errors.js";

export function createTokenGuard(opts: {
  localToken: string | null;
  /** true のとき /api/health はトークン不要 */
  healthOpen: boolean;
}) {
  return async function tokenGuard(c: Context, next: Next): Promise<Response | void> {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/api/")) {
      await next();
      return;
    }
    if (opts.healthOpen && (path === "/api/health" || path === "/api/health/")) {
      await next();
      return;
    }
    if (opts.localToken === null) {
      await next();
      return;
    }
    const auth = c.req.header("authorization");
    const expected = `Bearer ${opts.localToken}`;
    if (auth !== expected) {
      const err = unauthorized();
      return c.json({ ok: false, error: err.body }, err.httpStatus as 401);
    }
    await next();
  };
}
