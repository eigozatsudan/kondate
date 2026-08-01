import type { UnsupportedDietKind } from "../contracts/domain.js";

// 自由メモの明確な医療・嚥下・離乳依頼だけを検出する。日常の「やわらかめ」等は非検出。
// 言い換えすり抜け対策は過剰一般化せず、治療・嚥下文脈が明確な語に限定する。
// dual-surface: ブラウザ UX ゲートとサーバ hard gate が同じ検出器を共有する。
const patterns: ReadonlyArray<readonly [UnsupportedDietKind, RegExp]> = [
  ["weaning_food", /離乳食|離乳期|赤ちゃん用/u],
  [
    "swallowing_concern",
    /嚥下|えん下|えんげ|飲み込み|むせ|とろみ食|とろみをつけ|とろみ付け|とろみ付|嚥下調整|刻み食/u,
  ],
  [
    "therapeutic_diet",
    /治療食|療養食|腎臓病食|糖尿病食|透析食|透析中|透析向け|透析用|低たんぱく|タンパク制限|たんぱく制限|蛋白質制限|CKD|慢性腎臓病|医師.{0,12}(指示|制限)|(腎臓病|腎不全|糖尿病).{0,20}(塩分|たんぱく|糖質|炭水化物|カロリー).{0,12}(減ら|控え|抑え|制限)|高血圧.{0,20}減塩食/u,
  ],
];

export function detectUnsupportedMedicalRequest(text: string): readonly UnsupportedDietKind[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
