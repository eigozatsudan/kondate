import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { listHouseholdMembers } from "@/features/household/household-api";
import { loadHouseholdSafetyMembers } from "@/features/planner/planner-safety-data";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";

export type WeeklyPlanEligibility = {
  members: readonly PlannerSafetyMember[];
  /**
   * 週献立では満たせない対象（cut_small のみ判定）。
   * 年齢帯の requires_tag ルールは shared/safety 側にあり、ブラウザから import
   * できないためここでは判定しない。該当メンバーはサーバの 422
   * weekly_plan_unsatisfiable_member で止まり、既存の WeeklyPlanApiError
   * ハンドリングがそのままエラーを表示する（controller裁定）。
   */
  unsatisfiableMemberIds: readonly string[];
};

/** 日次生成（planner の loadPlannerSafetyData）と同じ基準で対象メンバーを判定する。 */
export async function loadWeeklyPlanFormEligibility(
  userId: string,
): Promise<WeeklyPlanEligibility> {
  const members = await loadHouseholdSafetyMembers(userId);
  return {
    members,
    unsatisfiableMemberIds: members
      .filter((member) => member.requiredSafetyConstraints.includes("cut_small"))
      .map((member) => member.id),
  };
}

/** Task 13 の currentCompleteMemberIds が要求する「現行 complete メンバー id 集合」を取得する。 */
export async function loadCurrentCompleteMemberIds(userId: string): Promise<readonly string[]> {
  const client = getBrowserSupabaseClient();
  const memberRows = await listHouseholdMembers(client, userId);
  return memberRows.filter((member) => member.status === "complete").map((member) => member.id);
}
