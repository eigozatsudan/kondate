import { describe, expect, it } from "vitest";
import { collectMenuTextSources, evaluateAllergens } from "./allergens.js";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../testing/factories.js";

const member = {
  ...makeCurrentSafetyContext().members[0]!,
  allergyStatus: "registered" as const,
  allergenIds: ["egg"],
};
const context = makeCurrentSafetyContext({
  members: [member],
  allergenDictionary: {
    version: "jp-caa-2026-04.v1",
    catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
    aliases: [
      {
        allergenId: "egg",
        alias: "鶏卵",
        normalizedAlias: "鶏卵",
        aliasKind: "derived",
        requiresLabelConfirmation: false,
        dictionaryVersion: "jp-caa-2026-04.v1",
      },
      {
        allergenId: "egg",
        alias: "ドレッシング",
        normalizedAlias: "ドレッシング",
        aliasKind: "processed",
        requiresLabelConfirmation: true,
        dictionaryVersion: "jp-caa-2026-04.v1",
      },
    ],
  },
});

describe("evaluateAllergens", () => {
  it("rejects a derived allergen in recipe text", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? { ...dish, steps: [{ ...dish.steps[0]!, instruction: "鶏卵を混ぜる" }] }
          : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).issues[0]?.code).toBe("direct_allergen_match");
  });

  it("retains canonical processed-food provenance", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "ドレッシング" }] }
          : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).labelConfirmations[0]).toMatchObject({
      sourceType: "ingredient",
      sourceText: "ドレッシング",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
    });
  });
});

it("collects every food-bearing text leaf with canonical paths", () => {
  const base = makeValidatedMenu();
  const menu = makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: base.dishes[0]!.id,
        anonymousMemberRef: "member_1",
        portionText: "少なめ",
        branchBeforeRecipeStepId: base.dishes[0]!.steps[0]!.id,
        additionalCutting: "小さく切る",
        additionalHeating: "追加加熱",
        additionalSeasoning: "薄味",
        servingCheck: "確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: base.dishes[0]!.id,
            ingredientId: base.dishes[0]!.ingredients[0]!.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: base.dishes[0]!.steps[0]!.id,
            instruction: "小さく切る",
          },
        ],
      },
    ],
  });
  expect(collectMenuTextSources(menu).map((source) => source.sourcePath)).toEqual([
    "dishes.0.name",
    "dishes.0.description",
    "dishes.0.ingredients.0.name",
    "dishes.0.ingredients.0.quantityText",
    "dishes.0.ingredients.0.unit",
    "dishes.0.steps.0.instruction",
    "dishes.1.name",
    "dishes.1.description",
    "dishes.1.ingredients.0.name",
    "dishes.1.ingredients.0.quantityText",
    "dishes.1.ingredients.0.unit",
    "dishes.1.steps.0.instruction",
    "timeline.0.instruction",
    "adaptations.0.portionText",
    "adaptations.0.additionalCutting",
    "adaptations.0.additionalHeating",
    "adaptations.0.additionalSeasoning",
    "adaptations.0.servingCheck",
    "adaptations.0.safetyActions.0.instruction",
  ]);
});
