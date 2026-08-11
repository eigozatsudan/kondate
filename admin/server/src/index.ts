/**
 * admin サーバ入口。
 * 起動検証 → listen。静的は client production build を同一 origin で配信する。
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, connectionHostLabel } from "./config.js";
import { createPool, runStartupDbChecks } from "./db.js";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  if (config.localToken === null) {
    // 秘密は出さない。運用注意のみ
    console.warn(
      "[admin] ADMIN_LOCAL_TOKEN が未設定です。単一オペレータ・非共有 PC でのみ起動してください。",
    );
  }

  const pool = createPool(config);
  await runStartupDbChecks(pool);

  const sessionUser = "kondate_ops_readonly";
  const app = createApp({
    pool,
    config,
    dbReady: true,
    sessionUser,
  });

  // client dist（package root から dist/client）
  const clientRoot = join(process.cwd(), "dist/client");
  if (!existsSync(clientRoot)) {
    console.warn(
      "[admin] dist/client がありません。API のみ起動します（本番 Docker では build 済み想定）。",
    );
  } else {
    app.use(
      "/*",
      serveStatic({
        root: "./dist/client",
      }),
    );
    // SPA フォールバック（API 以外）
    app.get("*", async (c, next) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith("/api/")) {
        return next();
      }
      return serveStatic({ path: "./dist/client/index.html" })(c, next);
    });
  }

  // 接続先表示用（userinfo 無し）
  const hostLabel = connectionHostLabel(config.databaseUrl);
  console.info(
    `[admin] listening on ${config.bindHost}:${config.port} (db host=${hostLabel}, session_user=${sessionUser})`,
  );

  serve({
    fetch: app.fetch,
    hostname: config.bindHost,
    port: config.port,
  });
}

main().catch((err: unknown) => {
  // URL / パスワードをログに出さない
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "startup_failed";
  console.error(`[admin] startup failed: ${code}`);
  process.exit(1);
});
