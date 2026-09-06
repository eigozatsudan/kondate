import type { WeeklyFlyerDay } from "@shared/contracts/flyer-weekly";
import {
  PLANNER_INGREDIENT_TEXT_MAX,
  PLANNER_MAIN_INGREDIENT_LIMIT,
  PLANNER_MEMO_TEXT_MAX,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import type { WeeklyPlanResult } from "@shared/contracts/weekly-plan";

function truncateCodePoints(value: string, maximumLength: number): string {
  return Array.from(value).slice(0, maximumLength).join("");
}

export type WeeklyPlanDraftHandoffOutcome =
  { input: PlannerDraftInput } | { error: "no_eligible_members" };

/**
 * 週献立を作成した時点より後に家族構成が変わり得るため、保存済み対象と現在の complete
 * メンバーの積集合だけを日ごとの献立へ引き継ぐ。
 */
export function buildPlannerDraftInputFromWeeklyPlanDay(
  day: WeeklyFlyerDay,
  plan: Pick<
    WeeklyPlanResult,
    "targetMemberIds" | "cuisineGenre" | "budgetPreference" | "noveltyPreference"
  >,
  currentCompleteMemberIds: readonly string[],
): WeeklyPlanDraftHandoffOutcome {
  const currentCompleteMemberIdSet = new Set(currentCompleteMemberIds);
  const targetMemberIds = plan.targetMemberIds.filter((memberId) =>
    currentCompleteMemberIdSet.has(memberId),
  );
  if (targetMemberIds.length === 0) {
    return { error: "no_eligible_members" };
  }

  // 先頭8件という契約を先に適用し、空白項目が後続食材へ入れ替わらないようにする。
  const mainIngredients = day.ingredients
    .slice(0, PLANNER_MAIN_INGREDIENT_LIMIT)
    .map((ingredient) => truncateCodePoints(ingredient, PLANNER_INGREDIENT_TEXT_MAX).trim())
    .filter((ingredient) => ingredient !== "");

  return {
    input: {
      mealType: "dinner",
      mainIngredients,
      cuisineGenre: plan.cuisineGenre,
      targetMode: "household",
      targetMemberIds,
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: plan.budgetPreference,
      // ingredientPreference: 週献立の入力に対応する項目が無いため今回のスコープ外。null のまま。
      ingredientPreference: null,
      noveltyPreference: plan.noveltyPreference,
      avoidIngredients: [],
      memo: truncateCodePoints(`主菜: ${day.mainName}`, PLANNER_MEMO_TEXT_MAX),
      pantrySelections: [],
    },
  };
}

/**
 * 引き継ぎ候補が持つ13キーだけを対象にし、永続化された下書きのメタデータは比較しない。
 * 既存側の空値は利用者が入力した内容ではないため、候補との差があっても確認を求めない。
 */
export function draftNeedsOverwriteConfirmation(
  existing: PlannerDraftInput | null,
  candidate: PlannerDraftInput,
): boolean {
  if (existing === null) return false;
  if (existing.targetMode === "idea") return true;

  const candidateKeys = Object.keys(candidate) as (keyof PlannerDraftInput)[];
  return candidateKeys.some((key) => {
    const existingValue = existing[key];
    const isEmpty =
      existingValue === null ||
      existingValue === "" ||
      (Array.isArray(existingValue) && existingValue.length === 0);

    return !isEmpty && JSON.stringify(existingValue) !== JSON.stringify(candidate[key]);
  });
}
