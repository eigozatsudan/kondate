import { expect, it } from "vitest";
import { evaluateFoodSafetyRules } from "./food-rules.js";
import {
  hardBeanAndReviewedNutRule,
  makeCurrentSafetyContext,
  makeValidatedMenu,
} from "../testing/factories.js";

function menuWithNamedIngredient(name: string) {
  const base = makeValidatedMenu();
  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name }] } : dish,
    ),
  });
}

function underSixContext() {
  const base = makeCurrentSafetyContext();
  return makeCurrentSafetyContext({
    members: [{ ...base.members[0]!, ageBand: "age_3_5", requiredSafetyConstraints: [] }],
    foodSafetyRules: [hardBeanAndReviewedNutRule],
  });
}

it.each([
  "煎り大豆",
  "いり大豆",
  "節分豆",
  "落花生",
  "ﾋﾟｰﾅｯﾂ",
  "胡桃",
  "アーモンド",
  "カシュー ナッツ",
  "ピスタチオ",
  "マカダミア ナッツ",
])("forbids reviewed hard bean or nut spelling: %s", (name) => {
  expect(evaluateFoodSafetyRules(menuWithNamedIngredient(name), underSixContext())).toEqual([
    expect.objectContaining({ code: "age_shape_rule" }),
  ]);
});

it.each(["豆腐", "豆乳", "納豆", "大豆の水煮", "やわらかく煮た大豆"])(
  "does not confuse a soft bean product with a hard whole bean: %s",
  (name) => {
    expect(evaluateFoodSafetyRules(menuWithNamedIngredient(name), underSixContext())).toEqual([]);
  },
);

it("does not trust a tag or an action for another ingredient", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeValidatedMenu({
    safetyTags: ["quarter_round_food"],
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "ぶどう" }] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "少なめ",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "にんじんを4等分する",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "確認する",
        safetyTags: ["quarter_round_food"],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: base.dishes[1]!.ingredients[0]!.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "にんじんを4等分する",
          },
        ],
      },
    ],
  });
  const context = underSixContext();
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_under_6",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "quarter_round_food" as const,
  };
  expect(evaluateFoodSafetyRules(menu, { ...context, foodSafetyRules: [grapeRule] })).toEqual([
    expect.objectContaining({ code: "age_shape_rule" }),
  ]);
});
