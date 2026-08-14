/**
 * admin サーバ入口。
 * 起動検証 → listen。静的は client production build を同一 origin で配信する。
 * 静的配信は root 封じ込め付き（safe-static）で、bare serveStatic に依存しない。
 */
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, connectionHostLabel } from "./config.js";
import { createPool, runStartupDbChecks } from "./db.js";
import { createApp } from "./app.js";
import { createSafeStaticMiddleware, createSpaFallbackMiddleware } from "./lib/safe-static.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  if (config.localToken === null) {
    // 秘密は出さない。業務 API は register 側で未登録
    console.warn(
      "[admin] ADMIN_LOCAL_TOKEN が未設定です。業務 API は無効です。単一オペレータ・非共有 PC でのみ起動してください。",
    );
  }

  const pool = createPool(config);
  // 起動 canary が返した実 session_user を health / dashboard 表示に使う（hardcode しない）
  const { sessionUser } = await runStartupDbChecks(pool);

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
    app.use("/*", createSafeStaticMiddleware(clientRoot));
    // SPA フォールバック（API 以外・root 内 index.html のみ）
    app.get("*", createSpaFallbackMiddleware(clientRoot));
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
