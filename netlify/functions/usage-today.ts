import type { Config } from "@netlify/functions";
import { usageTodayDataSchema } from "../../shared/contracts/generation.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, json, methodNotAllowed } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/**
 * 生成行を作らず、当日の成功 / 外部 attempt / 短期窓 / 全体受付を返す。
 * 台帳への insert は行わない。
 */
export default async function usageToday(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUser(request);
    const { data, error } = await getSupabaseAdmin().rpc("get_ai_usage_today", {
      p_user_id: user.userId,
    });
    if (error !== null) throw error;
    const parsed = usageTodayDataSchema.parse(data);
    return json(200, { ok: true, data: parsed });
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/usage/today",
  method: "GET",
};
