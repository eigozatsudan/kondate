import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import type { WeeklyPlanHistoryRow } from "./components/weekly-plan-history-card.js";

const preferenceSnapshotSchema = z.object({ targetMemberIds: z.array(z.uuid()) });

const weeklyPlanHistoryRowSchema = z.object({
  id: z.uuid(),
  week_start: z.string(),
  created_at: z.string(),
  preference_snapshot: preferenceSnapshotSchema,
});

export function weeklyPlanHistoryQueryKey(userId: string) {
  return ["weekly-plan", "history", userId] as const;
}

/** 履歴タブ用。RLS と明示的な user_id 条件の両方で自分の週献立だけを、新しい順に読む。 */
export async function listWeeklyPlanHistory(
  userId: string,
): Promise<readonly WeeklyPlanHistoryRow[]> {
  const { data, error } = await getBrowserSupabaseClient()
    .from("weekly_plans")
    .select("id, week_start, created_at, preference_snapshot")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error("週献立の履歴を読み込めませんでした");
  return data.map((row) => weeklyPlanHistoryRowSchema.parse(row));
}

export function useWeeklyPlanHistory(userId: string | undefined) {
  return useQuery({
    queryKey: weeklyPlanHistoryQueryKey(userId ?? "missing"),
    queryFn: () => listWeeklyPlanHistory(userId ?? ""),
    enabled: userId !== undefined,
  });
}
