/**
 * 本番 Scheduled Function: 毎時 1 回、境界付きメンテナンス RPC を呼ぶ。
 * path なし schedule のみ。加えてアプリ層で secret 認証する（S3）。
 * 成功時は 9 集計（stale/ledgers/shopping/auth/feedback/drafts/identity/flyer/share-reaper）+ duration のみを snake_case で safeLog する。
 */
import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { parseManagedSupabaseProjectRef } from "./_shared/env.js";
import { safeLog } from "./_shared/logger.js";
import { runMaintenance } from "./_shared/maintenance-db.js";
import {
  parseMaintenanceDatabaseEnv,
  selectMaintenanceEnvironmentMode,
} from "./_shared/maintenance-env.js";

/** 共有 secret の env 名。local は generate-local-secrets / .env、本番は Netlify secret。 */
export const MAINTENANCE_CRON_SECRET_ENV = "MAINTENANCE_CRON_SECRET";

/** 手動・local invoke 用ヘッダ（値が env secret と一致すること）。 */
export const MAINTENANCE_CRON_SECRET_HEADER = "x-maintenance-cron-secret";

/** 最低長（短すぎる secret は設定漏れとみなし fail-closed）。 */
const MIN_SECRET_LENGTH = 16;

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

function bearerToken(authorization: string | null): string | null {
  if (authorization === null) return null;
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * アプリ層認可（S3）:
 * - env の MAINTENANCE_CRON_SECRET は常に必須（未設定・短すぎ = 403 fail-closed）
 * - 次のいずれかで通す（header/secret 二重化）:
 *   1) `x-maintenance-cron-secret` または Authorization Bearer が secret と一致
 *   2) Netlify schedule 起動（`x-netlify-event: schedule`）かつ secret が env に設定済み
 *      （プラットフォーム schedule は custom secret ヘッダを送れないため、event ヘッダ + env secret で二重化）
 * - 無ヘッダ/無 schedule = 401、誤 secret = 403
 */
export function authorizeMaintenanceCleanup(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "ok" | "unauthorized" | "forbidden" {
  const expected = (env[MAINTENANCE_CRON_SECRET_ENV] ?? "").trim();
  if (expected.length < MIN_SECRET_LENGTH) {
    return "forbidden";
  }

  const headerSecret =
    request.headers.get(MAINTENANCE_CRON_SECRET_HEADER)?.trim() ??
    bearerToken(request.headers.get("authorization"));

  if (headerSecret !== null && headerSecret.length > 0) {
    return secretsEqual(headerSecret, expected) ? "ok" : "forbidden";
  }

  const netlifyEvent = request.headers.get("x-netlify-event")?.trim().toLowerCase();
  if (netlifyEvent === "schedule") {
    // schedule ヘッダ + env secret 必須（上で長さ検証済み）= 二重化
    return "ok";
  }

  return "unauthorized";
}

function authDeniedResponse(
  kind: "unauthorized" | "forbidden",
  started: number,
  requestId: string,
): Response {
  const code =
    kind === "unauthorized" ? "maintenance_cleanup_unauthorized" : "maintenance_cleanup_forbidden";
  safeLog({
    level: "warn",
    requestId,
    code,
    durationMs: Math.round(performance.now() - started),
  });
  return new Response(null, { status: kind === "unauthorized" ? 401 : 403 });
}

export default async function maintenanceCleanup(request?: Request): Promise<Response> {
  const started = performance.now();
  const deadline = AbortSignal.timeout(25_000);
  const requestId = "maintenance";
  // Netlify schedule / functions:invoke は Request を渡す。テスト互換で省略時は空 Request。
  const req = request ?? new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup");

  const auth = authorizeMaintenanceCleanup(req);
  if (auth !== "ok") {
    return authDeniedResponse(auth, started, requestId);
  }

  try {
    const mode = selectMaintenanceEnvironmentMode(process.env);
    let connectionString: string;
    if (mode === "local") {
      connectionString = parseMaintenanceDatabaseEnv(process.env, { mode });
    } else {
      const expectedProjectRef = parseManagedSupabaseProjectRef(process.env.SUPABASE_URL ?? "");
      if (expectedProjectRef === null) throw new Error("supabase_project_invalid");
      connectionString = parseMaintenanceDatabaseEnv(process.env, {
        mode,
        expectedProjectRef,
      });
    }
    const counts = await runMaintenance({
      connectionString,
      now: new Date().toISOString(),
      batchSize: 250,
      signal: deadline,
    });
    safeLog({
      level: "info",
      requestId,
      code: "maintenance_cleanup",
      durationMs: Math.round(performance.now() - started),
      staleReservationsFinalized: counts.staleReservationsFinalized,
      generationLedgersDeleted: counts.generationLedgersDeleted,
      shoppingMutationsDeleted: counts.shoppingMutationsDeleted,
      authContinuationsDeleted: counts.authContinuationsDeleted,
      userFeedbackDeleted: counts.userFeedbackDeleted,
      draftSubmissionsDeleted: counts.draftSubmissionsDeleted,
      identityLedgersDeleted: counts.identityLedgersDeleted,
      flyerLedgersDeleted: counts.flyerLedgersDeleted,
      staleShareJobsReaped: counts.staleShareJobsReaped,
    });
    return new Response(null, { status: 204 });
  } catch {
    safeLog({
      level: "error",
      requestId,
      code: "maintenance_cleanup_failed",
      durationMs: Math.round(performance.now() - started),
    });
    return new Response(null, { status: 500 });
  }
}

export const config: Config = { schedule: "@hourly" };
