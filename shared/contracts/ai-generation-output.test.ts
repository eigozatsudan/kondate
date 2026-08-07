import { describe, expect, it } from "vitest";
import { aiGeneratedMenuPayloadSchema } from "./ai-generation-output.js";
import { menuResponseFormat } from "./generation.js";

const validPayload = {
  schemaVersion: "2026-07-11.v1",
  mealType: "breakfast",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: ["cut_small"],
  // 朝食は最低 2 品（minDishCountForMealType / S11）
  dishes: [
    {
      dishRef: "dish_1",
      role: "main",
      position: 1,
      name: "おにぎり",
      description: "朝の主食",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          ingredientRef: "ingredient_1",
          position: 1,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantryRef: "pantry_1",
          labelConfirmationRequired: false,
        },
      ],
      steps: [{ stepRef: "step_1", position: 1, instruction: "握る" }],
    },
    {
      dishRef: "dish_2",
      role: "side",
      position: 2,
      name: "温野菜",
      description: "加熱した野菜",
      cookingTimeMinutes: 5,
      ingredients: [
        {
          ingredientRef: "ingredient_2",
          position: 1,
          name: "にんじん",
          quantityValue: 0.5,
          quantityText: "1/2本",
          unit: "本",
          storeSection: "produce",
          pantryRef: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [{ stepRef: "step_2", position: 1, instruction: "蒸す" }],
    },
  ],
  timeline: [
    {
      timelineRef: "timeline_1",
      position: 1,
      startMinute: 0,
      durationMinutes: 10,
      instruction: "おにぎりを作る",
      dishRef: "dish_1",
      stepRef: "step_1",
    },
  ],
  adaptations: [
    {
      adaptationRef: "adaptation_1",
      dishRef: "dish_1",
      anonymousMemberRef: "member_1",
      portionText: "半量",
      beforeStepRef: "step_1",
      additionalCutting: "小さく切る",
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "大きさを確認する",
      safetyTags: ["cut_small"],
      safetyActions: [
        {
          kind: "cut_small",
          dishRef: "dish_1",
          ingredientRef: "ingredient_1",
          anonymousMemberRef: "member_1",
          beforeStepRef: "step_1",
          instruction: "一口大以下に切る",
        },
      ],
    },
  ],
  pantryUsage: [
    {
      pantryRef: "pantry_1",
      priority: "prefer_use",
      usageStatus: "used",
      plannedQuantity: 300,
      unit: "g",
      dishRefs: ["dish_1"],
      unusedReason: null,
    },
  ],
  labelConfirmations: [
    {
      sourceType: "ingredient",
      sourceRef: "ingredient_1",
      sourcePath: "dishes.0.ingredients.0.name",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
    },
  ],
} as const;

const internalUuid = "10000000-0000-4000-8000-000000000001";

describe("aiGeneratedMenuPayloadSchema", () => {
  it("accepts provider-local references", () => {
    expect(aiGeneratedMenuPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects safetyTags longer than 32 (A-I12)", () => {
    const tags = Array.from({ length: 33 }, () => "cut_small");
    expect(
      aiGeneratedMenuPayloadSchema.safeParse({ ...validPayload, safetyTags: tags }).success,
    ).toBe(false);
    expect(
      aiGeneratedMenuPayloadSchema.safeParse({
        ...validPayload,
        adaptations: [{ ...validPayload.adaptations[0], safetyTags: tags }],
      }).success,
    ).toBe(false);
    expect(
      aiGeneratedMenuPayloadSchema.safeParse({
        ...validPayload,
        safetyTags: Array.from({ length: 32 }, () => "cut_small"),
      }).success,
    ).toBe(true);
  });

  it.each([
    ["dishRef", { dishes: [{ ...validPayload.dishes[0], dishRef: internalUuid }] }],
    [
      "ingredientRef",
      {
        dishes: [
          {
            ...validPayload.dishes[0],
            ingredients: [
              { ...validPayload.dishes[0].ingredients[0], ingredientRef: internalUuid },
            ],
          },
        ],
      },
    ],
    [
      "stepRef",
      {
        dishes: [
          {
            ...validPayload.dishes[0],
            steps: [{ ...validPayload.dishes[0].steps[0], stepRef: internalUuid }],
          },
        ],
      },
    ],
    ["timelineRef", { timeline: [{ ...validPayload.timeline[0], timelineRef: internalUuid }] }],
    [
      "adaptationRef",
      {
        adaptations: [{ ...validPayload.adaptations[0], adaptationRef: internalUuid }],
      },
    ],
    ["pantryRef", { pantryUsage: [{ ...validPayload.pantryUsage[0], pantryRef: internalUuid }] }],
    [
      "memberRef",
      {
        adaptations: [{ ...validPayload.adaptations[0], anonymousMemberRef: internalUuid }],
      },
    ],
  ])("rejects UUID values for %s", (_name, mutation) => {
    expect(aiGeneratedMenuPayloadSchema.safeParse({ ...validPayload, ...mutation }).success).toBe(
      false,
    );
  });

  it.each([
    ["an unknown key", { ...validPayload, prompt: "leak" }],
    [
      "a pantry database id",
      {
        ...validPayload,
        pantryUsage: [{ ...validPayload.pantryUsage[0], pantryItemId: internalUuid }],
      },
    ],
    [
      "a pantry item name",
      {
        ...validPayload,
        pantryUsage: [{ ...validPayload.pantryUsage[0], pantryItemName: "ごはん" }],
      },
    ],
    [
      "an inventory snapshot",
      {
        ...validPayload,
        pantryUsage: [{ ...validPayload.pantryUsage[0], inventoryQuantity: 300 }],
      },
    ],
    ["an internal menu id", { ...validPayload, menuId: internalUuid }],
  ])("rejects %s", (_name, value) => {
    expect(aiGeneratedMenuPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("emits no UUID format in the provider JSON Schema", () => {
    const containsUuidFormat = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(containsUuidFormat);
      if (value === null || typeof value !== "object") return false;
      return Object.entries(value).some(
        ([key, child]) => (key === "format" && child === "uuid") || containsUuidFormat(child),
      );
    };

    expect(containsUuidFormat(menuResponseFormat.json_schema.schema)).toBe(false);
  });

  it("rejects unbounded quantityValue above 999_999 (S2)", () => {
    const huge = {
      ...validPayload,
      dishes: [
        {
          ...validPayload.dishes[0],
          ingredients: [{ ...validPayload.dishes[0].ingredients[0], quantityValue: 1e15 }],
        },
        validPayload.dishes[1],
      ],
    };
    expect(aiGeneratedMenuPayloadSchema.safeParse(huge).success).toBe(false);
    const atCeiling = {
      ...validPayload,
      dishes: [
        {
          ...validPayload.dishes[0],
          ingredients: [{ ...validPayload.dishes[0].ingredients[0], quantityValue: 999_999 }],
        },
        validPayload.dishes[1],
      ],
    };
    expect(aiGeneratedMenuPayloadSchema.safeParse(atCeiling).success).toBe(true);
  });

  it("rejects dinner with fewer dishes than mealType minimum (S11)", () => {
    // dinner 最低 3 品。1 品は AI wire で早期拒否（後段 invalid_ai_response 前）
    expect(
      aiGeneratedMenuPayloadSchema.safeParse({
        ...validPayload,
        mealType: "dinner",
        dishes: [validPayload.dishes[0]],
      }).success,
    ).toBe(false);
    expect(
      aiGeneratedMenuPayloadSchema.safeParse({
        ...validPayload,
        mealType: "breakfast",
        dishes: [validPayload.dishes[0]],
      }).success,
    ).toBe(false);
  });
});
