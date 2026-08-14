import type { WeeklyFlyerMenu } from "../contracts/flyer-weekly.js";
import type { GeneratedMenu, MenuValidationIssue } from "../contracts/generation.js";
import type { DishRegenerationAiOutput } from "../contracts/regeneration.js";
import { shareGuaranteePhrases } from "../contracts/share-denylist.v1.js";
import { foldKatakanaToHiragana } from "../safety-pure/normalize-food-text.js";
import { visitDishRegenAiOutputTextLeaves, visitMenuUserTextLeaves } from "./japanese-user-text.js";

/**
 * share 関門の閉じたリストには無いが、生成 persist では拒否する追加針。
 * 「安全です」は G6 の核。固定免責「食べて安全であることを保証するものではありません」は
 * 「安全です」も「安全を保証」も含まない（である / であることを が挟まる）。
 * 照合前畳み（NFKC / Cf / 空白削除 / カナ幅）後も同じ。句読点までは落とさない。
 */
const generationExtraGuaranteePhrases = ["安全です"] as const;

const generationGuaranteePhrases = [
  ...shareGuaranteePhrases,
  ...generationExtraGuaranteePhrases,
] as const;

/** 内部向け短文。ヒット本文は載せない（PII / 生 AI 出力をログに残さない）。 */
const GUARANTEE_PHRASE_MESSAGE = "利用者向け本文に安全保証の表現は書けません";

/**
 * 保持料理から保証フレーズを剥離するときのプレースホルダ。
 * schema の min(1) を満たし、generationGuaranteePhrases に当たらない。
 */
export const guaranteePhraseRedaction = {
  name: "料理",
  description: "料理の説明",
  instruction: "手順を確認する",
  ingredientName: "材料",
  quantityText: "適量",
  unit: "g",
} as const;

/** fallback 自身が針に当たったときの最終プレースホルダ */
const GUARANTEE_PHRASE_REDACTION_OMITTED = "（省略）";

/**
 * haystack / needle を同じ空間へ寄せる。
 * NFKC → 書式制御除去 → 空白類削除 → カタカナ→ひらがな。
 * normalizeFoodText の句読点除去は使わない。免責の「である」境界を残し、
 * 「安全です」「安全を保証」への誤爆を避ける（G10）。
 */
function foldGuaranteePhraseText(value: string): string {
  return foldKatakanaToHiragana(
    value
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "")
      .replace(/\s/gu, ""),
  );
}

function textHitsGenerationGuarantee(text: string): boolean {
  const folded = foldGuaranteePhraseText(text);
  if (folded === "") return false;
  return generationGuaranteePhrases.some((phrase) =>
    folded.includes(foldGuaranteePhraseText(phrase)),
  );
}

type FoldedInterval = {
  start: number;
  end: number;
};

/**
 * 畳み空間の index を NFKC 原文へ戻すための写像。
 * 葉全体置換だと「小麦アレルギーでも安全です」の小麦針が消え、persist 後に
 * 家族へ小麦を足しても履歴再検証が needle を見つけられない。
 */
function foldGuaranteePhraseWithMap(value: string): {
  folded: string;
  nfkc: string;
  foldedToNfkc: readonly number[];
} {
  const nfkc = value.normalize("NFKC");
  let folded = "";
  const foldedToNfkc: number[] = [];
  let nfkcOffset = 0;
  for (const char of nfkc) {
    const start = nfkcOffset;
    nfkcOffset += char.length;
    if (/\p{Cf}/u.test(char) || /\s/u.test(char)) continue;
    const foldedChar = foldKatakanaToHiragana(char);
    for (const foldedUnit of foldedChar) {
      folded += foldedUnit;
      foldedToNfkc.push(start);
    }
  }
  return { folded, nfkc, foldedToNfkc };
}

