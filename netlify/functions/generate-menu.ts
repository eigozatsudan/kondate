import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
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

/** 新規献立と献立全体再生成を同一 POST で受け付ける（kind は body 形で判別） */
const menuEndpointBodySchema = z.union([
  newMenuGenerationRequestSchema,
  regenerateMenuRequestSchema,
]);

export default async function generateMenu(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const body = await parseJson(request, menuEndpointBodySchema);
    const command =
      "draftId" in body
        ? { kind: "new_menu" as const, request: body }
        : { kind: "regenerate_menu" as const, request: body };
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
