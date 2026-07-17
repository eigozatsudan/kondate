import { expect, it } from "vitest";
import { evaluateFoodSafetyRules } from "./food-rules.js";
import {
  hardBeanAndReviewedNutRule,
  makeCurrentSafetyContext,
  makeValidatedMenu,
} from "../testing/factories.js";
import type { SafetyAction } from "../contracts/generation.js";

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

function menuWithOwnerlessFishContradiction(options: {
  ingredientName: string;
  contradictionInstruction: string;
}) {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const ingredient = { ...firstDish.ingredients[0]!, name: options.ingredientName };
  const evidenceInstruction = `${ingredient.name}の骨を完全に除く`;

  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [ingredient],
            steps: [{ ...dish.steps[0]!, instruction: evidenceInstruction }],
          }
        : dish,
    ),
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: options.contradictionInstruction,
        dishId: null,
        recipeStepId: null,
      },
    ],
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
        servingCheck: `${evidenceInstruction}ことを確認する`,
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: ingredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: evidenceInstruction,
          },
        ],
      },
    ],
  });
}

function menuWithBoundActionContradiction(options: {
  kind: SafetyAction["kind"];
  targetName: string;
  positiveInstruction: string;
  contradictionInstruction: string;
  contradictionTarget?: "target" | "other";
}) {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const target = { ...firstDish.ingredients[0]!, name: options.targetName };
  const other = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
    name: "にんじん",
  };
  const contradiction =
    options.contradictionTarget === "other"
      ? options.contradictionInstruction.replace(options.targetName, other.name)
      : options.contradictionInstruction;
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [target, other],
            steps: [{ ...dish.steps[0]!, instruction: options.positiveInstruction }],
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
        additionalCutting: options.positiveInstruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: contradiction,
        safetyTags: [],
        safetyActions: [
          {
            kind: options.kind,
            dishId: firstDish.id,
            ingredientId: target.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: options.positiveInstruction,
          },
        ],
      },
    ],
  });
  const rule = {
    ...hardBeanAndReviewedNutRule,
    id: `bound_${options.kind}`,
    matchTerms: [options.targetName],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: options.kind,
  };

  return evaluateFoodSafetyRules(menu, {
    ...underSixContext(),
    foodSafetyRules: [rule],
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

it("does not apply a deboning rule when non-ingredient text alone identifies an ingredient as fish", () => {
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
  ).toEqual([]);
});

it("does not let an ingredient-bound action fabricate a matching fish ingredient", () => {
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
  ).toEqual([]);
});

it("accepts required deboning evidence bound to the matched fish ingredient", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon" }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual([]);
});

it("rejects deboning evidence whose fish name and action belong to different sentences", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({
      actionIngredient: "salmon",
      instruction: "鮭は焼く。にんじんの骨を完全に除く",
    }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it.each(["鮭の骨を除く予定はない", "鮭の骨を取り除く必要はない"])(
  "rejects periphrastically negated deboning evidence: %s",
  (instruction) => {
    const issues = evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    );

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
    );
  },
);

