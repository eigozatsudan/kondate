import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
} from "@/features/household/household-api";
import { resolvePlannerAllergyDisclosure } from "@/features/planner/planner-allergy-disclosure";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";

// planner-route.tsx の ageLabels/safetyLabels と同じ表示ラベル（重複だが両者は独立した
// UI 文言定義であり、safety ルールの複製ではない）。
const ageLabels: Readonly<Record<string, string>> = {
  post_weaning_to_2: "離乳食完了後〜2歳",
  age_3_5: "3〜5歳",
  age_6_8: "6〜8歳",
  age_9_12: "9〜12歳",
  age_13_17: "13〜17歳",
  adult: "大人",
  senior: "高齢者",
};

const safetyLabels: Readonly<Record<string, string>> = {
  remove_bones: "骨を除く",
  cut_small: "小さく切る",
};

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

/**
 * 日次生成（planner-route.tsx の loadPlannerSafetyData）と同じ基準で対象メンバーを
 * 判定する。Task 9-11 で完成・レビュー済みの planner-route.tsx を変更しないため、
 * 骨組みをここへ独立実装として複製している（reuse/simplification の指摘は最終
 * レビューで判断する）。
 */
export async function loadWeeklyPlanFormEligibility(
  userId: string,
): Promise<WeeklyPlanEligibility> {
  const client = getBrowserSupabaseClient();
  const [memberRows, catalog] = await Promise.all([
    listHouseholdMembers(client, userId),
    listAllergenCatalog(client),
  ]);
  const completeRows = memberRows.filter((member) => member.status === "complete");
  const allergies = await Promise.all(
    completeRows.map((member) => listMemberAllergies(client, userId, member.id)),
  );
  const allergenNames = new Map(catalog.map((item) => [item.id, item.display_name]));
  const unsatisfiableMemberIds: string[] = [];
  const members = completeRows.map<PlannerSafetyMember>((member, index) => {
    const memberAllergies = allergies[index] ?? [];
    let unresolvedAllergyCount = 0;
    const allergyNames = memberAllergies.flatMap((allergy) => {
      if (allergy.allergen_id !== null) {
        const displayName = allergenNames.get(allergy.allergen_id);
        if (displayName === undefined) {
          unresolvedAllergyCount += 1;
          return [];
        }
        return [displayName];
      }
      if (allergy.custom_confirmed && allergy.custom_name !== null) {
        return [allergy.custom_name];
      }
      if (allergy.custom_confirmed) {
        unresolvedAllergyCount += 1;
      }
      return [];
    });
    const blockedReason =
      member.allergy_status === "unconfirmed"
        ? "アレルギー確認が完了していません"
        : member.unsupported_diet_status === "unconfirmed"
          ? "対応対象の確認が完了していません"
          : member.unsupported_diet_status === "present"
            ? "離乳食・嚥下調整食・治療食には対応できません"
            : null;
    const rawAllergyStatus = member.allergy_status;
    const allergyStatus: "none" | "registered" | "unconfirmed" | null =
      rawAllergyStatus === "none" ||
      rawAllergyStatus === "registered" ||
      rawAllergyStatus === "unconfirmed"
        ? rawAllergyStatus
        : null;
    const disclosure = resolvePlannerAllergyDisclosure({
      allergyStatus,
      allergyNames,
      unresolvedAllergyCount,
    });
    if (member.required_safety_constraints.includes("cut_small")) {
      unsatisfiableMemberIds.push(member.id);
    }
    return {
      id: member.id,
      displayName: member.display_name?.trim() || `家族${String(index + 1)}`,
      ageBandLabel:
        member.age_band === null ? "年齢未確認" : (ageLabels[member.age_band] ?? "年齢未確認"),
      allergyLabel: disclosure.allergyLabel,
      blockedReason: blockedReason ?? disclosure.allergyBlockedReason,
      safetyLabels: member.required_safety_constraints.map(
        (constraint) => safetyLabels[constraint] ?? "安全上の個別対応",
      ),
    };
  });
  return { members, unsatisfiableMemberIds };
}

/** Task 13 の currentCompleteMemberIds が要求する「現行 complete メンバー id 集合」を取得する。 */
export async function loadCurrentCompleteMemberIds(userId: string): Promise<readonly string[]> {
  const client = getBrowserSupabaseClient();
  const memberRows = await listHouseholdMembers(client, userId);
  return memberRows.filter((member) => member.status === "complete").map((member) => member.id);
}
