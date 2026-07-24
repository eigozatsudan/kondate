import type { CuisineGenre, MealType } from "@shared/contracts/domain";

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

export function mealLabel(value: MealType | null): string {
  if (value === null) return "未選択";
  return mealLabels[value];
}

export function cuisineGenreLabel(value: CuisineGenre | null): string {
  if (value === null) return "未選択";
  return cuisineGenreLabels[value];
}