it("安全工程を行わない「ことなく」を除骨の根拠にしない", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({
      actionIngredient: "salmon",
      instruction: "鮭の骨を除くことなく提供する",
    }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("安全工程を行わない「ことなく」を小切りの根拠にしない", () => {
  const base = makeValidatedMenu();
  const adaptations = base.dishes.map((dish, index) => {
    const ingredient = dish.ingredients[0]!;
    const instruction = `${ingredient.name}を小さく切ることなく提供する`;

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

it("長い別食材名の中にある短い食材名を工程の対象根拠にしない", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const firstDish = base.dishes[0]!;
  const salmon = firstDish.ingredients.find((ingredient) => ingredient.name === "鮭")!;
  const salmonFlakes = {
    ...firstDish.ingredients[1]!,
    id: "53000000-0000-4000-8000-000000000004",
    position: 2,
    name: "鮭フレーク",
  };
  const instruction = "鮭フレークの骨を完全に除く";
  const menu = makeValidatedMenu({
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [salmon, salmonFlakes],
            steps: [{ ...dish.steps[0]!, instruction }],
          }
        : dish,
    ),
    adaptations: base.adaptations.map((adaptation) => ({
      ...adaptation,
      additionalCutting: instruction,
      servingCheck: instruction,
      safetyActions: [
        {
          ...adaptation.safetyActions[0]!,
          ingredientId: salmon.id,
          instruction,
        },
        {
          ...adaptation.safetyActions[0]!,
          ingredientId: salmonFlakes.id,
          instruction,
        },
      ],
    })),
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("長い食材名の中の短名を別食材参照とみなさず省略工程を引き継ぐ", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const firstDish = base.dishes[0]!;
  const salmon = firstDish.ingredients.find((ingredient) => ingredient.name === "鮭")!;
  const salmonFlakes = {
    ...firstDish.ingredients[1]!,
    id: "53000000-0000-4000-8000-000000000004",
    position: 2,
    name: "鮭フレーク",
  };
  const salmonInstruction = "鮭を用意し、骨を完全に除く";
  const flakesInstruction = "鮭フレークを用意し、骨を完全に除く";
  const evidenceInstruction = `${salmonInstruction}。${flakesInstruction}`;
  const menu = makeValidatedMenu({
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [salmon, salmonFlakes],
            steps: [{ ...dish.steps[0]!, instruction: evidenceInstruction }],
          }
        : dish,
    ),
    adaptations: base.adaptations.map((adaptation) => ({
      ...adaptation,
      additionalCutting: evidenceInstruction,
      servingCheck: evidenceInstruction,
      safetyActions: [
        {
          ...adaptation.safetyActions[0]!,
          ingredientId: salmon.id,
          instruction: salmonInstruction,
        },
        {
          ...adaptation.safetyActions[0]!,
          ingredientId: salmonFlakes.id,
          instruction: flakesInstruction,
        },
      ],
    })),
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("accepts locally bound deboning evidence followed by an unrelated sentence", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({
      actionIngredient: "salmon",
      instruction: "鮭の骨を完全に除く。にんじんはやわらかく煮る",
    }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual([]);
});

it("accepts a locally bound fish name omitted from the following action clause", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({
      actionIngredient: "salmon",
      instruction: "鮭を中心まで十分に焼き、骨を完全に除いて細かくほぐす",
    }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual([]);
});

it.each(["鮭は焼く、にんじんの骨を完全に除く", "鮭は焼く：にんじんの骨を完全に除く"])(
  "rejects deboning evidence bound to another ingredient across a local boundary: %s",
  (instruction) => {
    const issues = evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    );

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
    );
  },
);

it("requires each fish action to name that fish in the local action clause", () => {
  const instruction = "鮭と鯖を用意し、鮭の骨を完全に除く";
  const base = sourceBoundSafetyMenu({
    actionIngredient: "salmon",
    includeSecondFish: true,
    instruction,
  });
  const firstDish = base.dishes[0]!;
  const mackerel = firstDish.ingredients.find((ingredient) => ingredient.name === "鯖")!;
  const menu = makeValidatedMenu({
    ...base,
    adaptations: base.adaptations.map((adaptation) => ({
      ...adaptation,
      safetyActions: [
        ...adaptation.safetyActions,
        {
          kind: "remove_bones",
          dishId: firstDish.id,
          ingredientId: mackerel.id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: firstDish.steps[0]!.id,
          instruction,
        },
      ],
    })),
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it.each(["鮭の骨を除いたりはしない", "鮭の骨を除くという予定はない"])(
  "rejects indirectly negated deboning evidence: %s",
  (instruction) => {
    const issues = evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    );

    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
    );
  },
);

it.each([
  "鮭の骨を除こうとしない",
  "鮭の骨を除くわけではない",
  "鮭の骨を除くことはない",
  "鮭の骨を除きはしない",
  "鮭の骨を除くふりをする",
  "鮭の骨を除くとは限らない",
])("rejects an unrecognized or negative deboning suffix: %s", (instruction) => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("binds deboning evidence to the nearest preceding ingredient", () => {
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({
      actionIngredient: "salmon",
      instruction: "鮭を焼いた後ににんじんの骨を除く",
    }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
  );
});

it("does not bind another ingredient's local contradiction to salmon", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            steps: [
              {
                ...dish.steps[0]!,
                instruction: "鮭を焼いた後ににんじんの骨を残す",
              },
            ],
          }
        : dish,
    ),
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("binds a local contradiction to its nearest preceding ingredient", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "carrot" });
  const menu = makeValidatedMenu({
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            steps: [
              {
                ...dish.steps[0]!,
                instruction: "鮭を焼いた後ににんじんの骨を残す",
              },
            ],
          }
        : dish,
    ),
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["にんじん"],
      })),
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("rejects a local deboning contradiction even when an earlier clause is affirmative", () => {
  const instruction = "鮭の骨を完全に除く。だが鮭の骨を除かない";
  const issues = evaluateFoodSafetyRules(
    sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
    requiredConstraintContext("remove_bones"),
  );

  expect(issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it.each(["鮭の骨を残す", "鮭の骨を残して提供する", "鮭の骨が残る", "鮭の骨が残ったまま提供する"])(
  "除骨工程と骨を残す指示の矛盾を検出する: %s",
  (contradiction) => {
    const instruction = `鮭の骨を完全に除く。${contradiction}`;

    expect(
      evaluateFoodSafetyRules(
        sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
        requiredConstraintContext("remove_bones"),
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
    );
  },
);

it("別食材の骨を残す指示を鮭の矛盾にしない", () => {
  const instruction = "鮭の骨を完全に除く、にんじんの骨を残す";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it("比較対象として現れた鮭を除骨工程の対象にしない", () => {
  const instruction = "にんじんは鮭より先に骨を除く";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]));
});

it("食材から骨を除く自然な表現を対象食材の除骨工程として扱う", () => {
  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({
        actionIngredient: "salmon",
        instruction: "鮭から骨を完全に除く",
      }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it("骨を残したまま提供する指示を対象食材の除骨矛盾として扱う", () => {
  const instruction = "鮭の骨を完全に除く。鮭の骨を残したまま提供する";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("別食材の骨を残したままにする指示を除骨対象の矛盾にしない", () => {
  const instruction = "鮭の骨を完全に除く。にんじんの骨を残したまま提供する";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it.each(["鮭の骨を完全に除く？", "鮭の骨を完全に除くか？"])(
  "疑問文を除骨済みの根拠にしない: %s",
  (instruction) => {
    expect(
      evaluateFoodSafetyRules(
        sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
        requiredConstraintContext("remove_bones"),
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
    );
  },
);

it.each(["鮭の骨を抜かずに提供する", "鮭の骨を抜かないまま提供する"])(
  "自然な除骨否定を矛盾として検出する: %s",
  (contradiction) => {
    const instruction = `鮭の骨を完全に除く。${contradiction}`;

    expect(
      evaluateFoodSafetyRules(
        sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
        requiredConstraintContext("remove_bones"),
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
    );
  },
);

it("除骨と無関係な切らずという指示を除骨矛盾にしない", () => {
  const instruction = "鮭の骨を完全に除く。鮭は切らずに焼く";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
});

it("食材名に結び付いた小骨の除去を除骨根拠として扱う", () => {
  const instruction = "鮭の小骨を完全に除く";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual([]);
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

it("汎用魚語のownerless工程を同一rule内の具体魚食材へ結合する", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "魚を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["魚", "鮭", "鯖"],
      })),
    }),
  ).toEqual([]);
});

it("汎用魚語のownerless工程は料理内の全具体魚に除骨根拠を要求する", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon", includeSecondFish: true });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "魚を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["魚", "鮭", "鯖"],
      })),
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "age_shape_rule", path: "timeline.0.instruction" }),
    ]),
  );
});

it("汎用魚語は食材名の部分文字列だけでは加工食品へ適用しない", () => {
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient("魚肉ソーセージ"), {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["魚"],
      })),
    }),
  ).toEqual([]);
});

