import type { Context } from "hono";
import { AdminClosedError, internalError } from "../errors.js";

export function ok<T>(c: Context, data: T, status: 200 = 200) {
  return c.json({ ok: true as const, data }, status);
}

export function fail(c: Context, err: unknown) {
  if (err instanceof AdminClosedError) {
    return c.json(
      { ok: false as const, error: err.body },
      err.httpStatus as 400 | 401 | 404 | 405 | 500,
    );
  }
  const closed = internalError();
  return c.json({ ok: false as const, error: closed.body }, 500);
}
