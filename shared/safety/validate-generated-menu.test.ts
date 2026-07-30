import { expect, it } from "vitest";
import { menuValidationIssueCodes, type GeneratedMenu } from "../contracts/generation.js";
import { collectPlannerRequestText } from "../contracts/planner.js";
import { currentFoodSafetyRulesV1 } from "./current-food-safety-rules.v1.js";
import { validateGeneratedMenu } from "./validate-generated-menu.js";
import {
  hardBeanAndReviewedNutRule,
  makeCurrentSafetyContext,
  makeGeneratedMenu,
  makeGenerationContext,
  makeIdeaGenerationContext,
  underSixHardBeanAndNutContext,
} from "../testing/factories.js";
import { createIdeaSafetyFingerprint } from "./idea-fingerprint.js";

function expectIssueCodes(
  result: ReturnType<typeof validateGeneratedMenu>,
  expectedCodes: readonly string[],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("検証エラーを期待しました");
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([...expectedCodes]),
  );
}

function expectOnlyIssueCode(
  result: ReturnType<typeof validateGeneratedMenu>,
  expectedCode: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("検証エラーを期待しました");
  expect(result.issues.map((issue) => issue.code)).toEqual([expectedCode]);
}

function menuWithIngredient(name: string) {
  const base = makeGeneratedMenu();
  return makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 1 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name }] } : dish,
    ),
  });
}

function wheatSafetyContext() {
  const base = makeCurrentSafetyContext();
  return makeCurrentSafetyContext({
    members: [
      {
        ...base.members[0]!,
        allergyStatus: "registered",
        allergenIds: ["wheat"],
      },
    ],
    allergenDictionary: {
      version: "jp-caa-2026-04.v1",
      catalog: [{ id: "wheat", displayName: "小麦", catalogVersion: "jp-caa-2026-04.v1" }],
      aliases: [
        {
          allergenId: "wheat",
          alias: "小麦",
          normalizedAlias: "小麦",
          aliasKind: "direct",
          requiresLabelConfirmation: false,
          dictionaryVersion: "jp-caa-2026-04.v1",
        },
        {
          allergenId: "wheat",
          alias: "カレールー",
          normalizedAlias: "カレールー",
          aliasKind: "processed",
          requiresLabelConfirmation: true,
          dictionaryVersion: "jp-caa-2026-04.v1",
        },
      ],
    },
  });
}

type FoodTextLeaf =
  | "dishName"
  | "dishDescription"
  | "ingredientName"
  | "ingredientQuantityText"
  | "ingredientUnit"
  | "recipeInstruction"
  | "timelineInstruction"
  | "portionText"
  | "additionalCutting"
  | "additionalHeating"
  | "additionalSeasoning"
  | "servingCheck"
  | "safetyActionInstruction";

function menuWithWheatInLeaf(leaf: FoodTextLeaf): GeneratedMenu {
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const firstIngredient = firstDish.ingredients[0]!;
  const firstStep = firstDish.steps[0]!;
  const firstAdaptation = base.adaptations[0]!;
  const dishes = base.dishes.map((dish, index) =>
    index !== 0
      ? dish
      : {
          ...dish,
          name: leaf === "dishName" ? "小麦" : dish.name,
          description: leaf === "dishDescription" ? "小麦" : dish.description,
          ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
            ingredientIndex !== 0
              ? ingredient
              : {
                  ...ingredient,
                  name: leaf === "ingredientName" ? "小麦" : ingredient.name,
                  quantityText:
                    leaf === "ingredientQuantityText" ? "小麦" : ingredient.quantityText,
                  unit: leaf === "ingredientUnit" ? "小麦" : ingredient.unit,
                },
          ),
          steps: dish.steps.map((step, stepIndex) =>
            stepIndex === 0 && leaf === "recipeInstruction"
              ? { ...step, instruction: "小麦" }
              : step,
          ),
        },
  );
  const timeline = base.timeline.map((step, index) =>
    index === 0 && leaf === "timelineInstruction" ? { ...step, instruction: "小麦" } : step,
  );
  const adaptations = [
    {
      ...firstAdaptation,
      portionText: leaf === "portionText" ? "小麦" : firstAdaptation.portionText,
      additionalCutting: leaf === "additionalCutting" ? "小麦" : null,
      additionalHeating: leaf === "additionalHeating" ? "小麦" : null,
      additionalSeasoning: leaf === "additionalSeasoning" ? "小麦" : null,
      servingCheck: leaf === "servingCheck" ? "小麦" : firstAdaptation.servingCheck,
      safetyActions:
        leaf === "safetyActionInstruction"
          ? [
              {
                kind: "heat_thoroughly" as const,
                dishId: firstDish.id,
                ingredientId: firstIngredient.id,
                anonymousMemberRef: "member_1",
                beforeRecipeStepId: firstStep.id,
                instruction: "小麦",
              },
            ]
          : [],
    },
  ];
  return makeGeneratedMenu({ dishes, timeline, adaptations });
}

