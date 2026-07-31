import type { GeneratedMenu, PreferenceGapNote, ValidatedMenu } from "../contracts/generation.js";
// allergens 評価本体をブラウザ graph に引き込まないよう正規化のみを import する
import { normalizeFoodText } from "./normalize-food-text.js";

/**
 * 苦手 soft gap を献立テキストから集める（A-I7）。
 * 検証 hard 失敗には使わず、結果画面表示専用。
 */
export function collectDislikePreferenceGaps(
  menu: GeneratedMenu | ValidatedMenu,
  preferences: readonly {
    anonymousMemberRef: string;
    dislikes: readonly string[];
  }[],
): readonly PreferenceGapNote[] {
  const identityFoodText = menu.dishes
    .flatMap((dish) => [dish.name, dish.description, ...dish.ingredients.map(({ name }) => name)])
    .map(normalizeFoodText)
    .join("\u0000");
  const gaps: PreferenceGapNote[] = [];
  for (const preference of preferences) {
    for (const dislike of preference.dislikes) {
      if (!identityFoodText.includes(normalizeFoodText(dislike))) continue;
      gaps.push({
        kind: "dislike",
        anonymousMemberRef: preference.anonymousMemberRef,
        dislikeToken: dislike,
        message: `苦手として登録した「${dislike}」が献立に含まれています`,
      });
    }
  }
  return gaps;
}
