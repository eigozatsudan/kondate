/**
 * ADMIN_LOCAL_TOKEN が設定されているとき、/api/* に Bearer を要求する。
 * /api/health は任意で免除可能。
 * ADM5: 比較は timingSafeEqual。短すぎる token は loadConfig 側で拒否する。
 */
import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { unauthorized } from "../errors.js";

/** ADM5: 低エントロピー token を拒否する最低長（maintenance secret と同尺）。 */
export const ADMIN_LOCAL_TOKEN_MIN_LENGTH = 16;

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // 長さ不一致でも 1 回比較相当の仕事をさせて単純な時間差を均す
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function bearerToken(authorization: string | null | undefined): string | null {
  if (authorization === null || authorization === undefined) return null;
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

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
    const provided = bearerToken(c.req.header("authorization"));
    if (provided === null || !secretsEqual(provided, opts.localToken)) {
      const err = unauthorized();
      return c.json({ ok: false, error: err.body }, err.httpStatus as 401);
    }
    await next();
  };
}
