import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import type { GenerationStatusData } from "../../shared/contracts/generation.js";
import { GENERATION_REQUEST_HARD_DEADLINE_MS } from "../../shared/contracts/function-budget.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import {
  createGenerationDeps,
  generationResponse,
  reserveGeneration,
  toGenerationStatus,
  toReservedGenerationStatus,
} from "./_shared/generation-service.js";
import { handleError, methodNotAllowed, parseJson } from "./_shared/http.js";
import { runWithRequestDeadline } from "./_shared/request-deadline.js";
import { readLocalMockScenario } from "./_shared/local-mock-scenario.js";
import { handleGenerationHttpError, logGenerationHttpBoundary } from "./_shared/logger.js";

import { menuEndpointBodySchema } from "./_shared/menu-generation-command.js";
import { dispatchMenuGeneration } from "./_shared/menu-background.js";

/** failed / constraint_conflict のみ HTTP 境界ログ（成功・processing は出さない） */
function logTerminalStatusIfNeeded(
  result: GenerationStatusData,
  response: Response,
  startedAtMonotonicMs: number,
): void {
  if (result.status === "failed") {
    logGenerationHttpBoundary({
      route: "menu",
      code: result.error.code,
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
    return;
  }
  if (result.status === "constraint_conflict") {
    logGenerationHttpBoundary({
      route: "menu",
      code: "constraint_conflict",
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
  }
}

export default async function generateMenu(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  // 26s 予算の外側に hard deadline を張り、止まった Supabase HTTP で実効 30s 無ログ切断にしない
  return await runWithRequestDeadline(
    requestStartedAtMonotonicMs + GENERATION_REQUEST_HARD_DEADLINE_MS,
    () => handleGenerateMenu(request, requestStartedAtMonotonicMs),
  );
}

async function handleGenerateMenu(
  request: Request,
  requestStartedAtMonotonicMs: number,
): Promise<Response> {
  // auth 前失敗でも Function log に行を残す相関 ID（PII ではない）
  let correlationId: string = randomUUID();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUserWithEmail(request);
    const command = await parseJson(request, menuEndpointBodySchema);
    correlationId = command.request.idempotencyKey;
    const localTestScenario = readLocalMockScenario(request);
    const deps = createGenerationDeps(user, {
      requestStartedAtMonotonicMs,
      ...(localTestScenario === undefined ? {} : { localTestScenario }),
    });
    const reserved = await reserveGeneration(deps, command);
    const result =
      reserved.status === "failed" && reserved.failure_code === "generation_in_progress"
        ? toReservedGenerationStatus(reserved, command.request.idempotencyKey)
        : toGenerationStatus(
            await deps.repository.status(command.request.idempotencyKey),
            command.request.idempotencyKey,
          );
    if (result.status === "processing") {
      await dispatchMenuGeneration(user, command, result.requestId, localTestScenario);
    }
    const response = generationResponse(result);
    logTerminalStatusIfNeeded(result, response, requestStartedAtMonotonicMs);
    return response;
  } catch (error) {
    return handleGenerationHttpError("menu", error, {
      startedAtMonotonicMs: requestStartedAtMonotonicMs,
      correlationId,
      handle: handleError,
    });
  }
}

// IP 単位の外側 flood 制御のみ。利用者別 4/600s は PostgreSQL が権威。
export const config: Config = {
  path: "/api/generations/menu",
  method: "POST",
  rateLimit: { windowLimit: 40, windowSize: 180, aggregateBy: ["ip"] },
};
