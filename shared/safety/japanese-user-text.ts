import type { GeneratedMenu, MenuValidationIssue } from "../contracts/generation.js";
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

/**
 * collectMenuTextSources が列挙する全 text leaf を言語検査する。
 * 失敗は invalid_menu_structure（既存 repair コード）に閉じる。
 */
export function collectNonJapaneseUserTextIssues(
  menu: GeneratedMenu,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  for (const source of collectMenuTextSources(menu)) {
    if (isAcceptableJapaneseUserText(source.text)) continue;
    issues.push({
      code: "invalid_menu_structure",
      path: source.sourcePath,
      message: NON_JAPANESE_MESSAGE,
    });
  }
  return issues;
}
