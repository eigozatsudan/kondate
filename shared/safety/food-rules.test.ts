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

function requiredConstraintContext(required: "remove_bones" | "cut_small") {
  const base = makeCurrentSafetyContext();
  return makeCurrentSafetyContext({
    members: [
      {
        ...base.members[0]!,
        ageBand: "age_3_5",
        requiredSafetyConstraints: [required],
      },
    ],
    foodSafetyRules:
      required === "remove_bones"
        ? [
            {
              ...hardBeanAndReviewedNutRule,
              id: "bones_for_young_and_senior",
              matchTerms: ["鮭", "鯖"],
              ruleKind: "requires_tag",
              requiredSafetyTag: "remove_bones",
            },
          ]
        : [],
  });
}

function sourceBoundSafetyMenu(options: {
  actionIngredient: "salmon" | "carrot";
  includeSecondFish?: boolean;
  instruction?: string;
}) {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const salmon = { ...firstDish.ingredients[0]!, name: "鮭" };
  const carrot = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
    name: "にんじん",
  };
  const mackerel = {
    ...carrot,
    id: "53000000-0000-4000-8000-000000000004",
    position: 3,
    name: "鯖",
  };
  const actionIngredient = options.actionIngredient === "salmon" ? salmon : carrot;
  const actionInstruction = options.instruction ?? `${actionIngredient.name}の骨を完全に除く`;

  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [
              salmon,
              carrot,
              ...(options.includeSecondFish === true ? [mackerel] : []),
            ],
            steps: [{ ...dish.steps[0]!, instruction: actionInstruction }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: actionInstruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: `${actionInstruction}ことを確認する`,
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: actionIngredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: actionInstruction,
          },
        ],
      },
    ],
  });
}

it("rejects required deboning evidence bound to a non-fish ingredient", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "carrot" }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("rejects deboning text that self-identifies a non-fish ingredient as fish", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const instruction = "にんじん（魚）の骨を完全に除く";
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot],
            steps: [{ ...dish.steps[0]!, instruction }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: instruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: instruction,
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: carrot.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction,
          },
        ],
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["魚"] })),
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "age_shape_rule" })]));
});

it("rejects an action that is the only source identifying its ingredient as fish", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const evidenceInstruction = "にんじんの骨を完全に除く";
  const actionInstruction = "にんじん（魚）の骨を完全に除く";
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot],
            steps: [{ ...dish.steps[0]!, instruction: evidenceInstruction }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: evidenceInstruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: evidenceInstruction,
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: carrot.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: actionInstruction,
          },
        ],
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["魚"] })),
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "age_shape_rule" })]));
});

it("accepts required deboning evidence bound to the matched fish ingredient", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon" }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual([]);
});

it("accepts an ownerless timeline source when the same fish ingredient has verified evidence", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "鮭を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("rejects an ownerless timeline source for a different fish ingredient", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "鯖を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "age_shape_rule", path: "timeline.0.instruction" }),
    ]),
  );
});

it("rejects required deboning evidence whose adaptation branch belongs to another dish", () => {
  const menu = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const otherDish = menu.dishes[1]!;
  const mismatchedMenu = makeValidatedMenu({
    ...menu,
    adaptations: menu.adaptations.map((adaptation) => ({
      ...adaptation,
      branchBeforeRecipeStepId: otherDish.steps[0]!.id,
    })),
  });

  expect(
    evaluateFoodSafetyRules(mismatchedMenu, requiredConstraintContext("remove_bones")),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "required_safety_action" }),
      expect.objectContaining({ code: "age_shape_rule" }),
    ]),
  );
});

it("requires deboning evidence for every matched fish ingredient", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon", includeSecondFish: true }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("requires one ingredient-bound cut-small action in every dish", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const ingredient = firstDish.ingredients[0]!;
  const instruction = `${ingredient.name}を小さく切る`;
  const menu = makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: instruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: `${instruction}ことを確認する`,
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: ingredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction,
          },
        ],
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("cut_small"))).toEqual([
    expect.objectContaining({ code: "required_safety_action" }),
  ]);
});

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
        additionalCutting: "1つ目のぶどうを4等分する",
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
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "age_shape_rule",
        path: "dishes.0.ingredients.1.name",
      }),
    ]),
  );
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

