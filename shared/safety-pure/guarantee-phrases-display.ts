import type { ValidatedMenu } from "../contracts/generation.js";
import { shareGuaranteePhrases } from "../contracts/share-denylist.v1.js";
import { foldKatakanaToHiragana } from "./normalize-food-text.js";

/**
 * 生成 persist と同じ核の「安全です」。share denylist には無いが
 * 履歴 idea 表示では免責と並べて出してはいけない（HR3）。
 */
const displayExtraGuaranteePhrases = ["安全です"] as const;

function foldGuaranteeDisplayText(value: string): string {
  return foldKatakanaToHiragana(
    value
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "")
      .replace(/\s/gu, ""),
  );
}

/**
 * 表示用の保証句ヒット。hard safety 権威は持たない。
 * idea 履歴が家族再検証を走らせない残差を、本文を隠すためだけに使う。
 */
export function displayTextHitsGuaranteePhrase(text: string): boolean {
  const folded = foldGuaranteeDisplayText(text);
  if (folded === "") return false;
  return [...shareGuaranteePhrases, ...displayExtraGuaranteePhrases].some((phrase) =>
    folded.includes(foldGuaranteeDisplayText(phrase)),
  );
}

function visitValidatedMenuDisplayText(menu: ValidatedMenu, visit: (text: string) => void): void {
  for (const dish of menu.dishes) {
    visit(dish.name);
    visit(dish.description);
    for (const ingredient of dish.ingredients) {
      visit(ingredient.name);
      visit(ingredient.quantityText);
      if (ingredient.unit !== null) visit(ingredient.unit);
    }
    for (const step of dish.steps) {
      visit(step.instruction);
    }
  }
  for (const step of menu.timeline) {
    visit(step.instruction);
  }
  for (const usage of menu.pantryUsage) {
    if (usage.unusedReason !== null) visit(usage.unusedReason);
  }
}

/** idea 詳細で料理本文を出してよいか。1 葉でも保証句があれば閉じる。 */
export function validatedMenuHitsGuaranteePhrase(menu: ValidatedMenu): boolean {
  let hit = false;
  visitValidatedMenuDisplayText(menu, (text) => {
    if (hit) return;
    if (displayTextHitsGuaranteePhrase(text)) hit = true;
  });
  return hit;
}