it("blocks unconfirmed allergy, unsupported scope, and unsupported memo", () => {
  const context = makeCurrentSafetyContext({
    requestText: "離乳食にして",
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        allergyStatus: "unconfirmed",
        unsupportedDietStatus: "unconfirmed",
      },
    ],
  });
  const result = validateGeneratedMenu(
    makeGeneratedMenu(),
    makeGenerationContext({ safety: context }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("安全性エラーを期待しました");
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([
      "allergy_unconfirmed",
      "unsupported_diet_unconfirmed",
      "unsupported_medical_request",
    ]),
  );
});

it.each([
  { mainIngredients: ["離乳食"], avoidIngredients: [], memo: "" },
  { mainIngredients: ["鶏肉"], avoidIngredients: ["嚥下食"], memo: "" },
])("rejects unsupported medical requests projected from planner fields", (submissionPatch) => {
  const base = makeGenerationContext();
  const submission = { ...base.submission, ...submissionPatch };
  const context = makeGenerationContext({
    submission,
    safety: makeCurrentSafetyContext({
      requestText: collectPlannerRequestText(submission),
    }),
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), [
    "unsupported_medical_request",
  ]);
});

it("rejects provider-confirmed state and canonicalizes pending processed-food provenance", () => {
  const base = makeGeneratedMenu();
  const ingredient = base.dishes[0]!.ingredients[0]!;
  const menu = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [{ ...ingredient, name: "ドレッシング" }] } : dish,
    ),
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: ingredient.id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "偽装された表示名",
        allergenId: "egg",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ],
  });
  const safety = makeCurrentSafetyContext({
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        allergyStatus: "registered",
        allergenIds: ["egg"],
      },
    ],
    allergenDictionary: {
      version: "jp-caa-2026-04.v1",
      catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
      aliases: [
        {
          allergenId: "egg",
          alias: "卵",
          normalizedAlias: "卵",
          aliasKind: "direct",
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
  const confirmed = {
    ...menu,
    labelConfirmations: [{ ...menu.labelConfirmations[0]!, confirmationStatus: "confirmed" }],
  };
  const generationContext = makeGenerationContext({
    safety,
    submission: {
      ...makeGenerationContext().submission,
      mainIngredients: ["ドレッシング"],
    },
  });
  expect(validateGeneratedMenu(confirmed, generationContext).ok).toBe(false);
  expect(validateGeneratedMenu(menu, generationContext)).toMatchObject({
    ok: true,
    menu: {
      labelConfirmations: [
        {
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "ドレッシング",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    },
  });
});

it("rejects an omitted submitted must-use pantry item", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000001";
  const context = makeGenerationContext({
    submission: {
      ...makeGenerationContext().submission,
      pantrySelections: [{ pantryItemId, priority: "must_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "にんじん",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), ["must_use_missing"]);
});

it.each([
  {
    name: "meal type",
    menu: makeGeneratedMenu(),
    context: makeGenerationContext({
      submission: { ...makeGenerationContext().submission, mealType: "lunch" },
    }),
    code: "meal_type_mismatch",
  },
  {
    name: "genre",
    menu: makeGeneratedMenu(),
    context: makeGenerationContext({
      submission: { ...makeGenerationContext().submission, cuisineGenre: "western" },
    }),
    code: "genre_mismatch",
  },
  {
    name: "time limit",
    menu: makeGeneratedMenu({ totalElapsedMinutes: 30 }),
    context: makeGenerationContext({
      submission: { ...makeGenerationContext().submission, timeLimitMinutes: 15 },
    }),
    code: "time_limit_exceeded",
  },
  {
    name: "avoid ingredient",
    menu: makeGeneratedMenu(),
    context: makeGenerationContext({
      submission: { ...makeGenerationContext().submission, avoidIngredients: ["ごはん"] },
    }),
    code: "avoid_ingredient_used",
  },
  {
    name: "required dish role",
    menu: makeGeneratedMenu({
      dishes: makeGeneratedMenu().dishes.map((dish) => ({ ...dish, role: "main" })),
    }),
    context: makeGenerationContext(),
    code: "required_dish_role_missing",
  },
])("T5-RR-01 reports the exact validator issue for $name", ({ menu, context, code }) => {
  expectOnlyIssueCode(validateGeneratedMenu(menu, context), code);
});

it("T5-RR-01 reports prefer_use_reason_missing at the validator boundary", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000011";
  const selectionId = "58000000-0000-4000-8000-000000000012";
  const menu = makeGeneratedMenu({
    pantryUsage: [
      {
        selectionId,
        pantryItemId,
        pantryItemName: "にんじん",
        priority: "prefer_use",
        usageStatus: "unused",
        plannedQuantity: 1,
        inventoryQuantity: 1,
        shortageQuantity: 0,
        unit: "本",
        dishIds: [],
        unusedReason: null,
      },
    ],
  });
  const context = makeGenerationContext({
    submission: {
      ...makeGenerationContext().submission,
      pantrySelections: [{ pantryItemId, priority: "prefer_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "にんじん",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectOnlyIssueCode(validateGeneratedMenu(menu, context), "prefer_use_reason_missing");
});

it("rejects forged pantry provenance that disagrees with the trusted item name", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000001";
  const selectionId = "58000000-0000-4000-8000-000000000002";
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [
              {
                ...dish.ingredients[0]!,
                name: "にんじん",
                pantrySelectionId: selectionId,
              },
            ],
          }
        : dish,
    ),
    pantryUsage: [
      {
        selectionId,
        pantryItemId,
        pantryItemName: "にんじん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 1,
        inventoryQuantity: 1,
        shortageQuantity: 0,
        unit: "本",
        dishIds: [firstDish.id],
        unusedReason: null,
      },
    ],
  });
  const context = makeGenerationContext({
    submission: {
      ...makeGenerationContext().submission,
      pantrySelections: [{ pantryItemId, priority: "must_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "卵入りドレッシング",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["pantry_usage_link_mismatch"]);
});

it("requires exact member adaptations and enforces member preferences", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    memberPreferences: [
      {
        ...base.memberPreferences[0]!,
        portionSize: "small",
        spiceLevel: "none",
        easePreferences: ["boneless"],
        dislikes: ["ごはん"],
      },
    ],
  });

  // adaptations 欠落は hard。苦手ごはんは soft のため codes には出ない。
  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu({ adaptations: [] }), context), [
    "target_member_mismatch",
    "member_preference_mismatch",
  ]);
});

it("A-I7 treats dislikes as soft gaps while keeping portion/spice/ease hard", () => {
  const base = makeGenerationContext();
  const baseMenu = makeGeneratedMenu();
  // portion/spice/ease を満たす adaptation 本文と safetyActions を用意し、dislikes だけ unmet にする
  const context = makeGenerationContext({
    memberPreferences: [
      {
        ...base.memberPreferences[0]!,
        portionSize: "regular",
        spiceLevel: "regular",
        easePreferences: [],
        dislikes: ["ごはん"],
      },
    ],
  });
  const result = validateGeneratedMenu(baseMenu, context);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.preferenceGaps).toEqual([
    expect.objectContaining({
      kind: "dislike",
      dislikeToken: "ごはん",
      message: expect.stringContaining("ごはん") as string,
    }),
  ]);
});

it.each([
  ["small", "none", "少な目に取り分け、辛みなしで味付けする"],
  ["small", "none", "量を控え、香辛料を使わない"],
  ["small", "mild", "小盛で、あっさり薄味にする"],
  ["large", "none", "大盛に増量し、辛いものを使わない"],
  ["large", "mild", "しっかりめの量で、塩分控えめの甘口にする"],
  // Luna 実レス: 小さめは量 small の自然な言い回し（UI の食べやすさ語と重なるが許容する）
  ["small", "regular", "主菜は小さめの1切れを目安に取り分ける。"],
  ["small", "regular", "身を小さめにほぐす。"],
  ["small", "none", "少し少なめに盛り、唐辛子を使わない"],
  ["small", "none", "お子様盛りで、辛くせず味付けする"],
  ["small", "mild", "半分の量にし、まろやかな薄味に仕上げる"],
  ["large", "none", "たっぷりめに盛り、ピリ辛なしにする"],
  ["large", "mild", "山盛りにし、やさしい味で塩控えめにする"],
  ["small", "none", "量は小さめで、香辛料抜きにする"],
  ["large", "none", "量を増やし、辛味を加えない"],
] as const)(
  "accepts expanded portion/spice wording hard matches: %s / %s / %s",
  (portionSize, spiceLevel, wording) => {
    const base = makeGenerationContext();
    const baseMenu = makeGeneratedMenu();
    const adaptation = baseMenu.adaptations[0]!;
    const menu = makeGeneratedMenu({
      adaptations: [
        {
          ...adaptation,
          portionText: wording,
          additionalSeasoning: wording,
          servingCheck: wording,
        },
      ],
    });
    const context = makeGenerationContext({
      memberPreferences: [
        {
          ...base.memberPreferences[0]!,
          portionSize,
          spiceLevel,
          easePreferences: [],
          dislikes: [],
        },
      ],
    });
    expect(validateGeneratedMenu(menu, context)).toMatchObject({ ok: true });
  },
);

it("still hard-fails when portion/spice wording is unrelated", () => {
  const base = makeGenerationContext();
  const baseMenu = makeGeneratedMenu();
  const adaptation = baseMenu.adaptations[0]!;
  const menu = makeGeneratedMenu({
    adaptations: [
      {
        ...adaptation,
        portionText: "通常どおり",
        additionalSeasoning: "いつもの味",
        servingCheck: "盛り付けを確認",
      },
    ],
  });
  const context = makeGenerationContext({
    memberPreferences: [
      {
        ...base.memberPreferences[0]!,
        portionSize: "small",
        spiceLevel: "none",
        easePreferences: [],
        dislikes: [],
      },
    ],
  });
  expectIssueCodes(validateGeneratedMenu(menu, context), ["member_preference_mismatch"]);
});

it("does not count a negated timeline-only mention as a requested main ingredient", () => {
  const menu = makeGeneratedMenu({
    timeline: [
      {
        ...makeGeneratedMenu().timeline[0]!,
        instruction: "鶏肉は使わない",
      },
    ],
  });
  const context = makeGenerationContext({
    submission: { ...makeGenerationContext().submission, mainIngredients: ["鶏肉"] },
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["main_ingredient_missing"]);
});

it.each([
  ["鮭", "サーモン"],
  ["サーモン", "鮭"],
  ["さけ", "サーモン"],
  ["しゃけ", "鮭"],
  ["鮭", "紅鮭"],
  ["鮭", "鮭フレーク"],
] as const)("accepts reviewed salmon synonyms from %s to %s", (requested, generated) => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [requested] },
  });

  expect(validateGeneratedMenu(menuWithIngredient(generated), context)).toMatchObject({ ok: true });
});

it("accepts a reviewed salmon synonym in a dish name", () => {
  const base = makeGenerationContext();
  const baseMenu = makeGeneratedMenu();
  const menu = makeGeneratedMenu({
    dishes: baseMenu.dishes.map((dish, index) =>
      index === 0 ? { ...dish, name: "サーモンのムニエル" } : dish,
    ),
  });
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: ["鮭"] },
  });

  expect(validateGeneratedMenu(menu, context)).toMatchObject({ ok: true });
});

