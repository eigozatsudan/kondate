/**
 * /api/* は GET / HEAD のみ。それ以外は 405。
 */
import type { Context, Next } from "hono";
import { methodNotAllowed } from "../errors.js";

export async function apiGetOnly(c: Context, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith("/api/")) {
    await next();
    return;
  }
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const err = methodNotAllowed();
    return c.json({ ok: false, error: err.body }, err.httpStatus as 405);
  }
  await next();
}
