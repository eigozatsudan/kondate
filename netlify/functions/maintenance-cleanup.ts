/**
 * 境界付きメンテナンス RPC を呼ぶ Function。
 * 公開 path + アプリ層 secret 認証のみ（Netlify の schedule 経路は使わない）。
 * 定期実行は secret 付き HTTP（運用 cron / GitHub Actions 等）から POST する。
 * 成功時は 8 集計 + duration のみを snake_case で safeLog する。
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

/** 手動・cron invoke 用ヘッダ（値が env secret と一致すること）。 */
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
 * アプリ層認可:
 * - 提示 secret が無い（両ヘッダ空）→ 常に 401（env 有無をオラクルにしない）
 * - 提示あり + env 未設定/短すぎ → 403 fail-closed
 * - 提示あり + env あり → カスタムヘッダと Bearer の**いずれか**が一致すれば OK
 *   （片方誤りでも他方が正しければ通す。空文字ヘッダは「未提示」扱い）
 * - 提示あり + どちらも不一致 → 403
 */
export function authorizeMaintenanceCleanup(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "ok" | "unauthorized" | "forbidden" {
  const customRaw = request.headers.get(MAINTENANCE_CRON_SECRET_HEADER);
  const customSecret =
    customRaw === null ? null : customRaw.trim().length > 0 ? customRaw.trim() : null;
  const bearerSecret = bearerToken(request.headers.get("authorization"));

  if (customSecret === null && bearerSecret === null) {
    return "unauthorized";
  }

  const expected = (env[MAINTENANCE_CRON_SECRET_ENV] ?? "").trim();
  if (expected.length < MIN_SECRET_LENGTH) {
    return "forbidden";
  }

  if (customSecret !== null && secretsEqual(customSecret, expected)) {
    return "ok";
  }
  if (bearerSecret !== null && secretsEqual(bearerSecret, expected)) {
    return "ok";
  }
  return "forbidden";
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
  // functions:invoke / テスト互換で省略時は空 Request。
  const req = request ?? new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup");

  // 運用 cron は POST のみ（誤キャッシュ・プリフェッチを避ける）。secret 検査前に閉じる。
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

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

/** HTTP path のみ。定期起動は secret 付き外部 cron（GitHub Actions 等）。 */
export const config: Config = {
  path: "/api/maintenance/cleanup",
  method: "POST",
};