it.each([
  ["鮭", "鮭風味"],
  ["サーモン", "サーモン風調味料"],
] as const)("does not count a flavor-only expression from %s to %s", (requested, generated) => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [requested] },
  });

  expectIssueCodes(validateGeneratedMenu(menuWithIngredient(generated), context), [
    "main_ingredient_missing",
  ]);
});

it.each(["name", "description"] as const)(
  "does not count a flavor-only salmon expression in dish %s",
  (field) => {
    const base = makeGenerationContext();
    const baseMenu = makeGeneratedMenu();
    const menu = makeGeneratedMenu({
      dishes: baseMenu.dishes.map((dish, index) =>
        index === 0 ? { ...dish, [field]: "鮭の風味を再現したパスタ" } : dish,
      ),
    });
    const context = makeGenerationContext({
      submission: { ...base.submission, mainIngredients: ["鮭"] },
    });

    expectIssueCodes(validateGeneratedMenu(menu, context), ["main_ingredient_missing"]);
  },
);

it.each([
  ["鮭", "さけるチーズ"],
  ["鮭", "サーモン風ソース"],
] as const)("does not count an embedded salmon alias from %s to %s", (requested, generated) => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [requested] },
  });

  expectIssueCodes(validateGeneratedMenu(menuWithIngredient(generated), context), [
    "main_ingredient_missing",
  ]);
});

