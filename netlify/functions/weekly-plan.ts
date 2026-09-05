import type { Config } from "@netlify/functions";
import { weeklyPlanRequestSchema } from "../../shared/contracts/weekly-plan.js";
import { requireUser, requireUserWithEmail } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";
import { getWeeklyPlan, runWeeklyPlan } from "./_shared/weekly-plan-service.js";

const WEEKLY_PLAN_ID_RE = /^\/api\/weekly-plan\/([0-9a-fA-F-]{36})$/u;

/**
 * POST /api/weekly-plan（JSON body、idempotencyKey は body 内）
 * GET /api/weekly-plan/:weeklyPlanId
 */
export default async function weeklyPlan(request: Request): Promise<Response> {
  const requestStartedAtMonotonicMs = performance.now();
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      const match = WEEKLY_PLAN_ID_RE.exec(url.pathname);
      const weeklyPlanId = match?.[1];
      if (weeklyPlanId === undefined) {
        throw new HttpError(404, "not_found", "見つかりませんでした");
      }
      const user = await requireUser(request);
      const result = await getWeeklyPlan(getSupabaseAdmin(), user.userId, weeklyPlanId);
      return json(200, { ok: true, data: result });
    }
    if (request.method === "POST") {
      const user = await requireUserWithEmail(request);
      const body = await parseJson(request, weeklyPlanRequestSchema);
      const result = await runWeeklyPlan(
        {
          user: { userId: user.userId, email: user.email, accessToken: user.accessToken },
          requestStartedAtMonotonicMs,
        },
        body,
      );
      return json(200, { ok: true, data: result });
    }
    return methodNotAllowed(["GET", "POST"]);
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  // Netlify の Config.path は string | string[]。POST 用の集合パスと GET by id を
  // 両方受けるため配列で宣言する。単一 string へ縮退すると POST か GET の
  // どちらかが本番でも 404 になるので禁止（Step 6.5 で E2E 側を配列対応させる）。
  path: ["/api/weekly-plan", "/api/weekly-plan/:weeklyPlanId"],
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 20, windowSize: 180, aggregateBy: ["ip"] },
};
