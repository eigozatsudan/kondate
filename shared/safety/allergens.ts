import type {
  GeneratedLabelConfirmation,
  GeneratedMenu,
  MenuValidationIssue,
  ValidatedMenu,
} from "../contracts/generation.js";
import type { CurrentSafetyContext } from "./context.js";

export type AllergenCatalogEntry = {
  id: string;
  displayName: string;
  catalogVersion: string;
};

export type AllergenAlias = {
  allergenId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: "direct" | "derived" | "processed";
  requiresLabelConfirmation: boolean;
  dictionaryVersion: string;
};

export type AllergenDictionary = {
  version: string;
  catalog: readonly AllergenCatalogEntry[];
  aliases: readonly AllergenAlias[];
};

export type MenuTextSource = {
  sourceType: GeneratedLabelConfirmation["sourceType"];
  sourceId: string;
  sourcePath: string;
  text: string;
  dishId: string | null;
  ingredientId: string | null;
};

export function normalizeFoodText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s\u3000、。・,./（）()「」『』]/gu, "");
}

export function collectMenuTextSources(
  menu: GeneratedMenu | ValidatedMenu,
): readonly MenuTextSource[] {
  const sources: MenuTextSource[] = [];
  const push = (
    sourceType: MenuTextSource["sourceType"],
    sourceId: string,
    sourcePath: string,
    text: string | null,
    dishId: string | null,
    ingredientId: string | null,
  ) => {
    if (text !== null && text.trim() !== "") {
      sources.push({ sourceType, sourceId, sourcePath, text, dishId, ingredientId });
    }
  };
  menu.dishes.forEach((dish, dishIndex) => {
    push("dish", dish.id, `dishes.${String(dishIndex)}.name`, dish.name, dish.id, null);
    push(
      "dish",
      dish.id,
      `dishes.${String(dishIndex)}.description`,
      dish.description,
      dish.id,
      null,
    );
    dish.ingredients.forEach((ingredient, ingredientIndex) => {
      const base = `dishes.${String(dishIndex)}.ingredients.${String(ingredientIndex)}`;
      push("ingredient", ingredient.id, `${base}.name`, ingredient.name, dish.id, ingredient.id);
      push(
        "ingredient",
        ingredient.id,
        `${base}.quantityText`,
        ingredient.quantityText,
        dish.id,
        ingredient.id,
      );
      push("ingredient", ingredient.id, `${base}.unit`, ingredient.unit, dish.id, ingredient.id);
    });
    dish.steps.forEach((step, stepIndex) => {
      push(
        "recipe_step",
        step.id,
        `dishes.${String(dishIndex)}.steps.${String(stepIndex)}.instruction`,
        step.instruction,
        dish.id,
        null,
      );
    });
  });
  menu.timeline.forEach((step, index) => {
    push(
      "timeline",
      step.id,
      `timeline.${String(index)}.instruction`,
      step.instruction,
      step.dishId,
      null,
    );
  });
  menu.adaptations.forEach((adaptation, index) => {
    const base = `adaptations.${String(index)}`;
    push(
      "adaptation",
      adaptation.id,
      `${base}.portionText`,
      adaptation.portionText,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalCutting`,
      adaptation.additionalCutting,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalHeating`,
      adaptation.additionalHeating,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalSeasoning`,
      adaptation.additionalSeasoning,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.servingCheck`,
      adaptation.servingCheck,
      adaptation.dishId,
      null,
    );
    adaptation.safetyActions.forEach((action, actionIndex) => {
      push(
        "adaptation",
        adaptation.id,
        `${base}.safetyActions.${String(actionIndex)}.instruction`,
        action.instruction,
        action.dishId,
        action.ingredientId,
      );
    });
  });
  return sources;
}

export function evaluateAllergens(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
): {
  issues: readonly MenuValidationIssue[];
  labelConfirmations: readonly GeneratedLabelConfirmation[];
} {
  const sources = collectMenuTextSources(menu);
  const issues: MenuValidationIssue[] = [];
  const confirmations = new Map<string, GeneratedLabelConfirmation>();
  for (const member of context.members) {
    for (const allergenId of member.allergenIds) {
      const aliases = context.allergenDictionary.aliases.filter(
        (alias) => alias.allergenId === allergenId,
      );
      for (const source of sources) {
        const normalizedSource = normalizeFoodText(source.text);
        const matched = aliases.filter((alias) =>
          normalizedSource.includes(normalizeFoodText(alias.normalizedAlias)),
        );
        if (matched.some((alias) => !alias.requiresLabelConfirmation)) {
          issues.push({
            code: "direct_allergen_match",
            path: source.sourcePath,
            message: `${member.anonymousRef} の登録アレルゲン ${allergenId} が残っています`,
          });
          continue;
        }
        if (matched.some((alias) => alias.requiresLabelConfirmation)) {
          const confirmation: GeneratedLabelConfirmation = {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourcePath: source.sourcePath,
            sourceText: source.text,
            allergenId,
            anonymousMemberRef: member.anonymousRef,
            dictionaryVersion: context.dictionaryVersion,
            confirmationStatus: "pending",
          };
          const key = [
            confirmation.sourceType,
            confirmation.sourceId,
            confirmation.sourcePath,
            confirmation.allergenId,
            confirmation.anonymousMemberRef,
            confirmation.dictionaryVersion,
          ].join("\u0000");
          confirmations.set(key, confirmation);
        }
      }
    }
  }
  return { issues, labelConfirmations: [...confirmations.values()] };
}

export function deriveCurrentGeneratedLabelConfirmations(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
): readonly GeneratedLabelConfirmation[] {
  return evaluateAllergens(menu, context).labelConfirmations;
}
