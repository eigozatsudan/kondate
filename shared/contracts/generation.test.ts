import { describe, expect, it } from "vitest";
import {
  aiGenerationResponseSchema,
  generationConflictCodes,
  generationConflictCopy,
  generationIssueCodes,
  generationStatusDataSchema,
  issueMessages,
  menuValidationIssueCodes,
  menuResponseFormat,
  newMenuGenerationRequestSchema,
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  releaseQuota,
  usageTodayDataSchema,
  validatedMenuSchema,
  type MenuValidationIssue,
} from "./generation.js";
import {
  availableUsageTodayFixture,
  shortWindowBlockedUsageTodayFixture,
} from "../testing/factories.js";

const dishId = "40000000-0000-4000-8000-000000000001";
const stepId = "41000000-0000-4000-8000-000000000001";

it("closes menu validation issue codes", () => {
  const closedIssue: MenuValidationIssue = {
    code: "servings_mismatch",
    path: "servings",
    message: "人数が一致しません",
  };
  expect(menuValidationIssueCodes).toContain(closedIssue.code);

  type ArbitraryCodeIsRejected = "arbitrary_provider_code" extends MenuValidationIssue["code"]
    ? false
    : true;
  const arbitraryCodeIsRejected: ArbitraryCodeIsRejected = true;
  expect(arbitraryCodeIsRejected).toBe(true);
});

const menu = {
  schemaVersion: "2026-07-11.v1",
  menuId: "42000000-0000-4000-8000-000000000001",
  mealType: "breakfast",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: [],
  dishes: [
    {
      id: dishId,
      role: "main",
      position: 1,
      name: "おにぎり",
      description: "朝の主食",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          id: "43000000-0000-4000-8000-000000000001",
          position: 1,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [{ id: stepId, position: 1, instruction: "握る" }],
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      role: "side",
      position: 2,
      name: "りんご",
      description: "切った果物",
      cookingTimeMinutes: 3,
      ingredients: [
        {
          id: "43000000-0000-4000-8000-000000000002",
          position: 1,
          name: "りんご",
          quantityValue: 0.5,
          quantityText: "1/2個",
          unit: "個",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "41000000-0000-4000-8000-000000000002",
          position: 1,
          instruction: "薄く切る",
        },
      ],
    },
  ],
  timeline: [
    {
      id: "44000000-0000-4000-8000-000000000001",
      position: 1,
      startMinute: 0,
      durationMinutes: 10,
      instruction: "おにぎりを作る",
      dishId,
      recipeStepId: stepId,
    },
  ],
  adaptations: [],
  pantryUsage: [],
  labelConfirmations: [],
} as const;

it("locks the MVP quota tuple into the shared contract", () => {
  expect(releaseQuota).toEqual({
    userDailySuccessLimit: 3,
    userDailyExternalCallLimit: 6,
    userShortWindowExternalCallLimit: 4,
    userShortWindowSeconds: 600,
  });
});

it("rejects validated menu safetyTags longer than 32 (A-I12)", () => {
  const tags = Array.from({ length: 33 }, () => "cut_small" as const);
  expect(validatedMenuSchema.safeParse({ ...menu, safetyTags: tags }).success).toBe(false);
  expect(
    validatedMenuSchema.safeParse({
      ...menu,
      safetyTags: Array.from({ length: 32 }, () => "cut_small" as const),
    }).success,
  ).toBe(true);
});

describe("generationConflictCopy", () => {
  it("defines Japanese copy for every conflict code", () => {
    expect(Object.keys(generationConflictCopy)).toEqual(generationConflictCodes);
    expect(Object.values(generationConflictCopy)).toSatisfy((messages: string[]) =>
      messages.every((message) => message.length > 0),
    );
  });
});

describe("generationIssueCodes and issueMessages", () => {
  it("covers every issue code with Japanese copy", () => {
    for (const code of generationIssueCodes) {
      expect(issueMessages[code].length).toBeGreaterThan(0);
    }
  });

  it("reuses generationConflictCopy entries by value for the five conflicts", () => {
    for (const code of generationConflictCodes) {
      expect(issueMessages[code]).toBe(generationConflictCopy[code]);
    }
  });
});