// 先行ひらがなだけでは「さけ」を除外しない（焼きさけ＝実食材、さけるチーズ＝動詞連続のみ除外）
it.each([
  ["鮭", "焼きさけ"],
  ["さけ", "焼きさけ"],
] as const)(
  "accepts grilled salmon kana compound from %s to %s without left-hiragana rejection",
  (requested, generated) => {
    const base = makeGenerationContext();
    const context = makeGenerationContext({
      submission: { ...base.submission, mainIngredients: [requested] },
    });

    expect(validateGeneratedMenu(menuWithIngredient(generated), context)).toMatchObject({
      ok: true,
    });
  },
);

it("accepts real salmon after a particle in dish description", () => {
  const base = makeGenerationContext();
  const baseMenu = makeGeneratedMenu();
  const menu = makeGeneratedMenu({
    dishes: baseMenu.dishes.map((dish, index) =>
      index === 0 ? { ...dish, description: "素材はさけ" } : dish,
    ),
  });
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: ["鮭"] },
  });

  expect(validateGeneratedMenu(menu, context)).toMatchObject({ ok: true });
});

// I3: 酒・色名など非食材文脈は狭く拒否（先行ひらがな一律拒否は再導入しない）
it.each([
  ["鮭", "おさけに合う一品"],
  ["さけ", "おさけに合う一品"],
  ["鮭", "サーモンピンクの彩り"],
  ["サーモン", "サーモンピンクの彩り"],
] as const)("I3: does not count non-food salmon context from %s to %s", (requested, generated) => {
  const base = makeGenerationContext();
  const baseMenu = makeGeneratedMenu();
  const menu = makeGeneratedMenu({
    dishes: baseMenu.dishes.map((dish, index) =>
      index === 0 ? { ...dish, description: generated } : dish,
    ),
  });
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [requested] },
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["main_ingredient_missing"]);
});

