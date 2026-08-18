import type { ValidatedMenu } from "@shared/contracts/generation";
import { normalizeFoodText } from "@shared/safety-pure/normalize-food-text";

/**
 * PE4: fixture / share-canonical は pantryUsage が常に空。
 * スコアは pantry 名の部分一致（filter-emergency-menus）だが、表示は usage だけを見ていた。
 * ここは表示専用。安全判定・順位本体はサーバ Stage S / filter が正。
 */
export function listEmergencyPantryScoreMatches(input: {
  menu: ValidatedMenu;
  selectedPantryNames: readonly string[];
}): readonly string[] {
  const haystack = collectEmergencyPantryScoreHaystack(input.menu);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const name of input.selectedPantryNames) {
    const normalized = normalizeFoodText(name);
    if (normalized === "" || seen.has(normalized)) continue;
    if (!haystack.includes(normalized)) continue;
    seen.add(normalized);
    matched.push(name);
  }
  return matched;
}

/** スコア側 collectMenuTextSources と同趣旨の表示用テキスト。@shared/safety は引かない。 */
function collectEmergencyPantryScoreHaystack(menu: ValidatedMenu): string {
  const parts: string[] = [];
  for (const dish of menu.dishes) {
    parts.push(dish.name, dish.description);
    for (const ingredient of dish.ingredients) {
      parts.push(ingredient.name, ingredient.quantityText);
      if (ingredient.unit !== null) parts.push(ingredient.unit);
    }
    for (const step of dish.steps) {
      parts.push(step.instruction);
    }
  }
  for (const step of menu.timeline) {
    parts.push(step.instruction);
  }
  for (const adaptation of menu.adaptations) {
    parts.push(adaptation.portionText, adaptation.servingCheck);
    if (adaptation.additionalCutting !== null) parts.push(adaptation.additionalCutting);
    if (adaptation.additionalHeating !== null) parts.push(adaptation.additionalHeating);
    if (adaptation.additionalSeasoning !== null) parts.push(adaptation.additionalSeasoning);
    for (const action of adaptation.safetyActions) {
      parts.push(action.instruction);
    }
  }
  return normalizeFoodText(parts.join("\n"));
}