describe("usageTodayDataSchema", () => {
  it.each([availableUsageTodayFixture, shortWindowBlockedUsageTodayFixture])(
    "keeps the roadmap usage shape exact",
    (fixture) => {
      expect(usageTodayDataSchema.parse(fixture)).toEqual(fixture);
      expect(Object.keys(fixture).sort()).toEqual([
        "attempts",
        "globalAvailable",
        "retryAt",
        "shortWindow",
        "success",
      ]);
    },
  );

  // F5: 旧 5/12 上限・残数不整合・余剰 field を fail-closed で拒否
  it("rejects the retired 5/12 daily limits", () => {
    expect(
      usageTodayDataSchema.safeParse({
        success: { consumed: 1, limit: 5, remaining: 4 },
        attempts: { sent: 2, limit: 12, remaining: 10 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      }).success,
    ).toBe(false);
  });

  it("rejects success or attempts when used + remaining does not equal limit", () => {
    expect(
      usageTodayDataSchema.safeParse({
        success: { consumed: 1, limit: 3, remaining: 1 },
        attempts: { sent: 2, limit: 6, remaining: 4 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      }).success,
    ).toBe(false);
    expect(
      usageTodayDataSchema.safeParse({
        success: { consumed: 1, limit: 3, remaining: 2 },
        attempts: { sent: 2, limit: 6, remaining: 5 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      }).success,
    ).toBe(false);
  });

  it("rejects surplus fields on the usage-today payload", () => {
    expect(
      usageTodayDataSchema.safeParse({
        ...availableUsageTodayFixture,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts the zero-remaining boundaries for success, attempts, and short window", () => {
    expect(
      usageTodayDataSchema.parse({
        success: { consumed: 3, limit: 3, remaining: 0 },
        attempts: { sent: 0, limit: 6, remaining: 6 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: "2026-07-11T15:00:00.000Z",
      }),
    ).toMatchObject({ success: { remaining: 0, limit: 3 } });
    expect(
      usageTodayDataSchema.parse({
        success: { consumed: 0, limit: 3, remaining: 3 },
        attempts: { sent: 6, limit: 6, remaining: 0 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: "2026-07-11T15:00:00.000Z",
      }),
    ).toMatchObject({ attempts: { remaining: 0, limit: 6 } });
    expect(
      usageTodayDataSchema.parse({
        success: { consumed: 0, limit: 3, remaining: 3 },
        attempts: { sent: 0, limit: 6, remaining: 6 },
        shortWindow: {
          sent: 4,
          limit: 4,
          remaining: 0,
          retryAt: "2026-07-11T09:10:00+09:00",
        },
        globalAvailable: true,
        retryAt: "2026-07-11T09:10:00+09:00",
      }),
    ).toMatchObject({ shortWindow: { remaining: 0, limit: 4 } });
  });
});

describe("newMenuGenerationRequestSchema", () => {
  const valid = {
    idempotencyKey: "10000000-0000-4000-8000-000000000001",
    draftId: "20000000-0000-4000-8000-000000000001",
    draftRevision: 3,
    privacyNoticeVersion: "2026-07-26.v1",
    expiredPantryConfirmations: [
      {
        pantryItemId: "30000000-0000-4000-8000-000000000001",
        checkedAt: "2026-07-11T09:00:00+09:00",
      },
    ],
  };

  it("accepts identifiers and transient expiry confirmations", () => {
    expect(newMenuGenerationRequestSchema.parse(valid)).toEqual(valid);
  });

  // 設計 §7: 旧 privacyNoticeVersion は互換パーサなしで Zod 拒否（未同意扱い）
  it("rejects the previous privacyNoticeVersion without a compatibility parser", () => {
    expect(
      newMenuGenerationRequestSchema.safeParse({
        ...valid,
        privacyNoticeVersion: "2026-07-11.v1",
      }).success,
    ).toBe(false);
  });

  it("rejects client-supplied identity and safety data", () => {
    expect(
      newMenuGenerationRequestSchema.safeParse({
        ...valid,
        userId: "40000000-0000-4000-8000-000000000001",
        allergens: ["egg"],
      }).success,
    ).toBe(false);
  });
});

// F1: 再生成 wire も現行 privacy 同意 version を必須にし、旧版・欠落を互換受理しない
describe("regeneration request privacyNoticeVersion", () => {
  const menuValid = {
    idempotencyKey: "10000000-0000-4000-8000-000000000001",
    sourceMenuId: "60000000-0000-4000-8000-000000000001",
    changeReason: "simpler" as const,
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-26.v1" as const,
    expiredPantryConfirmations: [],
  };
  const dishValid = {
    ...menuValid,
    dishId: "70000000-0000-4000-8000-000000000001",
  };

  it.each([
    ["regenerate_menu", regenerateMenuRequestSchema, menuValid],
    ["regenerate_dish", regenerateDishRequestSchema, dishValid],
  ] as const)("requires current privacyNoticeVersion on %s", (_kind, schema, valid) => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  it.each([
    ["regenerate_menu", regenerateMenuRequestSchema, menuValid],
    ["regenerate_dish", regenerateDishRequestSchema, dishValid],
  ] as const)(
    "rejects missing privacyNoticeVersion on %s without compatibility",
    (_kind, schema, valid) => {
      const without = { ...valid };
      delete (without as { privacyNoticeVersion?: string }).privacyNoticeVersion;
      expect(schema.safeParse(without).success).toBe(false);
    },
  );

  it.each([
    ["regenerate_menu", regenerateMenuRequestSchema, menuValid],
    ["regenerate_dish", regenerateDishRequestSchema, dishValid],
  ] as const)("rejects the previous privacyNoticeVersion on %s", (_kind, schema, valid) => {
    expect(
      schema.safeParse({
        ...valid,
        privacyNoticeVersion: "2026-07-11.v1",
      }).success,
    ).toBe(false);
  });
});

describe("generationStatusDataSchema", () => {
  const quota = {
    consumed: false,
    remaining: 2,
    userDailyLimit: 3,
    limitKind: null,
    retryAt: null,
  };

  it("requires a menu id for succeeded", () => {
    expect(
      generationStatusDataSchema.safeParse({
        status: "succeeded",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        requestId: "50000000-0000-4000-8000-000000000001",
        quota: { ...quota, consumed: true },
      }).success,
    ).toBe(false);
  });

  it("represents a missing server record as not_started", () => {
    expect(
      generationStatusDataSchema.parse({
        status: "not_started",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        quota,
      }),
    ).toMatchObject({ status: "not_started", quota: { remaining: 2 } });
  });

  it("accepts terminal failed duplicate_output without menuId and without quota consumption", () => {
    const failed = generationStatusDataSchema.parse({
      status: "failed",
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      requestId: "50000000-0000-4000-8000-000000000001",
      quota: { ...quota, consumed: false },
      error: {
        code: "duplicate_output",
        message: "元の献立とほぼ同じ案だったため保存しませんでした。今回は回数に含まれません",
        retryable: true,
      },
      completedAt: "2026-07-11T00:00:01.000Z",
    });
    expect(failed).toMatchObject({
      status: "failed",
      quota: { consumed: false },
      error: { code: "duplicate_output" },
    });
    expect(failed).not.toHaveProperty("menuId");
  });
});

describe("aiGenerationResponseSchema", () => {
  it("rejects unknown fields in a conflict response", () => {
    expect(
      aiGenerationResponseSchema.safeParse({
        outcome: "constraint_conflict",
        conflicts: [
          {
            code: "must_use_conflict",
            message: "必須食材と安全条件を同時に満たせません。",
            conditionRefs: ["pantry_1"],
          },
        ],
        prompt: "leak",
      }).success,
    ).toBe(false);
  });

  it("publishes strict JSON Schema for OpenRouter", () => {
    expect(menuResponseFormat.type).toBe("json_schema");
    expect(menuResponseFormat.json_schema.strict).toBe(true);
    expect(JSON.stringify(menuResponseFormat.json_schema.schema)).toContain(
      '"additionalProperties":false',
    );
  });
});

describe("validated menu schema", () => {
  it("accepts a complete two-dish breakfast", () => {
    expect(validatedMenuSchema.safeParse(menu).success).toBe(true);
  });

  it("rejects a timeline beyond total elapsed time", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        timeline: [{ ...menu.timeline[0], startMinute: 10, durationMinutes: 10 }],
      }).success,
    ).toBe(false);
  });

  it("rejects an adaptation whose branch step belongs to another dish", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        adaptations: [
          {
            id: "45000000-0000-4000-8000-000000000001",
            dishId: menu.dishes[1].id,
            anonymousMemberRef: "member_1",
            portionText: "半量",
            branchBeforeRecipeStepId: stepId,
            additionalCutting: "小さく切る",
            additionalHeating: null,
            additionalSeasoning: null,
            servingCheck: "大きさを確認する",
            safetyTags: ["cut_small"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("canonicalizes label source text and counts Unicode code points", () => {
    const confirmation = {
      sourceType: "ingredient",
      sourceId: menu.dishes[0].ingredients[0].id,
      sourcePath: "dishes.0.ingredients.0.name",
      sourceText: "\u00a0ごはん\ufeff",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
      confirmedAt: null,
      confirmedBy: null,
    } as const;
    expect(
      validatedMenuSchema.parse({ ...menu, labelConfirmations: [confirmation] })
        .labelConfirmations[0]?.sourceText,
    ).toBe("ごはん");
    const longInstruction = "ご".repeat(500);
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        timeline: [{ ...menu.timeline[0], instruction: longInstruction }],
        labelConfirmations: [
          {
            ...confirmation,
            sourceType: "timeline",
            sourceId: menu.timeline[0].id,
            sourcePath: "timeline.0.instruction",
            sourceText: longInstruction,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires label source text and rejects more than 500 Unicode code points", () => {
    const confirmation = {
      sourceType: "ingredient",
      sourceId: menu.dishes[0].ingredients[0].id,
      sourcePath: "dishes.0.ingredients.0.name",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
      confirmedAt: null,
      confirmedBy: null,
    } as const;
    expect(
      validatedMenuSchema.safeParse({ ...menu, labelConfirmations: [confirmation] }).success,
    ).toBe(false);
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        labelConfirmations: [{ ...confirmation, sourceText: "🍳".repeat(501) }],
      }).success,
    ).toBe(false);
  });

  it("rejects a label confirmation unless its type, canonical path, and text match its source", () => {
    const confirmation = {
      sourceType: "ingredient",
      sourceId: menu.dishes[0].ingredients[0].id,
      sourcePath: "dishes.0.ingredients.0.name",
      sourceText: "ごはん",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
    } as const;

    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        labelConfirmations: [
          {
            ...confirmation,
            sourceType: "dish",
            sourcePath: "nonsense",
            sourceText: "nonsense",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        labelConfirmations: [{ ...confirmation, sourcePath: "dishes.1.name" }],
      }).success,
    ).toBe(false);
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        labelConfirmations: [{ ...confirmation, sourceText: "りんご" }],
      }).success,
    ).toBe(false);
  });

  it("accepts every canonical text leaf supported by each label source type", () => {
    const adaptation = {
      id: "45000000-0000-4000-8000-000000000001",
      dishId,
      anonymousMemberRef: "member_1",
      portionText: "半量",
      branchBeforeRecipeStepId: stepId,
      additionalCutting: "小さく切る",
      additionalHeating: "十分に加熱する",
      additionalSeasoning: "薄味にする",
      servingCheck: "温度を確認する",
      safetyTags: [],
      safetyActions: [
        {
          kind: "cut_small",
          dishId,
          ingredientId: menu.dishes[0].ingredients[0].id,
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: stepId,
          instruction: "一口大以下に切る",
        },
      ],
    } as const;
    const sources = [
      ["dish", dishId, "dishes.0.name", "おにぎり"],
      ["dish", dishId, "dishes.0.description", "朝の主食"],
      ["ingredient", menu.dishes[0].ingredients[0].id, "dishes.0.ingredients.0.name", "ごはん"],
      [
        "ingredient",
        menu.dishes[0].ingredients[0].id,
        "dishes.0.ingredients.0.quantityText",
        "300g",
      ],
      ["ingredient", menu.dishes[0].ingredients[0].id, "dishes.0.ingredients.0.unit", "g"],
      ["recipe_step", stepId, "dishes.0.steps.0.instruction", "握る"],
      ["adaptation", adaptation.id, "adaptations.0.portionText", "半量"],
      ["adaptation", adaptation.id, "adaptations.0.additionalCutting", "小さく切る"],
      ["adaptation", adaptation.id, "adaptations.0.additionalHeating", "十分に加熱する"],
      ["adaptation", adaptation.id, "adaptations.0.additionalSeasoning", "薄味にする"],
      ["adaptation", adaptation.id, "adaptations.0.servingCheck", "温度を確認する"],
      [
        "adaptation",
        adaptation.id,
        "adaptations.0.safetyActions.0.instruction",
        "一口大以下に切る",
      ],
      ["timeline", menu.timeline[0].id, "timeline.0.instruction", "おにぎりを作る"],
    ] as const;
    const labelConfirmations = sources.map(
      ([sourceType, sourceId, sourcePath, sourceText], index) => ({
        sourceType,
        sourceId,
        sourcePath,
        sourceText,
        allergenId: `allergen_${String(index)}`,
        anonymousMemberRef: "member_1" as const,
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending" as const,
        confirmedAt: null,
        confirmedBy: null,
      }),
    );

    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        adaptations: [adaptation],
        labelConfirmations,
      }).success,
    ).toBe(true);
  });

  it("rejects pantry usage that refers to a dish outside the menu", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        pantryUsage: [
          {
            selectionId: "46000000-0000-4000-8000-000000000001",
            pantryItemId: null,
            pantryItemName: "ごはん",
            priority: "prefer_use",
            usageStatus: "used",
            plannedQuantity: null,
            inventoryQuantity: null,
            shortageQuantity: null,
            unit: null,
            dishIds: ["40000000-0000-4000-8000-000000000099"],
            unusedReason: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "dish",
      {
        ...menu,
        dishes: [menu.dishes[0], { ...menu.dishes[1], id: dishId }],
      },
    ],
    [
      "ingredient",
      {
        ...menu,
        dishes: [
          menu.dishes[0],
          {
            ...menu.dishes[1],
            ingredients: [
              {
                ...menu.dishes[1].ingredients[0],
                id: menu.dishes[0].ingredients[0].id,
              },
            ],
          },
        ],
      },
    ],
    [
      "recipe step",
      {
        ...menu,
        dishes: [
          menu.dishes[0],
          {
            ...menu.dishes[1],
            steps: [{ ...menu.dishes[1].steps[0], id: stepId }],
          },
        ],
        timeline: [{ ...menu.timeline[0], recipeStepId: null }],
      },
    ],
    [
      "timeline",
      {
        ...menu,
        timeline: [menu.timeline[0], { ...menu.timeline[0], position: 2 }],
      },
    ],
    [
      "adaptation",
      {
        ...menu,
        adaptations: [
          {
            id: "45000000-0000-4000-8000-000000000001",
            dishId,
            anonymousMemberRef: "member_1",
            portionText: "半量",
            branchBeforeRecipeStepId: stepId,
            additionalCutting: null,
            additionalHeating: null,
            additionalSeasoning: null,
            servingCheck: "温度を確認する",
            safetyTags: [],
          },
          {
            id: "45000000-0000-4000-8000-000000000001",
            dishId,
            anonymousMemberRef: "member_2",
            portionText: "少量",
            branchBeforeRecipeStepId: stepId,
            additionalCutting: null,
            additionalHeating: null,
            additionalSeasoning: null,
            servingCheck: "温度を確認する",
            safetyTags: [],
          },
        ],
      },
    ],
  ])("rejects duplicate %s IDs", (_entityType, duplicateMenu) => {
    expect(validatedMenuSchema.safeParse(duplicateMenu).success).toBe(false);
  });

  it("rejects an ingredient whose pantry selection is absent from pantry usage", () => {
    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        dishes: [
          {
            ...menu.dishes[0],
            ingredients: [
              {
                ...menu.dishes[0].ingredients[0],
                pantrySelectionId: "46000000-0000-4000-8000-000000000001",
              },
            ],
          },
          menu.dishes[1],
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate pantry usage selection IDs", () => {
    const usage = {
      selectionId: "46000000-0000-4000-8000-000000000001",
      pantryItemId: null,
      pantryItemName: "ごはん",
      priority: "prefer_use",
      usageStatus: "used",
      plannedQuantity: null,
      inventoryQuantity: null,
      shortageQuantity: null,
      unit: null,
      dishIds: [dishId],
      unusedReason: null,
    } as const;

    expect(
      validatedMenuSchema.safeParse({
        ...menu,
        pantryUsage: [usage, { ...usage, pantryItemName: "のり" }],
      }).success,
    ).toBe(false);
  });
});