it.each([
  ["鮭", "鯖"],
  ["鮭フレーク", "サーモン"],
] as const)("does not widen salmon synonyms from %s to %s", (requested, generated) => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [requested] },
  });

  expectIssueCodes(validateGeneratedMenu(menuWithIngredient(generated), context), [
    "main_ingredient_missing",
  ]);
});

it("T5-FR-02 rejects missing preferences for a target member", () => {
  expectIssueCodes(
    validateGeneratedMenu(makeGeneratedMenu(), makeGenerationContext({ memberPreferences: [] })),
    ["member_preference_mismatch"],
  );
});

it("T5-FR-02 rejects swapped UUID and anonymous-ref ownership", () => {
  const firstMemberId = "55000000-0000-4000-8000-000000000001";
  const secondMemberId = "55000000-0000-4000-8000-000000000002";
  const base = makeGenerationContext();
  const secondAdaptation = {
    ...makeGeneratedMenu().adaptations[0]!,
    id: "57000000-0000-4000-8000-000000000002",
    anonymousMemberRef: "member_2",
    safetyActions: [],
  };
  const context = makeGenerationContext({
    submission: {
      ...base.submission,
      targetMemberIds: [firstMemberId, secondMemberId],
    },
    targetMembers: [
      { householdMemberId: firstMemberId, anonymousRef: "member_1", displayNameSnapshot: "家族1" },
      { householdMemberId: secondMemberId, anonymousRef: "member_2", displayNameSnapshot: "家族2" },
    ],
    safety: makeCurrentSafetyContext({
      members: [
        { ...base.safety.members[0]!, householdMemberId: firstMemberId, anonymousRef: "member_2" },
        { ...base.safety.members[0]!, householdMemberId: secondMemberId, anonymousRef: "member_1" },
      ],
    }),
    memberPreferences: [
      {
        ...base.memberPreferences[0]!,
        householdMemberId: firstMemberId,
        anonymousMemberRef: "member_2",
      },
      {
        ...base.memberPreferences[0]!,
        householdMemberId: secondMemberId,
        anonymousMemberRef: "member_1",
      },
    ],
  });

  expectIssueCodes(
    validateGeneratedMenu(
      makeGeneratedMenu({
        adaptations: [makeGeneratedMenu().adaptations[0]!, secondAdaptation],
      }),
      context,
    ),
    ["target_member_mismatch"],
  );
});

