/**
 * 共有一般化 worker（Task 7a: claim のみ。Pass / AI 段は 7c 以降）。
 * path なし schedule。アプリ層 secret で認可（maintenance-cleanup と同型の S3）。
 * ログは claim 件数のみ。job 本文・menu 名・プロンプトは出さない。
 */
import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { safeLog } from "./_shared/logger.js";
import { claimShareGeneralizationJobs } from "./_shared/share-claim.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/** 共有 worker secret の env 名（local .env / 本番 Netlify secret）。 */
export const SHARE_WORKER_CRON_SECRET_ENV = "SHARE_WORKER_CRON_SECRET";

/** 手動・local invoke 用ヘッダ。 */
export const SHARE_WORKER_CRON_SECRET_HEADER = "x-share-worker-cron-secret";

const MIN_SECRET_LENGTH = 16;

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
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
 * - env SHARE_WORKER_CRON_SECRET 必須（短すぎ = 403）
 * - header / Bearer 一致、または x-netlify-event: schedule + env secret
 */
export function authorizeShareGeneralizeWorker(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): "ok" | "unauthorized" | "forbidden" {
  const expected = (env[SHARE_WORKER_CRON_SECRET_ENV] ?? "").trim();
  if (expected.length < MIN_SECRET_LENGTH) {
    return "forbidden";
  }

  const headerSecret =
    request.headers.get(SHARE_WORKER_CRON_SECRET_HEADER)?.trim() ??
    bearerToken(request.headers.get("authorization"));

  if (headerSecret !== null && headerSecret.length > 0) {
    return secretsEqual(headerSecret, expected) ? "ok" : "forbidden";
  }

  const netlifyEvent = request.headers.get("x-netlify-event")?.trim().toLowerCase();
  if (netlifyEvent === "schedule") {
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
    kind === "unauthorized"
      ? "share_generalize_worker_unauthorized"
      : "share_generalize_worker_forbidden";
  safeLog({
    level: "warn",
    requestId,
    code,
    durationMs: Math.round(performance.now() - started),
  });
  return new Response(null, { status: kind === "unauthorized" ? 401 : 403 });
}

export default async function shareGeneralizeWorker(request?: Request): Promise<Response> {
  const started = performance.now();
  const requestId = "share-worker";
  const req = request ?? new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker");

  const auth = authorizeShareGeneralizeWorker(req);
  if (auth !== "ok") {
    return authDeniedResponse(auth, started, requestId);
  }

  try {
    // Task 7a: claim のみ。AI / publish は後続 Task。
    const admin = getSupabaseAdmin();
    const jobs = await claimShareGeneralizationJobs({ admin });
    safeLog({
      level: "info",
      requestId,
      code: "share_generalize_worker_claim",
      durationMs: Math.round(performance.now() - started),
      // 件数のみ。jobId 配列や menu は載せない（7d で閉じたフィールドを拡張）
      candidateCount: jobs.length,
    });
    return new Response(null, { status: 204 });
  } catch {
    safeLog({
      level: "error",
      requestId,
      code: "share_generalize_worker_failed",
      durationMs: Math.round(performance.now() - started),
    });
    return new Response(null, { status: 500 });
  }
}

export const config: Config = { schedule: "@hourly" };
