/**
 * Host allowlist: 127.0.0.1:PORT と localhost:PORT のみ。
 * ポートは config.port と一致させる。
 */
import type { Context, Next } from "hono";
import { hostRejected } from "../errors.js";

export function createHostGuard(port: number) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return async function hostGuard(c: Context, next: Next): Promise<Response | void> {
    const host = c.req.header("host");
    if (!host || !allowed.has(host)) {
      const err = hostRejected();
      return c.json({ ok: false, error: err.body }, err.httpStatus as 400);
    }
    await next();
  };
}
