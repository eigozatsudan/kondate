import type { Config, Context } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GenerationStatusData } from "../../shared/contracts/generation.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { createGenerationRepository } from "./_shared/generation-repository.js";
import { generationResponse, toGenerationStatus } from "./_shared/generation-service.js";
import { handleError, HttpError, methodNotAllowed } from "./_shared/http.js";
import { handleGenerationHttpError, logGenerationHttpBoundary } from "./_shared/logger.js";

const idempotencyKeySchema = z.uuid();

/**
 * status のポーリング洪水を避けるため、終端とエラーのみログする。
 * not_started / processing / succeeded は出さない。
 */
function logTerminalStatusIfNeeded(
  result: GenerationStatusData,
  response: Response,
  startedAtMonotonicMs: number,
): void {
  if (result.status === "failed") {
    logGenerationHttpBoundary({
      route: "status",
      code: result.error.code,
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
    return;
  }
  if (result.status === "constraint_conflict") {
    logGenerationHttpBoundary({
      route: "status",
      code: "constraint_conflict",
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
  }
}

export default async function generationStatus(
  request: Request,
  context?: Context,
): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  let correlationId: string = randomUUID();
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUserWithEmail(request);
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(context?.params.idempotencyKey);
    if (!parsedIdempotencyKey.success) {
      throw new HttpError(400, "invalid_request", "入力内容を確認してください");
    }
    const idempotencyKey = parsedIdempotencyKey.data;
    correlationId = idempotencyKey;
    const record = await createGenerationRepository(user).status(idempotencyKey);
    const result = toGenerationStatus(record, idempotencyKey);
    const response = generationResponse(result);
    logTerminalStatusIfNeeded(result, response, requestStartedAtMonotonicMs);
    return response;
  } catch (error) {
    return handleGenerationHttpError("status", error, {
      startedAtMonotonicMs: requestStartedAtMonotonicMs,
      correlationId,
      handle: handleError,
    });
  }
}

// G16: status GET も menu/dish POST と同型の IP rateLimit（40/180s）。数値は緩めない。
// 通常 1 クライアントの processing 2s poll は Function 総予算（55s）で 28 回、
// platform 60s でも 31 回のため 40 に届かない。終端後は poll 停止。
// 同一 IP の多キー並列・長時間洪水は 429（stale cleanup RPC 抑止）。quota は未変更。
export const config: Config = {
  path: "/api/generations/:idempotencyKey/status",
  method: "GET",
  rateLimit: { windowLimit: 40, windowSize: 180, aggregateBy: ["ip"] },
};
