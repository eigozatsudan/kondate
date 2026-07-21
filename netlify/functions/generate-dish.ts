import type { Config } from "@netlify/functions";
import { regenerateDishRequestSchema } from "../../shared/contracts/generation.js";
import { requireUser } from "./_shared/auth.js";
import {
  createGenerationDeps,
  generationResponse,
  runGeneration,
} from "./_shared/generation-service.js";
import { handleError, methodNotAllowed, parseJson } from "./_shared/http.js";

/**
 * POST /api/generations/dish — 料理単位の再生成。
 * 入口時刻を method/auth/body より先に一度だけ取得し、50s 予算の起点とする。
 */
export default async function generateDish(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const body = await parseJson(request, regenerateDishRequestSchema);
    const result = await runGeneration(
      createGenerationDeps(user, { requestStartedAtMonotonicMs }),
      {
        kind: "regenerate_dish",
        request: body,
      },
    );
    return generationResponse(result);
  } catch (error) {
    return handleError(error);
  }
}

// IP 単位の外側 flood 制御のみ。利用者別 4/600s は PostgreSQL が権威。
export const config: Config = {
  path: "/api/generations/dish",
  method: "POST",
  rateLimit: { windowLimit: 40, windowSize: 180, aggregateBy: ["ip"] },
};
