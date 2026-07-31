import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  generationCommandVersionV3,
  newMenuGenerationRequestSchema,
  regenerateMenuRequestSchema,
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

/** 新規献立と献立全体再生成を同一 POST で受け付ける（v3 commandVersion + qualityMode + kind 必須） */
const menuEndpointBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("new_menu"),
      qualityMode: z.boolean(),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV3),
      kind: z.literal("regenerate_menu"),
      qualityMode: z.boolean(),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
]);

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
  // auth 前失敗でも Function log に行を残す相関 ID（PII ではない）
  let correlationId: string = randomUUID();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUserWithEmail(request);
    const command = await parseJson(request, menuEndpointBodySchema);
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
