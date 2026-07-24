/**
 * 本番 Scheduled Function: 毎時 1 回、境界付きメンテナンス RPC を呼ぶ。
 * path なし schedule のみ。直接 URL では呼べない。
 * 成功時は 4 集計 + duration のみを snake_case で safeLog する。
 */
import type { Config } from "@netlify/functions";
import { parseManagedSupabaseProjectRef } from "./_shared/env.js";
import { safeLog } from "./_shared/logger.js";
import { runMaintenance } from "./_shared/maintenance-db.js";
import {
  parseMaintenanceDatabaseEnv,
  selectMaintenanceEnvironmentMode,
} from "./_shared/maintenance-env.js";

export default async function maintenanceCleanup(): Promise<Response> {
  const started = performance.now();
  const deadline = AbortSignal.timeout(25_000);
  const requestId = "maintenance";
  try {
    const mode = selectMaintenanceEnvironmentMode(process.env);
    let connectionString: string;
    if (mode === "local") {
      connectionString = parseMaintenanceDatabaseEnv(process.env, { mode });
    } else {
      const expectedProjectRef = parseManagedSupabaseProjectRef(
        String(process.env.SUPABASE_URL ?? ""),
      );
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
