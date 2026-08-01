/**
 * 共有プール向けの緊急カノニカル形（構造のみ）。
 * - 全 UUID を idFactory で再採番（source id を再利用しない）
 * - pantry / labelConfirmations は空固定
 * - adaptations はソースをコピーせず member_1 の中立テンプレのみ
 * - ingredient-bound safetyActions は決定論 rebind。不能なら fail-closed
 *
 * standardAllergenIds / eligibleAgeBands は Task 7b の責務（ここでは付けない）。
 * 自由文の一般化（Pass1/2）もここでは行わない。
 */

import type { MenuMemberAdaptation, SafetyAction, ValidatedMenu } from "../contracts/generation.js";
import type { ShareSkipReason } from "../contracts/share-job.js";
import { evaluateShareEligibility } from "./share-eligibility.js";

export type ShareCanonicalResult =
  { ok: true; menu: ValidatedMenu } | { ok: false; reason: ShareSkipReason };

/** 中立テンプレの分量文言。ソース portionText（固有名・個人指示）は載せない */
const NEUTRAL_PORTION_TEXT = "年齢と食欲に合わせた量";
/** 中立の取り分け確認。表示名スナップショットを含めない */
const NEUTRAL_SERVING_CHECK = "取り分けを確認する";

type IdMaps = {
  dishIds: Map<string, string>;
  ingredientIds: Map<string, string>;
  stepIds: Map<string, string>;
};

/**
 * ソース safetyActions を新 id へ決定論 rebind する。
 * 参照先（dish / ingredient / step）がマップに無い、または所有関係が崩れている場合は null。
 * 複数メンバー分の同一 action は kind+ingredient+step で畳む（member_1 へ統合）。
 */
function rebindSafetyActions(
  menu: ValidatedMenu,
  maps: IdMaps,
): Map<string, SafetyAction[]> | null {
  const ingredientOwner = new Map(
    menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, dish.id] as const),
    ),
  );
  const stepOwner = new Map(
    menu.dishes.flatMap((dish) => dish.steps.map((step) => [step.id, dish.id] as const)),
  );

  // 新 dishId → actions（後でテンプレ adaptation に載せる）
  const byNewDishId = new Map<string, SafetyAction[]>();
  // 重複排除キー（kind|ingredient|step）
  const seen = new Set<string>();

  for (const adaptation of menu.adaptations) {
    for (const action of adaptation.safetyActions) {
      const newDishId = maps.dishIds.get(action.dishId);
      const newIngredientId = maps.ingredientIds.get(action.ingredientId);
      const newStepId = maps.stepIds.get(action.beforeRecipeStepId);
      if (newDishId === undefined || newIngredientId === undefined || newStepId === undefined) {
        return null;
      }
      // 所有関係が崩れている action は rebind 不能（空 adaptation で通さない）
      if (ingredientOwner.get(action.ingredientId) !== action.dishId) {
        return null;
      }
      if (stepOwner.get(action.beforeRecipeStepId) !== action.dishId) {
        return null;
      }

      const dedupeKey = `${action.kind}|${newIngredientId}|${newStepId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const rebound: SafetyAction = {
        kind: action.kind,
        dishId: newDishId,
        ingredientId: newIngredientId,
        anonymousMemberRef: "member_1",
        beforeRecipeStepId: newStepId,
        instruction: action.instruction,
      };
      const list = byNewDishId.get(newDishId) ?? [];
      list.push(rebound);
      byNewDishId.set(newDishId, list);
    }
  }

  return byNewDishId;
}

/**
 * 共有用カノニカル ValidatedMenu を構築する。
 * 適格でない・safetyActions を rebind できない場合は ok: false。
 */
export function buildShareCanonicalMenu(
  menu: ValidatedMenu,
  idFactory: () => string,
): ShareCanonicalResult {
  const eligibility = evaluateShareEligibility(menu);
  if (!eligibility.ok) {
    return eligibility;
  }

  const dishIds = new Map<string, string>();
  const ingredientIds = new Map<string, string>();
  const stepIds = new Map<string, string>();

  const dishes = menu.dishes.map((dish) => {
    const newDishId = idFactory();
    dishIds.set(dish.id, newDishId);
    const ingredients = dish.ingredients.map((ingredient) => {
      const newIngredientId = idFactory();
      ingredientIds.set(ingredient.id, newIngredientId);
      return {
        ...ingredient,
        id: newIngredientId,
        // 適格ゲート済みでも防御的に null 固定（共有形の不変条件）
        pantrySelectionId: null,
      };
    });
    const steps = dish.steps.map((step) => {
      const newStepId = idFactory();
      stepIds.set(step.id, newStepId);
      return {
        ...step,
        id: newStepId,
      };
    });
    return {
      ...dish,
      id: newDishId,
      ingredients,
      steps,
    };
  });

  const maps: IdMaps = { dishIds, ingredientIds, stepIds };
  const reboundByDish = rebindSafetyActions(menu, maps);
  if (reboundByDish === null) {
    return { ok: false, reason: "ineligible_structure" };
  }

  const timeline: ValidatedMenu["timeline"] = [];
  for (const step of menu.timeline) {
    let newDishId: string | null = null;
    if (step.dishId !== null) {
      const mapped = dishIds.get(step.dishId);
      // 参照があったのにマップに無い場合は構造破綻 → fail-closed
      if (mapped === undefined) {
        return { ok: false, reason: "ineligible_structure" };
      }
      newDishId = mapped;
    }
    let newRecipeStepId: string | null = null;
    if (step.recipeStepId !== null) {
      const mapped = stepIds.get(step.recipeStepId);
      if (mapped === undefined) {
        return { ok: false, reason: "ineligible_structure" };
      }
      newRecipeStepId = mapped;
    }
    timeline.push({
      ...step,
      id: idFactory(),
      dishId: newDishId,
      recipeStepId: newRecipeStepId,
    });
  }

  // ソース adaptations はコピーしない。dish ごとに member_1 中立テンプレを必ず 1 件。
  // under-six 向けに「空 adaptations で通したように見せる」ことを禁止する。
  const adaptations: MenuMemberAdaptation[] = [];
  for (const dish of dishes) {
    const firstStep = dish.steps[0];
    // 適格ゲートで steps 非空を保証。欠落は構造不適格として閉じる
    if (firstStep === undefined) {
      return { ok: false, reason: "ineligible_structure" };
    }
    const safetyActions = reboundByDish.get(dish.id) ?? [];
    const safetyTags = [...new Set(safetyActions.map((action) => action.kind))];
    adaptations.push({
      id: idFactory(),
      dishId: dish.id,
      anonymousMemberRef: "member_1",
      portionText: NEUTRAL_PORTION_TEXT,
      branchBeforeRecipeStepId: firstStep.id,
      additionalCutting: null,
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: NEUTRAL_SERVING_CHECK,
      safetyTags,
      safetyActions,
    });
  }

  const canonical: ValidatedMenu = {
    schemaVersion: menu.schemaVersion,
    menuId: idFactory(),
    mealType: menu.mealType,
    cuisineGenre: menu.cuisineGenre,
    // 共有テンプレは 2 人分固定（ソース世帯人数・個人人数をプールへ載せない）
    servings: 2,
    totalElapsedMinutes: menu.totalElapsedMinutes,
    safetyTags: [...menu.safetyTags],
    dishes,
    timeline,
    adaptations,
    pantryUsage: [],
    labelConfirmations: [],
  };

  return { ok: true, menu: canonical };
}
