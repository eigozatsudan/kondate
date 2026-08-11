/**
 * Hono アプリ本体。
 * Host allowlist・GET のみ・optional Bearer・health を載せる。
 * 業務ルートは Task 6 で registerApiRoutes 経由で接続する。
 */
import { Hono } from "hono";
import type { Pool } from "pg";
import type { AdminConfig } from "./config.js";
import { AdminClosedError, internalError } from "./errors.js";
import { createHostGuard } from "./middleware/host.js";
import { apiGetOnly } from "./middleware/method.js";
import { createTokenGuard } from "./middleware/token.js";
import { healthHandler } from "./routes/health.js";
import { registerApiRoutes } from "./routes/register.js";

export type CreateAppDeps = {
  pool: Pool | null;
  config: AdminConfig;
  /** 起動検証済みなら true。health の degraded 表示に使う */
  dbReady?: boolean;
  sessionUser?: string | null;
  /** テスト用: false で業務 API を載せない */
  mountApiRoutes?: boolean;
  /** テスト用 override */
  registerRoutes?: (app: Hono, deps: CreateAppDeps) => void;
};

export function createApp(deps: CreateAppDeps): Hono {
  const app = new Hono();
  const dbReady = deps.dbReady ?? false;
  const sessionUser = deps.sessionUser ?? null;

  app.use("*", createHostGuard(deps.config.port));
  app.use("*", apiGetOnly);
  app.use(
    "*",
    createTokenGuard({
      localToken: deps.config.localToken,
      healthOpen: true,
    }),
  );

  app.get(
    "/api/health",
    healthHandler({
      config: deps.config,
      dbReady,
      sessionUser,
    }),
  );

  if (deps.registerRoutes) {
    deps.registerRoutes(app, deps);
  } else if (deps.mountApiRoutes !== false) {
    registerApiRoutes(app, {
      pool: deps.pool,
      config: deps.config,
      sessionUser,
    });
  }

  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/")) {
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: "リソースが見つかりません。" },
        },
        404,
      );
    }
    return c.text("Not Found", 404);
  });

  app.onError((err, c) => {
    if (err instanceof AdminClosedError) {
      return c.json(
        { ok: false, error: err.body },
        err.httpStatus as 400 | 401 | 404 | 405 | 500,
      );
    }
    const closed = internalError();
    return c.json({ ok: false, error: closed.body }, 500);
  });

  return app;
}
