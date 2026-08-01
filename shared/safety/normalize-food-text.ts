/**
 * 互換 re-export。正本は shared/safety-pure/normalize-food-text.ts。
 * 評価 pipeline（allergens 等）は Functions 側からここ経由でも dual-surface 本体でも可。
 */
export {
  foldKatakanaToHiragana,
  normalizeFoodText,
  normalizeFoodTextBase,
} from "../safety-pure/normalize-food-text.js";
