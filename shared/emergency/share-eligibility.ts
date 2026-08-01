/**
 * 共有化の緊急適格ゲート（AI 前・決定論）。
 * attempt 予約や job 作成の前に呼び出し、不適格は AI を呼ばず終了する。
 * consent / 抽選 / 日次 cap はここでは見ない（呼び出し側・RPC の責務）。
 */

import { isAllowedMenuDishCount, type ValidatedMenu } from "../contracts/generation.js";
import type { ShareSkipReason } from "../contracts/share-job.js";

export type ShareEligibilityResult = { ok: true } | { ok: false; reason: ShareSkipReason };

/** mealType ごとの必須 role（Stage S の required_dish_role と同じ見通し） */
function hasRequiredDishRoles(menu: ValidatedMenu): boolean {
  const roles = new Set(menu.dishes.map((dish) => dish.role));
  if (menu.mealType === "dinner") {
    return (["main", "side", "soup"] as const).every((role) => roles.has(role));
  }
  return (roles.has("main") || roles.has("staple")) && roles.has("side");
}

/**
 * 緊急共有の構造適格を判定する。
 * 理由は閉じた ShareSkipReason のみ（自由文・PII を返さない）。
 */
export function evaluateShareEligibility(menu: ValidatedMenu): ShareEligibilityResult {
  // 1) 時間: 緊急は 15 分以内（境界は含む）
  if (menu.totalElapsedMinutes > 15) {
    return { ok: false, reason: "not_emergency_duration" };
  }

  // 2) pantry 紐づけ: 材料参照または usage のいずれかがあれば v1 はスキップ
  //    （材料固有名・household 在庫の漏洩経路を AI 前に閉じる）
  const hasPantryBoundIngredient = menu.dishes.some((dish) =>
    dish.ingredients.some((ingredient) => ingredient.pantrySelectionId !== null),
  );
  if (hasPantryBoundIngredient || menu.pantryUsage.length > 0) {
    return { ok: false, reason: "pantry_bound" };
  }

  // 3) 最低 dish 数・必須 role・steps/timeline 非空
  if (!isAllowedMenuDishCount(menu.mealType, menu.dishes.length)) {
    return { ok: false, reason: "ineligible_structure" };
  }
  if (!hasRequiredDishRoles(menu)) {
    return { ok: false, reason: "ineligible_structure" };
  }
  if (menu.timeline.length === 0) {
    return { ok: false, reason: "ineligible_structure" };
  }
  for (const dish of menu.dishes) {
    if (dish.steps.length === 0 || dish.ingredients.length === 0) {
      return { ok: false, reason: "ineligible_structure" };
    }
  }

  return { ok: true };
}