it("汎用魚語と完全一致する食材には除骨要件を適用する", () => {
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient("魚"), {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["魚"],
      })),
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]));
});

it.each(["白身魚", "青魚", "焼き魚", "魚の切り身", "白身魚切り身", "魚フィレ"])(
  "汎用魚語は実食材名 %s の除骨必須条件へ適用する",
  (ingredientName) => {
    const safety = requiredConstraintContext("remove_bones");

    expect(
      evaluateFoodSafetyRules(menuWithNamedIngredient(ingredientName), {
        ...safety,
        foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
          ...rule,
          matchTerms: ["魚"],
        })),
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]),
    );
  },
);

it.each(["白身魚", "青魚", "焼き魚", "魚の切り身", "白身魚切り身", "魚フィレ"])(
  "汎用魚語は実食材名 %s の年齢別ルールへ適用する",
  (ingredientName) => {
    const safety = requiredConstraintContext("remove_bones");

    expect(
      evaluateFoodSafetyRules(menuWithNamedIngredient(ingredientName), {
        ...safety,
        members: safety.members.map((member) => ({
          ...member,
          requiredSafetyConstraints: [],
        })),
        foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
          ...rule,
          matchTerms: ["魚"],
        })),
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "age_shape_rule" })]));
  },
);