function collectFoldedGuaranteeIntervals(folded: string): FoldedInterval[] {
  const intervals: FoldedInterval[] = [];
  for (const phrase of generationGuaranteePhrases) {
    const needle = foldGuaranteePhraseText(phrase);
    if (needle === "") continue;
    let from = 0;
    while (from <= folded.length - needle.length) {
      const start = folded.indexOf(needle, from);
      if (start === -1) break;
      intervals.push({ start, end: start + needle.length });
      from = start + 1;
    }
  }
  if (intervals.length === 0) return [];
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: FoldedInterval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last !== undefined && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

function nfkcCodePointLengthAt(nfkc: string, index: number): number {
  const codePoint = nfkc.codePointAt(index);
  if (codePoint === undefined) return 0;
  return String.fromCodePoint(codePoint).length;
}

/**
 * 保証フレーズに当たる区間だけを NFKC 原文から除く。非ヒット部分（アレルゲン /
 * food-rule の走査トークン）は残す。剥がし切れなければ空文字。
 */
function stripGenerationGuaranteePhrases(text: string): string {
  const { folded, nfkc, foldedToNfkc } = foldGuaranteePhraseWithMap(text);
  const intervals = collectFoldedGuaranteeIntervals(folded);
  if (intervals.length === 0) return text;
  const nfkcIntervals = intervals.flatMap((interval) => {
    const start = foldedToNfkc[interval.start];
    const lastFolded = foldedToNfkc[interval.end - 1];
    if (start === undefined || lastFolded === undefined) return [];
    return [{ start, end: lastFolded + nfkcCodePointLengthAt(nfkc, lastFolded) }];
  });
  let result = nfkc;
  for (const interval of nfkcIntervals.toSorted((left, right) => right.start - left.start)) {
    result = `${result.slice(0, interval.start)}${result.slice(interval.end)}`;
  }
  return result.trim();
}

function pushIfGuarantee(
  issues: MenuValidationIssue[],
  path: string,
  text: string | null | undefined,
): void {
  if (text === null || text === undefined) return;
  if (!textHitsGenerationGuarantee(text)) return;
  issues.push({
    code: "invalid_menu_structure",
    path,
    message: GUARANTEE_PHRASE_MESSAGE,
  });
}

/**
 * 保証フレーズだけを剥がす。ヒットしなければ原文のまま。
 * 一品再生成の保持料理を再 persist する前に使い、結果画面へ「安全です」を出さない（G3）。
 * 葉がフレーズだけなら fallback（それも針なら「（省略）」）。
 */
export function redactGuaranteePhraseText(text: string, fallback: string): string {
  if (!textHitsGenerationGuarantee(text)) return text;
  let current = text;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!textHitsGenerationGuarantee(current)) {
      return current.trim() === "" ? fallbackOrOmitted(fallback) : current;
    }
    const stripped = stripGenerationGuaranteePhrases(current);
    if (stripped === current || stripped === "") {
      break;
    }
    current = stripped;
  }
  if (current.trim() !== "" && !textHitsGenerationGuarantee(current)) {
    return current;
  }
  return fallbackOrOmitted(fallback);
}

function fallbackOrOmitted(fallback: string): string {
  if (!textHitsGenerationGuarantee(fallback)) return fallback;
  return GUARANTEE_PHRASE_REDACTION_OMITTED;
}

/**
 * 新規・まるごと再生成向け。利用者向け本文の保証フレーズを拒否する。
 * 失敗は invalid_menu_structure に閉じる（新 code は足さない）。
 */
export function collectGuaranteePhraseIssues(menu: GeneratedMenu): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  visitMenuUserTextLeaves(menu, (path, text) => {
    pushIfGuarantee(issues, path, text);
  });
  return issues;
}

/**
 * 一品再生成の今回 AI 出力だけを見る。
 * 保持料理の残渣は materialize 側で剥離し、本関数では見ない。
 */
export function collectGuaranteePhraseIssuesFromDishRegenAiOutput(
  output: DishRegenerationAiOutput,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  visitDishRegenAiOutputTextLeaves(output, (path, text) => {
    pushIfGuarantee(issues, path, text);
  });
  return issues;
}

/**
 * チラシ週間献立の表示・保持フィールドへ、生成と同じ保証フレーズ針を掛ける。
 * collectGuaranteePhraseIssues と同じ畳み・針（「安全です」含む）。ヒット本文は載せない。
 */
export function collectGuaranteePhraseIssuesFromFlyerMenu(
  menu: WeeklyFlyerMenu,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  menu.days.forEach((day, index) => {
    const prefix = `days.${String(index)}`;
    pushIfGuarantee(issues, `${prefix}.label`, day.label);
    pushIfGuarantee(issues, `${prefix}.mainName`, day.mainName);
    pushIfGuarantee(issues, `${prefix}.sideName`, day.sideName);
    pushIfGuarantee(issues, `${prefix}.notes`, day.notes);
    day.ingredients.forEach((ingredient, ingredientIndex) => {
      pushIfGuarantee(issues, `${prefix}.ingredients.${String(ingredientIndex)}`, ingredient);
    });
  });
  return issues;
}
