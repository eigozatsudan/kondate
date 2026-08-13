import type { GeneratedMenu, MenuValidationIssue } from "../contracts/generation.js";
import type { DishRegenerationAiOutput } from "../contracts/regeneration.js";
import { collectMenuTextSources } from "./allergens.js";

/**
 * ひらがな・カタカナ・漢字（CJK）および日本語でよく使う記号。
 * 中国語の漢字もここに含まれるが、ラテン／アラビア／キリル等の
 * 非 CJK 汚染（英語 description など）を落とすのが主目的。
 */
const JAPANESE_OR_CJK_SCRIPT =
  /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\u3005\u3006\u30fc]/u;

/** 半角・全角ラテン文字 */
const LATIN_LETTER = /[A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A]/u;

/**
 * 数字・記号を除いたあとに残ってよい計量単位（日本語 UI でよく使う ASCII 単位）。
 * tbsp/oz 等の英語レシピ単位はここへ入れず、日本語表記を促す。
 */
const ALLOWED_METRIC_UNIT = /^(?:g|kg|mg|μg|ug|ml|l|cc|cm|mm|m|%)$/iu;

const QUANTITY_NOISE = /[\d\s./\-–—~〜+×*.,，、。:：%％()（）[\]【】「」'"`]+/gu;

/**
 * 分量・単位だけ（数字 + 許可単位）とみなすか。
 * quantityText "300g" / unit "g" は日本語必須にしない。
 * "1 tbsp" は英語単位のため不可。
 */
function isMeasurementOrNumericOnly(text: string): boolean {
  const trimmed = text.normalize("NFKC").trim();
  if (trimmed === "") return true;
  const rest = trimmed.replace(QUANTITY_NOISE, " ").trim().toLowerCase();
  if (rest === "") return true;
  const tokens = rest.split(/\s+/u).filter((token) => token.length > 0);
  return tokens.length === 1 && ALLOWED_METRIC_UNIT.test(tokens[0] ?? "");
}

/**
 * 献立の利用者向け文言として受け入れるか。
 * - 日本語（CJK）を含む → 可（ラテン混じりも許容: 「BBQソース」「mainを調理」）
 * - 数字・許可計量単位のみ → 可
 * - ラテン／他スクリプトだけで日本語なし → 不可
 */
export function isAcceptableJapaneseUserText(text: string): boolean {
  const trimmed = text.normalize("NFKC").trim();
  if (trimmed === "") return true;
  if (isMeasurementOrNumericOnly(trimmed)) return true;
  if (JAPANESE_OR_CJK_SCRIPT.test(trimmed)) return true;
  // ラテン文字だけの本文は拒否
  if (LATIN_LETTER.test(trimmed)) return false;
  // キリル・アラビア・ハングル等: 文字が残っているのに CJK なし
  return !/\p{L}/u.test(trimmed);
}

const NON_JAPANESE_MESSAGE = "利用者向けの文言は日本語で書いてください";

type UserTextLeafVisitor = (path: string, text: string | null | undefined) => void;

/**
 * 新規・まるごと再生成の利用者向け text leaf。
 * collectMenuTextSources に加え、結果 UI に出る pantryUsage.unusedReason も含む。
 */
export function visitMenuUserTextLeaves(menu: GeneratedMenu, visit: UserTextLeafVisitor): void {
  for (const source of collectMenuTextSources(menu)) {
    visit(source.sourcePath, source.text);
  }
  // collectMenuTextSources は label sourceType に無い pantryUsage を列挙しない
  for (const [index, usage] of menu.pantryUsage.entries()) {
    visit(`pantryUsage.${String(index)}.unusedReason`, usage.unusedReason);
  }
}

/**
 * 一品再生成の AI wire 出力だけを列挙する。
 * 保持料理の name/description はサーバー側 DTO 由来のため対象外。
 */
export function visitDishRegenAiOutputTextLeaves(
  output: DishRegenerationAiOutput,
  visit: UserTextLeafVisitor,
): void {
  const dish = output.replacementDish;
  visit("replacementDish.name", dish.name);
  visit("replacementDish.description", dish.description);
  for (const [index, ingredient] of dish.ingredients.entries()) {
    const base = `replacementDish.ingredients.${String(index)}`;
    visit(`${base}.name`, ingredient.name);
    visit(`${base}.quantityText`, ingredient.quantityText);
    visit(`${base}.unit`, ingredient.unit);
  }
  for (const [index, step] of dish.steps.entries()) {
    visit(`replacementDish.steps.${String(index)}.instruction`, step.instruction);
  }
  for (const [index, row] of output.timeline.entries()) {
    visit(`timeline.${String(index)}.instruction`, row.instruction);
  }
  for (const [index, row] of output.adaptations.entries()) {
    const base = `adaptations.${String(index)}`;
    visit(`${base}.portionText`, row.portionText);
    visit(`${base}.additionalCutting`, row.additionalCutting);
    visit(`${base}.additionalHeating`, row.additionalHeating);
    visit(`${base}.additionalSeasoning`, row.additionalSeasoning);
    visit(`${base}.servingCheck`, row.servingCheck);
    for (const [actionIndex, action] of row.safetyActions.entries()) {
      visit(`${base}.safetyActions.${String(actionIndex)}.instruction`, action.instruction);
    }
  }
  for (const [index, row] of output.pantryUsage.entries()) {
    visit(`pantryUsage.${String(index)}.unusedReason`, row.unusedReason);
    visit(`pantryUsage.${String(index)}.pantryItemName`, row.pantryItemName);
  }
  for (const [index, row] of output.labelConfirmations.entries()) {
    visit(`labelConfirmations.${String(index)}.sourceText`, row.sourceText);
  }
}

function pushIfNonJapanese(
  issues: MenuValidationIssue[],
  path: string,
  text: string | null | undefined,
): void {
  if (text === null || text === undefined) return;
  if (isAcceptableJapaneseUserText(text)) return;
  issues.push({
    code: "invalid_menu_structure",
    path,
    message: NON_JAPANESE_MESSAGE,
  });
}

/**
 * collectMenuTextSources が列挙する全 text leaf を言語検査する。
 * 加えて結果 UI に出る pantryUsage.unusedReason（在庫「使わなかった理由」）も検査する。
 * アレルゲン列挙の sourceType 制約を広げずにここで足す。
 * 新規・まるごと再生成向け。失敗は invalid_menu_structure（既存 repair コード）に閉じる。
 *
 * 一品再生成では使わない: 保持料理に過去モデルの英語 description が残っていることがあり、
 * その場合は {@link collectNonJapaneseUserTextIssuesFromDishRegenAiOutput} で
 * 今回の AI 出力だけを検査する。
 */
export function collectNonJapaneseUserTextIssues(
  menu: GeneratedMenu,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  visitMenuUserTextLeaves(menu, (path, text) => {
    pushIfNonJapanese(issues, path, text);
  });
  return issues;
}

/**
 * 一品再生成の AI wire 出力だけを言語検査する。
 * 保持料理の name/description はサーバー側 DTO 由来のため対象外。
 * timeline / adaptations 等の今回生成テキストは対象。
 */
export function collectNonJapaneseUserTextIssuesFromDishRegenAiOutput(
  output: DishRegenerationAiOutput,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  visitDishRegenAiOutputTextLeaves(output, (path, text) => {
    pushIfNonJapanese(issues, path, text);
  });
  return issues;
}