it("汎用魚語は加工食品名を年齢別ルールへ誤適用しない", () => {
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient("魚肉ソーセージ"), {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: ["魚"],
      })),
    }),
  ).toEqual([]);
});

it.each([
  ["たい", "たい焼き"],
  ["さけ", "さけるチーズ"],
  ["たい", "めんたいこ"],
] as const)("具体魚語 %s を同音異義の加工食品 %s へ適用しない", (matchTerm, ingredientName) => {
  const safety = requiredConstraintContext("remove_bones");
  const rules = safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: [matchTerm] }));

  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient(ingredientName), {
      ...safety,
      foodSafetyRules: rules,
    }),
  ).toEqual([]);
  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient(ingredientName), {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: rules,
    }),
  ).toEqual([]);
});

it.each([
  ["たい", "たい"],
  ["たい", "たいの切り身"],
  ["たい", "たいフィレ"],
  ["さけ", "さけ"],
  ["さけ", "さけの切り身"],
  ["さけ", "さけフィレ"],
  ["鯛", "鯛の切り身"],
  ["サケ", "サケフィレ"],
  ["鯛", "真鯛"],
  ["鮭", "塩鮭"],
  ["たら", "たらの切り身"],
] as const)("具体魚語 %s を実食材 %s へ適用する", (matchTerm, ingredientName) => {
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menuWithNamedIngredient(ingredientName), {
      ...safety,
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({
        ...rule,
        matchTerms: [matchTerm],
      })),
    }),
  ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "required_safety_action" })]));
});

it("必須工程ルールは実食材へ結び付かない説明文中の魚語同音表現を無視する", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const rice = { ...firstDish.ingredients[0]!, name: "ごはん" };
  const carrot = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
    name: "にんじん",
  };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            description: "温かいうちに食べたい",
            ingredients: [rice, carrot],
          }
        : dish,
    ),
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["たい"] })),
    }),
  ).toEqual([]);
});

it("実食材へ結び付かない説明文中の独立した具体魚語を必須工程の対象にしない", () => {
  const base = makeValidatedMenu();
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            description: "たいを添える",
            ingredients: [{ ...dish.ingredients[0]!, name: "ごはん" }],
          }
        : dish,
    ),
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["たい"] })),
    }),
  ).toEqual([]);
});

it("食材ID付きの非ingredient sourceでも未結合の具体魚語を必須工程の対象にしない", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const rice = { ...firstDish.ingredients[0]!, name: "ごはん" };
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [rice] } : dish,
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
        servingCheck: "確認済み",
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: firstDish.id,
            ingredientId: rice.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "たいを添える",
          },
        ],
      },
    ],
  });
  const safety = requiredConstraintContext("remove_bones");

  expect(
    evaluateFoodSafetyRules(menu, {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["たい"] })),
    }),
  ).toEqual([]);
});

it.each(["温かいうちに食べたい", "めんたいこを添える"])(
  "同じ料理に実食材があっても説明文の埋込み魚語を結合しない: %s",
  (description) => {
    const base = menuWithNamedIngredient("たい");
    const menu = makeValidatedMenu({
      ...base,
      dishes: base.dishes.map((dish, index) => (index === 0 ? { ...dish, description } : dish)),
    });
    const safety = requiredConstraintContext("remove_bones");
    const issues = evaluateFoodSafetyRules(menu, {
      ...safety,
      members: safety.members.map((member) => ({
        ...member,
        requiredSafetyConstraints: [],
      })),
      foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms: ["たい"] })),
    });

    expect(issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "age_shape_rule", path: "dishes.0.description" }),
      ]),
    );
  },
);

it.each([
  {
    ingredientName: "真鯛",
    matchTerms: ["鯛"],
    contradictionInstruction: "真鯛は骨付きのまま焼く",
  },
  {
    ingredientName: "塩鮭",
    matchTerms: ["鮭"],
    contradictionInstruction: "塩鮭は骨付きのまま焼く",
  },
  {
    ingredientName: "たいフィレ",
    matchTerms: ["たい"],
    contradictionInstruction: "たいフィレは骨付きのまま焼く",
  },
  {
    ingredientName: "鮭",
    matchTerms: ["魚", "鮭"],
    contradictionInstruction: "魚フィレは骨付きのまま焼く",
  },
] as const)(
  "修飾・形態付き魚名をownerless矛盾sourceとして評価する: $contradictionInstruction",
  ({ ingredientName, matchTerms, contradictionInstruction }) => {
    const safety = requiredConstraintContext("remove_bones");
    const menu = menuWithOwnerlessFishContradiction({
      ingredientName,
      contradictionInstruction,
    });

    expect(
      evaluateFoodSafetyRules(menu, {
        ...safety,
        foodSafetyRules: safety.foodSafetyRules.map((rule) => ({ ...rule, matchTerms })),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "safety_action_contradiction",
          path: "timeline.0.instruction",
        }),
      ]),
    );
  },
);

