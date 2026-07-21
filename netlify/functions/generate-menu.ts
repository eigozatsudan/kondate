import type { Config } from "@netlify/functions";
import { newMenuGenerationRequestSchema } from "../../shared/contracts/generation.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, methodNotAllowed, parseJson } from "./_shared/http.js";
import {
  createGenerationDeps,
  generationResponse,
  runGeneration,
} from "./_shared/generation-service.js";

export default async function generateMenu(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const body = await parseJson(request, newMenuGenerationRequestSchema);
    return generationResponse(
      await runGeneration(createGenerationDeps(user, { requestStartedAtMonotonicMs }), {
        kind: "new_menu",
        request: body,
      }),
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
