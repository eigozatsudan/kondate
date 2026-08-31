/**
 * ひねり軸（noveltyPreference=twist）の prompt 専用ヒント。
 * fail-open・prompt 専用。fingerprint / quota / 検証には載せない。
 * diversity-hints.ts と同型。
 */

export const NOVELTY_HINTS_ENABLED = true as const;
export const NOVELTY_SYSTEM_MARKER = "【ひねり】" as const;
/** 1 リクエストあたりの除外料理名の上限。プロンプト肥大を防ぐ */
export const NOVELTY_EXCLUDED_DISHES_MAX = 12 as const;

/** system 文のひねり段落。先頭マーカーでテスト・運用識別する */
export const NOVELTY_PARAGRAPH =
  NOVELTY_SYSTEM_MARKER +
  "利用者は「ひねりたい」を選んでいます。" +
  "role=mainの料理では、preferences.mainIngredientsの最も一般的な調理法と定番の相方を避け、" +
  "別の加熱法や別の組み合わせで組んでください。" +
  "side・soup・stapleには適用しません。" +
  "noveltyExcludedDishesに挙げた料理名とその言い換えは、role=mainのnameに使わないでください。" +
  "家庭のキッチンで作れること、preferences.timeLimitMinutes、買い足しの現実性を優先します。" +
  "ひねりと他の制約が両立しないときは、通常どおりoutcome=successで定番の献立を返してください。" +
  "ひねりだけを理由にconstraint_conflictにしないでください。";