it("rejects an ownerless timeline contradiction bound to a matched fish ingredient", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "鮭は骨付きのまま焼く",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("ignores an unbound fish term in an ownerless source", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon" });
  const menu = makeValidatedMenu({
    ...base,
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "鮭と鯖を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("accepts an ownerless source when every matched fish term has verified ingredients", () => {
  const base = sourceBoundSafetyMenu({ actionIngredient: "salmon", includeSecondFish: true });
  const firstDish = base.dishes[0]!;
  const mackerel = firstDish.ingredients.find((ingredient) => ingredient.name === "鯖")!;
  const salmonInstruction = "鮭の骨を完全に除く";
  const mackerelInstruction = "鯖の骨を完全に除く";
  const evidenceInstruction = `${salmonInstruction}。${mackerelInstruction}`;
  const menu = makeValidatedMenu({
    ...base,
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            steps: [{ ...dish.steps[0]!, instruction: evidenceInstruction }],
          }
        : dish,
    ),
    timeline: [
      {
        ...base.timeline[0]!,
        instruction: "鮭と鯖を焼き始める",
        dishId: null,
        recipeStepId: null,
      },
    ],
    adaptations: base.adaptations.map((adaptation) => ({
      ...adaptation,
      additionalCutting: evidenceInstruction,
      servingCheck: `${evidenceInstruction}ことを確認する`,
      safetyActions: [
        ...adaptation.safetyActions,
        {
          kind: "remove_bones",
          dishId: firstDish.id,
          ingredientId: mackerel.id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: firstDish.steps[0]!.id,
          instruction: mackerelInstruction,
        },
      ],
    })),
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("ignores an ownerless timeline source with no matching real ingredient", () => {
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

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
});

it("ignores a dish-owned source whose matching ingredient belongs to another dish", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const secondDish = base.dishes[1]!;
  const carrot = { ...firstDish.ingredients[0]!, name: "にんじん" };
  const mackerel = { ...secondDish.ingredients[0]!, name: "鯖" };
  const instruction = "鯖の骨を完全に除く";
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [carrot],
            steps: [{ ...dish.steps[0]!, instruction: "鯖を焼き始める" }],
          }
        : {
            ...dish,
            ingredients: [mackerel],
            steps: [{ ...dish.steps[0]!, instruction }],
          },
    ),
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: secondDish.id,
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        branchBeforeRecipeStepId: secondDish.steps[0]!.id,
        additionalCutting: instruction,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: `${instruction}ことを確認する`,
        safetyTags: [],
        safetyActions: [
          {
            kind: "remove_bones",
            dishId: secondDish.id,
            ingredientId: mackerel.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: secondDish.steps[0]!.id,
            instruction,
          },
        ],
      },
    ],
  });

  expect(evaluateFoodSafetyRules(menu, requiredConstraintContext("remove_bones"))).toEqual([]);
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

it("無関係な異常時の提供中止で除骨の否定を打ち消さない", () => {
  const instruction = "鮭の骨を除かないが異常の場合は提供しない";

  expect(
    evaluateFoodSafetyRules(
      sourceBoundSafetyMenu({ actionIngredient: "salmon", instruction }),
      requiredConstraintContext("remove_bones"),
    ),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
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

const inverseServingStateCases = [
  {
    kind: "cut_small",
    targetName: "ぶどう",
    positiveInstruction: "ぶどうを小さく切る",
    contradictionInstruction: "ぶどうは大きいまま提供する",
  },
  {
    kind: "quarter_round_food",
    targetName: "ぶどう",
    positiveInstruction: "ぶどうを4等分する",
    contradictionInstruction: "ぶどうは2等分して提供する",
  },
  {
    kind: "soften",
    targetName: "かぼちゃ",
    positiveInstruction: "かぼちゃを十分に煮る",
    contradictionInstruction: "かぼちゃは硬さを残して提供する",
  },
  {
    kind: "heat_thoroughly",
    targetName: "鶏肉",
    positiveInstruction: "鶏肉を中心まで加熱する",
    contradictionInstruction: "鶏肉は生のまま提供する",
  },
] as const;

it.each(inverseServingStateCases)("$kind の工程と対象食材の逆状態を矛盾として扱う", (testCase) => {
  expect(menuWithBoundActionContradiction(testCase)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it.each([
  "すべての食材は丸ごと盛り付ける",
  "全ての食材は丸ごと盛り付ける",
  "全食材を丸ごと盛り付ける",
  "食材はすべて丸ごと盛り付ける",
])("料理内の全食材を対象にした逆状態を対象食材の矛盾として扱う: %s", (instruction) => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: instruction,
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("対象を明示しない逆状態は複数食材へ一律適用しない", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: "食材は丸ごと盛り付ける",
    }),
  ).toEqual([]);
});

it("全食材を対象にした安全工程を逆状態として扱わない", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: "食材はすべて小さく切る",
    }),
  ).toEqual([]);
});

