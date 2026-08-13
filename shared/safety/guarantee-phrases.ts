import type { GeneratedMenu, MenuValidationIssue } from "../contracts/generation.js";
import type { DishRegenerationAiOutput } from "../contracts/regeneration.js";
import { shareGuaranteePhrases } from "../contracts/share-denylist.v1.js";
import { visitDishRegenAiOutputTextLeaves, visitMenuUserTextLeaves } from "./japanese-user-text.js";

/**
 * share 関門の閉じたリストには無いが、生成 persist では拒否する追加針。
 * 「安全です」は G6 の核。固定免責「食べて安全であることを保証するものではありません」は
 * 「安全です」も「安全を保証」も含まない（である / であることを が挟まる）。
 */
const generationExtraGuaranteePhrases = ["安全です"] as const;

const generationGuaranteePhrases = [
  ...shareGuaranteePhrases,
  ...generationExtraGuaranteePhrases,
] as const;

/** 内部向け短文。ヒット本文は載せない（PII / 生 AI 出力をログに残さない）。 */
const GUARANTEE_PHRASE_MESSAGE = "利用者向け本文に安全保証の表現は書けません";

function textHitsGenerationGuarantee(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  return generationGuaranteePhrases.some((phrase) => trimmed.includes(phrase));
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
 * 保持料理の過去文（保証フレーズ残渣を含む）は落とさない。
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
