import { describe, expect, it } from "vitest";
import { validatedMenuSchema } from "./generation.js";

const dishId = "40000000-0000-4000-8000-000000000001";
const stepId = "41000000-0000-4000-8000-000000000001";

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
