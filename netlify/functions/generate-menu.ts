import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  generationCommandVersionV2,
  newMenuGenerationRequestSchema,
  regenerateMenuRequestSchema,
} from "../../shared/contracts/generation.js";
import { requireUser } from "./_shared/auth.js";
import {
  createGenerationDeps,
  generationResponse,
  runGeneration,
} from "./_shared/generation-service.js";
import { handleError, methodNotAllowed, parseJson } from "./_shared/http.js";
import { readLocalMockScenario } from "./_shared/local-mock-scenario.js";

/** 新規献立と献立全体再生成を同一 POST で受け付ける（v2 commandVersion + kind 必須） */
const menuEndpointBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("new_menu"),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("regenerate_menu"),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
]);

export default async function generateMenu(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const command = await parseJson(request, menuEndpointBodySchema);
    const localTestScenario = readLocalMockScenario(request);
    return generationResponse(
      await runGeneration(
        createGenerationDeps(user, {
          requestStartedAtMonotonicMs,
          ...(localTestScenario === undefined ? {} : { localTestScenario }),
        }),
        command,
      ),
    );
  } catch (error) {
    return handleError(error);
  }
}

// IP 単位の外側 flood 制御のみ。利用者別 4/600s は PostgreSQL が権威。
export const config: Config = {
  path: "/api/generations/menu",
  method: "POST",
  rateLimit: { windowLimit: 40, windowSize: 180, aggregateBy: ["ip"] },
};
