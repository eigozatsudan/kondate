import type { CuisineGenre, MealType } from "@shared/contracts/domain";
import type { IngredientPreference } from "@shared/contracts/planner";

/** 食事の英語コード → 利用者向け日本語。確認画面・質問stepで共有する。 */
export const mealLabels: Readonly<Record<MealType, string>> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
} as const;

/** ジャンルの英語コード → 利用者向け日本語。確認画面・質問stepで共有する。 */
export const cuisineGenreLabels: Readonly<Record<CuisineGenre, string>> = {
  japanese: "和食",
  western: "洋食",
  chinese: "中華",
  any: "おまかせ",
} as const;

/** 材料の使い方 → 利用者向け日本語。確認画面の任意条件で共有する。 */
export const ingredientPreferenceLabels: Readonly<Record<IngredientPreference, string>> = {
  more: "多め",
  less: "少な目",
  selected_only: "メイン食材と冷蔵庫から使う食材からしか使わない",
  auto: "おまかせ",
} as const;

export function mealLabel(value: MealType | null): string {
  if (value === null) return "未選択";
  return mealLabels[value];
}

export function cuisineGenreLabel(value: CuisineGenre | null): string {
  if (value === null) return "未選択";
  return cuisineGenreLabels[value];
}

export function ingredientPreferenceLabel(value: IngredientPreference | null): string {
  if (value === null) return "指定なし";
  return ingredientPreferenceLabels[value];
}