it("T5-FR-03 rejects an incomplete or mixed-version allergen context", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    safety: makeCurrentSafetyContext({
      dictionaryVersion: "jp-caa-2026-05.v2",
      members: [
        {
          ...base.safety.members[0]!,
          allergyStatus: "registered",
          allergenIds: ["egg"],
        },
      ],
      allergenDictionary: {
        version: "jp-caa-2026-04.v1",
        catalog: [],
        aliases: [],
      },
    }),
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), [
    "safety_context_incomplete",
  ]);
});

it("T5-EXIT-01 rejects a current dictionary without the direct display alias", () => {
  const base = makeGenerationContext();
  const generated = makeGeneratedMenu();
  const menu = makeGeneratedMenu({
    dishes: generated.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "卵" }] } : dish,
    ),
  });
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: ["卵"] },
    safety: makeCurrentSafetyContext({
      members: [
        {
          ...base.safety.members[0]!,
          allergyStatus: "registered",
          allergenIds: ["egg"],
        },
      ],
      allergenDictionary: {
        version: "jp-caa-2026-04.v1",
        catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
        aliases: [
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
    }),
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["safety_context_incomplete"]);
});

it("T5-FR-03 rejects mixed-version child food rules", () => {
  const base = makeGenerationContext();
  const child = { ...base.safety.members[0]!, ageBand: "age_3_5" as const };
  const mixedRules = makeGenerationContext({
    safety: makeCurrentSafetyContext({
      members: [child],
      foodSafetyRules: [
        { ...hardBeanAndReviewedNutRule, ruleVersion: "jp-caa-child-shape-2026-06.v0" },
      ],
    }),
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), mixedRules), [
    "safety_context_incomplete",
  ]);
});

it.each(["豆腐", "豆乳", "納豆", "大豆の水煮", "やわらかく煮た大豆"])(
  "T5-ER2-02 accepts a soft bean product with the exact one-rule context: %s",
  (name) => {
    expect(
      validateGeneratedMenu(menuWithIngredient(name), underSixHardBeanAndNutContext()).ok,
    ).toBe(true);
  },
);

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
])("T5-DR-03 rejects an exact reviewed hard bean or nut at the validator boundary: %s", (name) => {
  expectIssueCodes(
    validateGeneratedMenu(menuWithIngredient(name), underSixHardBeanAndNutContext()),
    ["age_shape_rule"],
  );
});

