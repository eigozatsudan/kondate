import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const weeklyPlanIdSchema = z.uuid();

export function latestWeeklyPlanQueryKey(userId: string, weekStartJst: string) {
  return ["weekly-plan", "latest", userId, weekStartJst] as const;
}

/** RLS と所有者条件の両方で、現在週に作成された最新の週献立だけを読む。 */
export async function getLatestWeeklyPlanId(
  userId: string,
  weekStartJst: string,
): Promise<string | null> {
  const { data, error } = await getBrowserSupabaseClient()
    .from("weekly_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStartJst)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) throw new Error("今週の献立を確認できませんでした");
  if (data === null) return null;
  return weeklyPlanIdSchema.parse(data.id);
}

export function useLatestWeeklyPlan(userId: string, weekStartJst: string) {
  return useQuery({
    queryKey: latestWeeklyPlanQueryKey(userId, weekStartJst),
    queryFn: () => getLatestWeeklyPlanId(userId, weekStartJst),
    enabled: userId.length > 0 && weekStartJst.length > 0,
  });
}