it("T5-ER2-01 rejects a required action whose ingredient differs from its evidence text", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const grape = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    name: "ぶどう",
    position: 2,
  };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot, grape],
            steps: [{ ...dish.steps[0]!, instruction: "ぶどうを小さく切る" }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "ぶどうを小さく切る",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "ぶどうの切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: carrot.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "ぶどうを小さく切る",
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

it("T5-ER2-01 rejects a required action whose adaptation targets another ingredient", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const grape = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    name: "ぶどう",
    position: 2,
  };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot, grape],
            steps: [{ ...dish.steps[0]!, instruction: "ぶどうを小さく切る" }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "ぶどうを小さく切る",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "ぶどうの切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: carrot.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "にんじんを小さく切る",
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

it("rejects cut-small evidence expressed as an inability in every dish", () => {
  const base = makeValidatedMenu();
  const adaptations = base.dishes.map((dish, index) => {
    const ingredient = dish.ingredients[0]!;
    const instruction = `${ingredient.name}を小さく切れない`;

    return {
      id: `57000000-0000-4000-8000-00000000000${String(index + 1)}`,
      dishId: dish.id,
      anonymousMemberRef: "member_1",
      portionText: "通常量",
      branchBeforeRecipeStepId: dish.steps[0]!.id,
      additionalCutting: instruction,
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: instruction,
      safetyTags: [],
      safetyActions: [
        {
          kind: "cut_small" as const,
          dishId: dish.id,
          ingredientId: ingredient.id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: dish.steps[0]!.id,
          instruction,
        },
      ],
    };
  });

  expect(
    evaluateFoodSafetyRules(
      makeValidatedMenu({ adaptations }),
      requiredConstraintContext("cut_small"),
    ),
  ).toEqual([expect.objectContaining({ code: "required_safety_action" })]);
});

it.each([
  "鮭の骨を除かずに提供する",
  "鮭の骨を除けません",
  "鮭の骨を除去できません",
  "鮭の骨を取り除けない",
  "鮭の骨を取り除かずに提供する",
  "鮭の骨を取り除くことができません",
  "鮭の骨がないことを確認しない",
  "鮭の骨がないことを確認できません",
])("rejects negated or impossible deboning evidence: %s", (instruction) => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it.each([
  "小さく切らずに提供する",
  "小さく切れません",
  "小さく切ることができません",
  "一口大以下にはしない",
  "一口大以下にできません",
  "細かく刻まずに提供する",
  "細かく刻めない",
  "細かく刻むことができません",
])("rejects negated or impossible cut-small evidence: %s", (evidence) => {
  const base = makeValidatedMenu();
  const adaptations = base.dishes.map((dish, index) => {
    const ingredient = dish.ingredients[0]!;
    const instruction = `${ingredient.name}を${evidence}`;

    return {
      id: `57000000-0000-4000-8000-00000000000${String(index + 1)}`,
      dishId: dish.id,
      anonymousMemberRef: "member_1",
      portionText: "通常量",
      branchBeforeRecipeStepId: dish.steps[0]!.id,
      additionalCutting: instruction,
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: instruction,
      safetyTags: [],
      safetyActions: [
        {
          kind: "cut_small" as const,
          dishId: dish.id,
          ingredientId: ingredient.id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: dish.steps[0]!.id,
          instruction,
        },
      ],
    };
  });

  expect(
    evaluateFoodSafetyRules(
      makeValidatedMenu({ adaptations }),
      requiredConstraintContext("cut_small"),
    ),
  ).toEqual([expect.objectContaining({ code: "required_safety_action" })]);
});

it("accepts deboning evidence followed by a separate safe fallback clause", () => {
  const instruction = "鮭の骨を取り除き、骨がないことを確認できない場合は提供しない";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it("accepts deboning evidence followed by a safe fallback without punctuation", () => {
  const instruction = "鮭の骨を取り除き骨がないことを確認できない場合は提供しない";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it("accepts an instruction that avoids cutting ingredients too small", () => {
  const base = makeValidatedMenu();
  const adaptations = base.dishes.map((dish, index) => {
    const ingredient = dish.ingredients[0]!;
    const instruction = `${ingredient.name}を小さく切りすぎないように調整する`;

    return {
      id: `57000000-0000-4000-8000-00000000000${String(index + 1)}`,
      dishId: dish.id,
      anonymousMemberRef: "member_1",
      portionText: "通常量",
      branchBeforeRecipeStepId: dish.steps[0]!.id,
      additionalCutting: instruction,
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: instruction,
      safetyTags: [],
      safetyActions: [
        {
          kind: "cut_small" as const,
          dishId: dish.id,
          ingredientId: ingredient.id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: dish.steps[0]!.id,
          instruction,
        },
      ],
    };
  });

  expect(
    evaluateFoodSafetyRules(
      makeValidatedMenu({ adaptations }),
      requiredConstraintContext("cut_small"),
    ),
  ).toEqual([]);
});

it.each([
  ["quarter_round_food", "対象食材を4等分できません"],
  ["soften", "対象食材を十分に煮ることができません"],
  ["soften", "対象食材をやわらかくなるまで加熱できません"],
  ["heat_thoroughly", "対象食材を中心まで加熱できません"],
  ["heat_thoroughly", "対象食材の中心温度を確認できません"],
] as const)("rejects impossible %s evidence: %s", (kind, instruction) => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const ingredient = { ...firstDish.ingredients[0]!, name: "対象食材" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [ingredient] } : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: instruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: instruction,
        safetyTags: [],
        safetyActions: [
          {
            kind,
            dishId: firstDish.id,
            ingredientId: ingredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction,
          },
        ],
      },
    ],
  });
  const rule = {
    ...hardBeanAndReviewedNutRule,
    id: `impossible_${kind}`,
    matchTerms: ["対象食材"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: kind,
  };

  expect(evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [rule] })).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("T5-ADV-05 rejects a required cutting action contradicted by polite negation ません", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot],
            steps: [{ ...dish.steps[0]!, instruction: "にんじんを小さく切る" }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "にんじんを小さく切る",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "にんじんを小さく切りません",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: carrot.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "にんじんを小さく切る",
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

it("T5-ADV-06 rejects a required deboning action contradicted by polite negation ません", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const fish = { ...firstDish.ingredients[0]!, name: "鯖" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [fish],
            steps: [{ ...dish.steps[0]!, instruction: "鯖の骨を取り除く" }],
          }
        : dish,
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
        additionalCutting: "鯖の骨を取り除く",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "鯖の骨を取り除きません",
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: fish.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "鯖の骨を取り除く",
          },
        ],
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(evaluateFoodSafetyRules(menu, safety)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
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
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
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

it("T5-DR-01 rejects recipe evidence that names another ingredient", () => {
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
        servingCheck: "にんじんの切り方を確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "quarter_round_food",
            dishId: firstDish.id,
            ingredientId: grape.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "ぶどうを4等分する",
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

function grapeSafetyMenu(options?: {
  ingredientPatch?: { quantityText?: string; unit?: string | null };
  extraAdaptation?: {
    dishId: string;
    anonymousMemberRef: string;
    branchBeforeRecipeStepId: string;
  };
}) {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const grape = {
    ...firstDish.ingredients[0]!,
    name: "ぶどう",
    ...options?.ingredientPatch,
  };
  const actionAdaptation = {
    id: "57000000-0000-4000-8000-000000000001",
    dishId: firstDish.id,
    anonymousMemberRef: "member_1",
    portionText: "通常量",
    branchBeforeRecipeStepId: firstDish.steps[0]!.id,
    additionalCutting: "ぶどうを4等分する",
    additionalHeating: null,
    additionalSeasoning: null,
    servingCheck: "ぶどうの切り方を確認する",
    safetyTags: [],
    safetyActions: [
      {
        kind: "quarter_round_food" as const,
        dishId: firstDish.id,
        ingredientId: grape.id,
        anonymousMemberRef: "member_1",
        beforeRecipeStepId: firstDish.steps[0]!.id,
        instruction: "ぶどうを4等分する",
      },
    ],
  };
  const extraAdaptation = options?.extraAdaptation
    ? {
        id: "57000000-0000-4000-8000-000000000002",
        ...options.extraAdaptation,
        portionText: "通常量",
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "丸ごとのまま提供する",
        safetyTags: [],
        safetyActions: [],
      }
    : null;

  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [grape] } : dish,
    ),
    adaptations: [actionAdaptation, ...(extraAdaptation === null ? [] : [extraAdaptation])],
  });
}

const grapeQuarteringRule = {
  ...hardBeanAndReviewedNutRule,
  id: "grapes_under_6",
  matchTerms: ["ぶどう"],
  ruleKind: "requires_tag" as const,
  requiredSafetyTag: "quarter_round_food" as const,
};

it.each([
  ["quantityText", { quantityText: "丸ごと1個" }],
  ["unit", { unit: "丸ごと" }],
])("T5-CFR-01 rejects a contradiction in the matched ingredient %s", (_field, ingredientPatch) => {
  const issues = evaluateFoodSafetyRules(grapeSafetyMenu({ ingredientPatch }), {
    ...underSixContext(),
    foodSafetyRules: [grapeQuarteringRule],
  });

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("T5-CFR-01 rejects a contradiction in an actionless adaptation for the same member and dish", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const issues = evaluateFoodSafetyRules(
    grapeSafetyMenu({
      extraAdaptation: {
        dishId: firstDish.id,
        anonymousMemberRef: "member_1",
        branchBeforeRecipeStepId: firstDish.steps[0]!.id,
      },
    }),
    { ...underSixContext(), foodSafetyRules: [grapeQuarteringRule] },
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it.each(["other dish", "other member"])(
  "T5-CFR-01 does not mix a contradiction from the %s",
  (scope) => {
    const base = makeValidatedMenu();
    const firstDish = base.dishes[0]!;
    const secondDish = base.dishes[1]!;
    const issues = evaluateFoodSafetyRules(
      grapeSafetyMenu({
        extraAdaptation:
          scope === "other dish"
            ? {
                dishId: secondDish.id,
                anonymousMemberRef: "member_1",
                branchBeforeRecipeStepId: secondDish.steps[0]!.id,
              }
            : {
                dishId: firstDish.id,
                anonymousMemberRef: "member_2",
                branchBeforeRecipeStepId: firstDish.steps[0]!.id,
              },
      }),
      { ...underSixContext(), foodSafetyRules: [grapeQuarteringRule] },
    );

    expect(issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
    );
  },
);