it("T5-DR-02 reports a safety action contradiction separately from missing evidence", () => {
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const grape = { ...firstDish.ingredients[0]!, name: "ぶどう" };
  const menu = makeGeneratedMenu({
    safetyTags: ["quarter_round_food"],
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [grape],
            steps: [{ ...dish.steps[0]!, instruction: "ぶどうは丸ごと盛り付ける" }],
          }
        : dish,
    ),
    adaptations: [
      {
        ...base.adaptations[0]!,
        additionalCutting: "ぶどうを4等分する",
        servingCheck: "ぶどうの切り方を確認する",
        safetyTags: ["quarter_round_food"],
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
  const context = makeGenerationContext({
    submission: { ...makeGenerationContext().submission, mainIngredients: ["ぶどう"] },
    safety: makeCurrentSafetyContext({
      members: [{ ...makeCurrentSafetyContext().members[0]!, ageBand: "age_3_5" }],
      foodSafetyRules: [
        {
          ...hardBeanAndReviewedNutRule,
          id: "grapes_under_6",
          matchTerms: ["ぶどう"],
          ruleKind: "requires_tag",
          requiredSafetyTag: "quarter_round_food",
        },
      ],
    }),
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["safety_action_contradiction"]);
});

it("T5-FFR-04 rejects a hypertension therapeutic low-sodium request", () => {
  const context = makeGenerationContext({
    safety: makeCurrentSafetyContext({ requestText: "高血圧向けの減塩食にして" }),
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), [
    "unsupported_medical_request",
  ]);
});

it("T5-FR-05 rejects forged provenance and ingredient linkage on an unused pantry row", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000001";
  const selectionId = "58000000-0000-4000-8000-000000000002";
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [
              { ...dish.ingredients[0]!, name: "にんじん", pantrySelectionId: selectionId },
            ],
          }
        : dish,
    ),
    pantryUsage: [
      {
        selectionId,
        pantryItemId,
        pantryItemName: "偽装食材名",
        priority: "prefer_use",
        usageStatus: "unused",
        plannedQuantity: null,
        inventoryQuantity: null,
        shortageQuantity: null,
        unit: null,
        dishIds: [firstDish.id],
        unusedReason: "使わなかった",
      },
    ],
  });
  const generation = makeGenerationContext();
  const context = makeGenerationContext({
    submission: {
      ...generation.submission,
      pantrySelections: [{ pantryItemId, priority: "prefer_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "にんじん",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["pantry_usage_link_mismatch"]);
});

it.each([
  ["dish name", "dishName"],
  ["dish description", "dishDescription"],
  ["ingredient name", "ingredientName"],
  ["ingredient quantity", "ingredientQuantityText"],
  ["ingredient unit", "ingredientUnit"],
  ["recipe instruction", "recipeInstruction"],
  ["timeline instruction", "timelineInstruction"],
  ["portion text", "portionText"],
  ["additional cutting", "additionalCutting"],
  ["additional heating", "additionalHeating"],
  ["additional seasoning", "additionalSeasoning"],
  ["serving check", "servingCheck"],
  ["safety action instruction", "safetyActionInstruction"],
] as const)("T10 scans the actual allergen value in every food-text leaf: %s", (_name, leaf) => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: [] },
    safety: wheatSafetyContext(),
  });

  expectIssueCodes(validateGeneratedMenu(menuWithWheatInLeaf(leaf), context), [
    "direct_allergen_match",
  ]);
});

it("T10 canonicalizes a linked pantry product through the ingredient leaf only", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000021";
  const selectionId = "58000000-0000-4000-8000-000000000022";
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const ingredient = {
    ...firstDish.ingredients[0]!,
    name: "カレールー",
    pantrySelectionId: selectionId,
  };
  const generated = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [ingredient] } : dish,
    ),
    pantryUsage: [
      {
        selectionId,
        pantryItemId,
        pantryItemName: "カレールー",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 1,
        inventoryQuantity: 1,
        shortageQuantity: 0,
        unit: "箱",
        dishIds: [firstDish.id],
        unusedReason: null,
      },
    ],
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: ingredient.id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "provider text is ignored",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ],
  });
  const baseContext = makeGenerationContext();
  const context = makeGenerationContext({
    submission: {
      ...baseContext.submission,
      mainIngredients: ["カレールー"],
      pantrySelections: [{ pantryItemId, priority: "must_use" }],
    },
    safety: wheatSafetyContext(),
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "カレールー",
        quantity: 1,
        unit: "箱",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  const result = validateGeneratedMenu(generated, context);
  expect(result).toMatchObject({
    ok: true,
    menu: {
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: ingredient.id,
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "カレールー",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    },
  });
  if (!result.ok) throw new Error("在庫食材の正規化成功を期待しました");
  expect(result.menu.labelConfirmations).toEqual(result.labelConfirmations);
  expect(JSON.stringify(result.labelConfirmations)).not.toContain(selectionId);
});

it("T10 requires a structured action for a post_weaning_to_2 target's cut_small condition", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    safety: makeCurrentSafetyContext({
      members: [
        {
          ...base.safety.members[0]!,
          ageBand: "post_weaning_to_2",
          requiredSafetyConstraints: ["cut_small"],
        },
      ],
    }),
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), ["required_safety_action"]);
});

it("T10 requires a structured remove_bones action when a senior menu contains fish", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    safety: makeCurrentSafetyContext({
      members: [
        {
          ...base.safety.members[0]!,
          ageBand: "senior",
          requiredSafetyConstraints: ["remove_bones"],
        },
      ],
      foodSafetyRules: currentFoodSafetyRulesV1,
    }),
  });

  expectIssueCodes(validateGeneratedMenu(menuWithIngredient("鮭"), context), [
    "required_safety_action",
  ]);
});

