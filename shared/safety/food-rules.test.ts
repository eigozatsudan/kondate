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

it("requires mitigation for every matched ingredient occurrence", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const firstIngredient = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const secondIngredient = {
    ...firstIngredient,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
  };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [firstIngredient, secondIngredient] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "少なめ",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "4等分する",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: firstIngredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "1つ目のぶどうを4等分する",
          },
        ],
      },
    ],
  });
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_under_6",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "quarter_round_food" as const,
  };

  expect(
    evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [grapeRule] }),
  ).toEqual([
    expect.objectContaining({
      code: "age_shape_rule",
      path: "dishes.0.ingredients.1.name",
    }),
  ]);
});

it("rejects a required household action contradicted by its dish recipe", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            steps: [{ ...dish.steps[0]!, instruction: "食材は丸ごと盛り付ける" }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "少なめ",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "小さく切る",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: firstDish.ingredients[0]!.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "小さく切る",
          },
        ],
      },
    ],
  });
  const safety = makeCurrentSafetyContext({
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        requiredSafetyConstraints: ["cut_small"],
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, safety)).toEqual([
    expect.objectContaining({ code: "required_safety_action" }),
  ]);
});

it("T5-FFR-01 rejects a negated required safety action", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "小さく切らない",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "切らないことを確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: firstDish.ingredients[0]!.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "小さく切らない",
          },
        ],
      },
    ],
  });
  const safety = makeCurrentSafetyContext({
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        requiredSafetyConstraints: ["cut_small"],
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, safety)).toEqual([
    expect.objectContaining({ code: "required_safety_action" }),
  ]);
});

it("T5-EXIT-04 rejects quartering evidence negated with Japanese せず", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const grape = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [grape] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "4等分せず盛り付ける",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: grape.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "ぶどうを4等分せず盛り付ける",
          },
        ],
      },
    ],
  });
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_under_6",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "quarter_round_food" as const,
  };

  expect(
    evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [grapeRule] }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "age_shape_rule" })]));
});

it("T5-FFR-02 rejects mitigation text that names a different ingredient", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const grape = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const carrot = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
  };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [grape, carrot] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "にんじんを4等分する",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: grape.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "にんじんを4等分する",
          },
        ],
      },
    ],
  });
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_under_6",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "quarter_round_food" as const,
  };

  expect(
    evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [grapeRule] }),
  ).toEqual([expect.objectContaining({ code: "age_shape_rule" })]);
});

it("T5-FR-01 rejects action-only mitigation without recipe or adaptation evidence", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const grape = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [grape] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "通常どおり取り分ける",
        safetyTags: [],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: grape.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "4等分する",
          },
        ],
      },
    ],
  });
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_under_6",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "quarter_round_food" as const,
  };

  expect(
    evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [grapeRule] }),
  ).toEqual([expect.objectContaining({ code: "age_shape_rule" })]);
});
