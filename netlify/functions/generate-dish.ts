import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  generationCommandVersionV3,
  regenerateDishRequestSchema,
  type GenerationStatusData,
} from "../../shared/contracts/generation.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import {
  createGenerationDeps,
  generationResponse,
  runGeneration,
} from "./_shared/generation-service.js";
import { handleError, methodNotAllowed, parseJson } from "./_shared/http.js";
import { readLocalMockScenario } from "./_shared/local-mock-scenario.js";
import { handleGenerationHttpError, logGenerationHttpBoundary } from "./_shared/logger.js";

const dishEndpointBodySchema = z
  .object({
    commandVersion: z.literal(generationCommandVersionV3),
    kind: z.literal("regenerate_dish"),
    qualityMode: z.boolean(),
    request: regenerateDishRequestSchema,
  })
  .strict();

/** failed / constraint_conflict のみ HTTP 境界ログ */
function logTerminalStatusIfNeeded(
  result: GenerationStatusData,
  response: Response,
  startedAtMonotonicMs: number,
): void {
  if (result.status === "failed") {
    logGenerationHttpBoundary({
      route: "dish",
      code: result.error.code,
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
    return;
  }
  if (result.status === "constraint_conflict") {
    logGenerationHttpBoundary({
      route: "dish",
      code: "constraint_conflict",
      durationMs: performance.now() - startedAtMonotonicMs,
      correlationId: result.idempotencyKey,
      httpStatus: response.status,
    });
  }
}

/**
 * POST /api/generations/dish — 料理単位の再生成。
 * 入口時刻を method/auth/body より先に一度だけ取得し、55s 総予算の起点とする。
 */
export default async function generateDish(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  let correlationId: string = randomUUID();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUserWithEmail(request);
    const command = await parseJson(request, dishEndpointBodySchema);
    correlationId = command.request.idempotencyKey;
    const localTestScenario = readLocalMockScenario(request);
    const result = await runGeneration(
      createGenerationDeps(user, {
        requestStartedAtMonotonicMs,
        ...(localTestScenario === undefined ? {} : { localTestScenario }),
      }),
      command,
    );
    const response = generationResponse(result);
    logTerminalStatusIfNeeded(result, response, requestStartedAtMonotonicMs);
    return response;
  } catch (error) {
    return handleGenerationHttpError("dish", error, {
      startedAtMonotonicMs: requestStartedAtMonotonicMs,
      correlationId,
      handle: handleError,
    });
  }
}

// IP 単位の外側 flood 制御のみ。利用者別 4/600s は PostgreSQL が権威。
export const config: Config = {
  path: "/api/generations/dish",
  method: "POST",
  rateLimit: { windowLimit: 40, windowSize: 180, aggregateBy: ["ip"] },
};
