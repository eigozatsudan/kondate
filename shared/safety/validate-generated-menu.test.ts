import { expect, it } from "vitest";
import { validateGeneratedMenu } from "./validate-generated-menu.js";
import {
  hardBeanAndReviewedNutRule,
  makeCurrentSafetyContext,
  makeGeneratedMenu,
  makeGenerationContext,
  underSixHardBeanAndNutContext,
} from "../testing/factories.js";

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

function menuWithIngredient(name: string) {
  const base = makeGeneratedMenu();
  return makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 1 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name }] } : dish,
    ),
  });
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

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu({ adaptations: [] }), context), [
    "target_member_mismatch",
    "member_preference_mismatch",
  ]);
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