it("T10 does not require a fabricated remove_bones action when a senior menu has no fish", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    safety: makeCurrentSafetyContext({
      members: [
        {
          ...base.safety.members[0]!,
          ageBand: "senior",
          requiredSafetyConstraints: ["remove_bones"],
        },
      ],
      foodSafetyRules: currentFoodSafetyRulesV1,
    }),
  });

  expect(validateGeneratedMenu(makeGeneratedMenu(), context)).toMatchObject({ ok: true });
});

it("T10 conservatively excludes mochi for a senior target", () => {
  const base = makeGenerationContext();
  const mochiRule = {
    ...hardBeanAndReviewedNutRule,
    id: "mochi_senior",
    appliesToAgeBands: ["senior" as const],
    matchTerms: ["餅"],
    userMessage: "高齢者には餅を使用できません",
  };
  const context = makeGenerationContext({
    submission: { ...base.submission, mainIngredients: ["餅"] },
    safety: makeCurrentSafetyContext({
      members: [{ ...base.safety.members[0]!, ageBand: "senior" }],
      foodSafetyRules: [mochiRule],
    }),
  });

  expectIssueCodes(validateGeneratedMenu(menuWithIngredient("餅"), context), ["age_shape_rule"]);
});

it("accepts idea menus with empty family fields and matching servings", () => {
  const context = makeIdeaGenerationContext();
  const menu = makeGeneratedMenu({
    servings: 2,
    adaptations: [],
    labelConfirmations: [],
  });
  const result = validateGeneratedMenu(menu, context);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("idea menu should validate");
  expect(result.safetyFingerprint).toBe(createIdeaSafetyFingerprint());
  expect(result.menu.adaptations).toEqual([]);
  expect(result.menu.labelConfirmations).toEqual([]);
});

it("rejects English dish description as invalid_menu_structure (language gate)", () => {
  const context = makeIdeaGenerationContext();
  const base = makeGeneratedMenu({
    servings: 2,
    adaptations: [],
    labelConfirmations: [],
  });
  const menu = makeGeneratedMenu({
    servings: 2,
    adaptations: [],
    labelConfirmations: [],
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, description: "Beef fried rice with vegetables." } : dish,
    ),
  });
  const result = validateGeneratedMenu(menu, context);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("英語 description の検証エラーを期待しました");
  expect(result.issues).toContainEqual({
    code: "invalid_menu_structure",
    path: "dishes.0.description",
    message: "利用者向けの文言は日本語で書いてください",
  });
});

it("can skip Japanese language gate for dish-regen candidates with retained English", () => {
  const context = makeIdeaGenerationContext();
  const base = makeGeneratedMenu({
    servings: 2,
    adaptations: [],
    labelConfirmations: [],
  });
  const menu = makeGeneratedMenu({
    servings: 2,
    adaptations: [],
    labelConfirmations: [],
    dishes: base.dishes.map((dish, index) =>
      index === 1 ? { ...dish, description: "Stir-fried beef strips with green pepper." } : dish,
    ),
  });
  // 一品再生成の保持料理に残る英語 description はゲート抑止で通す
  expect(validateGeneratedMenu(menu, context, { checkJapaneseUserText: false }).ok).toBe(true);
  // 抑止なしなら拒否
  expect(validateGeneratedMenu(menu, context).ok).toBe(false);
});

it("rejects idea menus with adaptations or servings mismatch", () => {
  const context = makeIdeaGenerationContext();
  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu({ servings: 2 }), context), [
    "target_member_mismatch",
  ]);
  const servingsMismatch = validateGeneratedMenu(
    makeGeneratedMenu({ servings: 3, adaptations: [], labelConfirmations: [] }),
    context,
  );
  expectIssueCodes(servingsMismatch, ["servings_mismatch"]);
  if (servingsMismatch.ok) throw new Error("人数不一致の検証エラーを期待しました");
  expect(servingsMismatch.issues).toContainEqual({
    code: "servings_mismatch",
    path: "servings",
    message: "人数が指定と一致しません",
  });
  expect(menuValidationIssueCodes).toContain(servingsMismatch.issues[0]?.code);
});
