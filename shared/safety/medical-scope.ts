import type { UnsupportedDietKind } from "../contracts/domain.js";

const patterns: ReadonlyArray<readonly [UnsupportedDietKind, RegExp]> = [
  ["weaning_food", /離乳食|離乳期|赤ちゃん用/u],
  ["swallowing_concern", /嚥下|えん下|飲み込み|むせ|とろみ食|嚥下調整|刻み食/u],
  ["therapeutic_diet", /治療食|療養食|腎臓病食|糖尿病食|透析食|低たんぱく|医師.{0,12}(指示|制限)/u],
];

export function detectUnsupportedMedicalRequest(text: string): readonly UnsupportedDietKind[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