it("安全な全称工程と別食材の局所的な逆状態を対象食材の矛盾として混同しない", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: "すべての食材は小さく切る。にんじんは丸ごと盛り付ける",
    }),
  ).toEqual([]);
});

it("全称範囲と逆状態が同じ文にある指示は対象食材の矛盾として扱う", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: "すべての食材は丸ごと盛り付ける",
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it.each([
  "ぶどうは丸ごとにはせず、小さく切る",
  "ぶどうは丸ごとにせず、小さく切る",
  "ぶどうは丸ごとにしないで、小さく切る",
  "ぶどうは丸ごとではない形に小さく切る",
])("対象食材の逆状態を否定した工程を矛盾として扱わない: %s", (instruction) => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: instruction,
    }),
  ).toEqual([]);
});

it("全食材の逆状態を否定した工程を一律の矛盾として扱わない", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "cut_small",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを小さく切る",
      contradictionInstruction: "すべての食材は丸ごとにはせず、小さく切る",
    }),
  ).toEqual([]);
});

it("やわらかさ要件の対象を硬く仕上げる指示は矛盾として扱う", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "soften",
      targetName: "かぼちゃ",
      positiveInstruction: "かぼちゃを十分に煮る",
      contradictionInstruction: "かぼちゃを硬く仕上げる",
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it("十分な加熱が必要な対象を生で提供する指示は矛盾として扱う", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "heat_thoroughly",
      targetName: "鶏肉",
      positiveInstruction: "鶏肉を中心まで加熱する",
      contradictionInstruction: "鶏肉は生で提供する",
    }),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "safety_action_contradiction" })]),
  );
});

it.each(inverseServingStateCases)(
  "$kind の逆状態が別食材に結び付く場合は対象食材の矛盾にしない",
  (testCase) => {
    expect(menuWithBoundActionContradiction({ ...testCase, contradictionTarget: "other" })).toEqual(
      [],
    );
  },
);

it("2個という数量を4等分工程の矛盾にしない", () => {
  expect(
    menuWithBoundActionContradiction({
      kind: "quarter_round_food",
      targetName: "ぶどう",
      positiveInstruction: "ぶどうを4等分する",
      contradictionInstruction: "ぶどうは2個を用意して提供する",
    }),
  ).toEqual([]);
});

it("does not apply another ingredient's whole-shape contradiction to a cut-small action", () => {
  const base = makeValidatedMenu();
  const firstDish = base.dishes[0]!;
  const grape = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const carrot = {
    ...base.dishes[1]!.ingredients[0]!,
    id: "53000000-0000-4000-8000-000000000003",
    position: 2,
    name: "にんじん",
  };
  const instruction = "ぶどうを小さく切る、にんじんは丸ごと盛り付ける";
  const menu = makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [grape, carrot],
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
        servingCheck: "ぶどうを小さく切ったことを確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: firstDish.id,
            ingredientId: grape.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: firstDish.steps[0]!.id,
            instruction: "ぶどうを小さく切る",
          },
        ],
      },
    ],
  });
  const grapeRule = {
    ...hardBeanAndReviewedNutRule,
    id: "grapes_cut_small",
    matchTerms: ["ぶどう"],
    ruleKind: "requires_tag" as const,
    requiredSafetyTag: "cut_small" as const,
  };

  expect(
    evaluateFoodSafetyRules(menu, { ...underSixContext(), foodSafetyRules: [grapeRule] }),
  ).toEqual([]);
});

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
