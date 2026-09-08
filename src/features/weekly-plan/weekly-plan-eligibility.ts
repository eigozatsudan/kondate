import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  listFoodSafetyRules,
  listHouseholdMembers,
  type FoodSafetyRuleRow,
} from "@/features/household/household-api";
import { loadHouseholdSafetyMembers } from "@/features/planner/planner-safety-data";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";

export type WeeklyPlanEligibility = {
  members: readonly PlannerSafetyMember[];
  /**
   * 週献立では満たせない対象。サーバ loadWeeklyPlanInspectionSafety と同じく
   * cut_small と、対象年齢帯に当たる requires_tag 規則。forbidden は見ない。
   * food_safety_rules は authenticated SELECT 可能な共有カタログなので、
   * @shared/safety をブラウザへ引き込まずに判定する。
   */
  unsatisfiableMemberIds: readonly string[];
};

function isUnsatisfiableWeeklyPlanMember(
  requiredSafetyConstraints: readonly string[],
  ageBand: string | null,
  rules: readonly FoodSafetyRuleRow[],
): boolean {
  if (requiredSafetyConstraints.includes("cut_small")) return true;
  if (ageBand === null) return false;
  return rules.some(
    (rule) => rule.rule_kind === "requires_tag" && rule.applies_to_age_bands.includes(ageBand),
  );
}

/** 日次生成（planner の loadPlannerSafetyData）と同じ基準で対象メンバーを判定する。 */
export async function loadWeeklyPlanFormEligibility(
  userId: string,
): Promise<WeeklyPlanEligibility> {
  const client = getBrowserSupabaseClient();
  const [members, memberRows, rules] = await Promise.all([
    loadHouseholdSafetyMembers(userId),
    listHouseholdMembers(client, userId),
    listFoodSafetyRules(client),
  ]);
  const ageBandById = new Map(memberRows.map((row) => [row.id, row.age_band]));
  return {
    members,
    unsatisfiableMemberIds: members
      .filter((member) =>
        isUnsatisfiableWeeklyPlanMember(
          member.requiredSafetyConstraints,
          ageBandById.get(member.id) ?? null,
          rules,
        ),
      )
      .map((member) => member.id),
  };
}

/** Task 13 の currentCompleteMemberIds が要求する「現行 complete メンバー id 集合」を取得する。 */
export async function loadCurrentCompleteMemberIds(userId: string): Promise<readonly string[]> {
  const client = getBrowserSupabaseClient();
  const memberRows = await listHouseholdMembers(client, userId);
  return memberRows.filter((member) => member.status === "complete").map((member) => member.id);
}
