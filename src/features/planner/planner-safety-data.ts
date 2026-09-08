import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
} from "@/features/household/household-api";
import { resolvePlannerAllergyDisclosure } from "@/features/planner/planner-allergy-disclosure";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";

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

/**
 * 日次(planner)と週献立で共通の「complete 家族の安全表示データ」を組み立てる。
 * 対象可否（eligibleMemberIds）や週献立で満たせない対象（unsatisfiableMemberIds）の
 * 算出は呼び出し側の責務として残す。
 */
export async function loadHouseholdSafetyMembers(
  userId: string,
): Promise<readonly PlannerSafetyMember[]> {
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
  return completeRows.map<PlannerSafetyMember>((member, index) => {
    const memberAllergies = allergies[index] ?? [];
    // U3-I6: 一部だけ解決できたとき、未解決分を silently drop しない
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
    // §7.1 / P3: 具体名を常時表示。none でも未解決残存があれば「なし」に落とさない
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
    return {
      id: member.id,
      displayName: member.display_name?.trim() || `家族${String(index + 1)}`,
      ageBandLabel:
        member.age_band === null ? "年齢未確認" : (ageLabels[member.age_band] ?? "年齢未確認"),
      allergyLabel: disclosure.allergyLabel,
      // カタログ解決不能・none+未解決・一部解決+未解決は allergyBlockedReason で選択不可
      blockedReason: blockedReason ?? disclosure.allergyBlockedReason,
      requiredSafetyConstraints: member.required_safety_constraints,
      safetyLabels: member.required_safety_constraints.map(
        (constraint) => safetyLabels[constraint] ?? "安全上の個別対応",
      ),
    };
  });
}
