import { describe, expect, it } from "vitest";
import {
  assertMaterializationRefUnion,
  assertUniqueLocalRefDeclarations,
  capExcludedDishSignatures,
  dishRegenerationAiOutputSchema,
  dishRegenerationPromptSchema,
  excludedDishSignaturesMax,
  regenerateDishRequestSchema,
  retainedDishPromptSchema,
  wholeRegenerationPromptSchema,
  type DishRegenerationAiOutput,
  type RetainedDishPrompt,
} from "./regeneration.js";

/** 置換料理 AI 出力の最小妥当フィクスチャ（request-local ref のみ） */
function makeDishRegenerationAiOutput(): DishRegenerationAiOutput {
  return {
    replacementDish: {
      dishRef: "dish_2",
      role: "main",
      position: 1,
      name: "豚肉と白菜の炒め物",
      description: "さっと炒める主菜",
      cookingTimeMinutes: 20,
      ingredients: [
        {
          ingredientRef: "ingredient_10",
          position: 1,
          name: "豚こま肉",
          quantityValue: 200,
          quantityText: "200g",
          unit: "g",
          storeSection: "meat_fish",
          pantryRef: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          stepRef: "step_10",
          position: 1,
          instruction: "中火で炒める",
        },
      ],
    },
    timeline: [
      {
        timelineRef: "timeline_1",
        position: 1,
        startMinute: 0,
        durationMinutes: 20,
        instruction: "主菜を炒める",
        dishRef: "dish_2",
        stepRef: "step_10",
      },
    ],
    adaptations: [
      {
        adaptationRef: "adaptation_1",
        dishRef: "dish_2",
        anonymousMemberRef: "member_1",
        portionText: "半量",
        beforeStepRef: "step_10",
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "大きさを確認する",
        safetyTags: [],
        safetyActions: [],
      },
    ],
    pantryUsage: [
      {
        pantryRef: "pantry_1",
        pantryItemName: "白菜",
        priority: "prefer_use",
        usageStatus: "used",
        plannedQuantity: 100,
        inventoryQuantity: 200,
        shortageQuantity: 0,
        unit: "g",
        dishRefs: ["dish_2"],
        unusedReason: null,
      },
    ],
    labelConfirmations: [
      {
        labelRef: "label_1",
        sourceType: "ingredient",
        sourceRef: "ingredient_10",
        sourcePath: "replacementDish.ingredients.0.name",
        sourceText: "豚こま肉",
        allergenId: "pork",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ],
  };
}

/** 保持料理プロンプトの最小妥当フィクスチャ（DB UUID を含まない） */
function makeRetainedDishPrompt(): RetainedDishPrompt {
  return {
    dishRef: "dish_1",
    role: "side",
    position: 2,
    name: "にんじんの和え物",
    description: "副菜",
    cookingTimeMinutes: 10,
    ingredients: [
      {
        ingredientRef: "ingredient_1",
        position: 1,
        name: "にんじん",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        storeSection: "produce",
        pantryRef: "pantry_1",
        labelConfirmationRequired: false,
      },
    ],
    steps: [
      {
        stepRef: "step_1",
        position: 1,
        instruction: "薄切りにして和える",
      },
    ],
  };
}

describe("regeneration contracts", () => {
  it("requires a reason for dish regeneration", () => {
    const parsed = regenerateDishRequestSchema.safeParse({
      sourceMenuId: crypto.randomUUID(),
      dishId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts only request-local refs for the replacement and complete cross-menu sections", () => {
    const output = makeDishRegenerationAiOutput();
    expect(dishRegenerationAiOutputSchema.parse(output)).toEqual(output);
    expect(() =>
      dishRegenerationAiOutputSchema.parse({
        ...output,
        replacementDish: { ...output.replacementDish, dishRef: crypto.randomUUID() },
      }),
    ).toThrow();
  });

  it("requires complete retained dish text without stable database IDs", () => {
    const retained = retainedDishPromptSchema.parse(makeRetainedDishPrompt());
    expect(JSON.stringify(retained)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
    expect(retained.steps).not.toHaveLength(0);
  });

  it("accepts whole and dish regeneration prompt shells", () => {
    const whole = wholeRegenerationPromptSchema.parse({
      mode: "whole",
      reason: "simpler",
      changeReasonCustom: null,
      excludedDishSignatures: ['["main","a",["b"]]'],
    });
    expect(whole.mode).toBe("whole");

    const retained = makeRetainedDishPrompt();
    const dishPrompt = dishRegenerationPromptSchema.parse({
      mode: "dish",
      reason: "different_ingredient",
      changeReasonCustom: null,
      replaceDishRef: "dish_9",
      sourceDishToReplace: {
        ...retained,
        dishRef: "dish_9",
        role: "main",
        position: 1,
        name: "元の主菜",
      },
      retainedDishes: [retained],
      sourceTimeline: [
        {
          timelineRef: "timeline_1",
          position: 1,
          startMinute: 0,
          durationMinutes: 10,
          instruction: "副菜を作る",
          dishRef: "dish_1",
          stepRef: "step_1",
        },
      ],
      sourceAdaptations: [],
      sourcePantryUsage: [],
      sourceLabelConfirmations: [],
      excludedDishSignatures: [],
    });
    expect(dishPrompt.replaceDishRef).toBe("dish_9");
  });

  it("accepts source and AI timeline of 60 to match generatedMenu max", () => {
    const retained = makeRetainedDishPrompt();
    const timelineStep = {
      timelineRef: "timeline_1",
      position: 1,
      startMinute: 0,
      durationMinutes: 1,
      instruction: "手順",
      dishRef: "dish_1" as const,
      stepRef: "step_1" as const,
    };
    const sixty = Array.from({ length: 60 }, (_, index) => ({
      ...timelineStep,
      timelineRef: `timeline_${String(index + 1)}`,
      position: index + 1,
    }));
    const prompt = dishRegenerationPromptSchema.parse({
      mode: "dish",
      reason: "simpler",
      changeReasonCustom: null,
      replaceDishRef: "dish_9",
      sourceDishToReplace: {
        ...retained,
        dishRef: "dish_9",
        role: "main",
        position: 1,
        name: "元の主菜",
      },
      retainedDishes: [retained],
      sourceTimeline: sixty,
      sourceAdaptations: [],
      sourcePantryUsage: [],
      sourceLabelConfirmations: [],
      excludedDishSignatures: [],
    });
    expect(prompt.sourceTimeline).toHaveLength(60);

    const output = makeDishRegenerationAiOutput();
    expect(
      dishRegenerationAiOutputSchema.parse({
        ...output,
        timeline: sixty.map((step) => ({ ...step, dishRef: "dish_2", stepRef: "step_10" })),
      }).timeline,
    ).toHaveLength(60);
  });

  it("rejects regeneration timeline of 61", () => {
    const retained = makeRetainedDishPrompt();
    const sixtyOne = Array.from({ length: 61 }, (_, index) => ({
      timelineRef: `timeline_${String(index + 1)}`,
      position: index + 1,
      startMinute: 0,
      durationMinutes: 1,
      instruction: "手順",
      dishRef: "dish_1",
      stepRef: "step_1",
    }));
    expect(
      dishRegenerationPromptSchema.safeParse({
        mode: "dish",
        reason: "simpler",
        changeReasonCustom: null,
        replaceDishRef: "dish_9",
        sourceDishToReplace: {
          ...retained,
          dishRef: "dish_9",
          role: "main",
          position: 1,
          name: "元の主菜",
        },
        retainedDishes: [retained],
        sourceTimeline: sixtyOne,
        sourceAdaptations: [],
        sourcePantryUsage: [],
        sourceLabelConfirmations: [],
        excludedDishSignatures: [],
      }).success,
    ).toBe(false);
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...makeDishRegenerationAiOutput(),
        timeline: sixtyOne,
      }).success,
    ).toBe(false);
  });

  it("rejects dishRefs above persist max 5 so OpenRouter cannot burn a try", () => {
    const output = makeDishRegenerationAiOutput();
    const sixRefs = ["dish_1", "dish_2", "dish_3", "dish_4", "dish_5", "dish_6"];
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        pantryUsage: [{ ...output.pantryUsage[0]!, dishRefs: sixRefs }],
      }).success,
    ).toBe(false);
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        pantryUsage: [
          {
            ...output.pantryUsage[0]!,
            dishRefs: ["dish_1", "dish_2", "dish_3", "dish_4", "dish_5"],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects persist-invalid pantryUsage at the AI schema so a try is not burned", () => {
    const output = makeDishRegenerationAiOutput();
    const baseUsage = output.pantryUsage[0]!;
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        pantryUsage: [{ ...baseUsage, priority: "must_use", usageStatus: "unused" }],
      }).success,
    ).toBe(false);
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        pantryUsage: [{ ...baseUsage, usageStatus: "used", dishRefs: [] }],
      }).success,
    ).toBe(false);
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        pantryUsage: [{ ...baseUsage, usageStatus: "used", unusedReason: "使わなかった" }],
      }).success,
    ).toBe(false);
  });

  it("rejects AI timeline whose start+duration exceeds persist totalElapsed 180", () => {
    const output = makeDishRegenerationAiOutput();
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        timeline: [{ ...output.timeline[0]!, startMinute: 180, durationMinutes: 20 }],
      }).success,
    ).toBe(false);
    expect(
      dishRegenerationAiOutputSchema.safeParse({
        ...output,
        timeline: [{ ...output.timeline[0]!, startMinute: 0, durationMinutes: 180 }],
      }).success,
    ).toBe(true);
  });

  it("accepts 200 excluded signatures and rejects 201 without raising the cap", () => {
    expect(excludedDishSignaturesMax).toBe(200);
    const twoHundred = Array.from({ length: 200 }, (_, index) => `sig-${String(index + 1)}`);
    const twoHundredOne = [...twoHundred, "sig-201"];
    expect(
      wholeRegenerationPromptSchema.safeParse({
        mode: "whole",
        reason: "simpler",
        changeReasonCustom: null,
        excludedDishSignatures: twoHundred,
      }).success,
    ).toBe(true);
    expect(
      wholeRegenerationPromptSchema.safeParse({
        mode: "whole",
        reason: "simpler",
        changeReasonCustom: null,
        excludedDishSignatures: twoHundredOne,
      }).success,
    ).toBe(false);
    expect(capExcludedDishSignatures(twoHundredOne)).toHaveLength(200);
    expect(capExcludedDishSignatures(twoHundred)).toHaveLength(200);
  });
});

describe("assertUniqueLocalRefDeclarations", () => {
  it("accepts unique request-local refs", () => {
    expect(() => {
      assertUniqueLocalRefDeclarations([
        "dish_1",
        "ingredient_1",
        "step_1",
        "timeline_1",
        "adaptation_1",
        "pantry_1",
        "label_1",
      ]);
    }).not.toThrow();
  });

  it("rejects duplicate declarations", () => {
    expect(() => {
      assertUniqueLocalRefDeclarations(["dish_1", "dish_1"]);
    }).toThrow(/duplicate/i);
  });

  it("rejects non request-local refs including UUIDs", () => {
    expect(() => {
      assertUniqueLocalRefDeclarations(["10000000-0000-4000-8000-000000000001"]);
    }).toThrow();
    expect(() => {
      assertUniqueLocalRefDeclarations(["member_1"]);
    }).toThrow();
  });
});

describe("assertMaterializationRefUnion", () => {
  const serverKnown = ["dish_1", "ingredient_1", "step_1", "pantry_1"] as const;
  const replacement = ["dish_2", "ingredient_10", "step_10"] as const;

  it("accepts a collision-free union with resolved refs", () => {
    expect(() => {
      assertMaterializationRefUnion({
        serverKnownDeclarations: serverKnown,
        replacementDeclarations: replacement,
        referencedRefs: [
          { expectedKind: "dish", ref: "dish_1" },
          { expectedKind: "dish", ref: "dish_2" },
          { expectedKind: "step", ref: "step_10" },
        ],
        labelSourceRefs: ["ingredient_10", "dish_1"],
      });
    }).not.toThrow();
  });

  it("rejects a collision between server-known and replacement declarations", () => {
    expect(() => {
      assertMaterializationRefUnion({
        serverKnownDeclarations: serverKnown,
        replacementDeclarations: ["dish_1", "ingredient_10"],
        referencedRefs: [],
        labelSourceRefs: [],
      });
    }).toThrow(/collision/i);
  });

  it("rejects a dangling referenced ref", () => {
    expect(() => {
      assertMaterializationRefUnion({
        serverKnownDeclarations: serverKnown,
        replacementDeclarations: replacement,
        referencedRefs: [{ expectedKind: "dish", ref: "dish_99" }],
        labelSourceRefs: [],
      });
    }).toThrow(/dangling/i);
  });

  it("rejects a wrong-kind referenced ref", () => {
    expect(() => {
      assertMaterializationRefUnion({
        serverKnownDeclarations: serverKnown,
        replacementDeclarations: replacement,
        referencedRefs: [{ expectedKind: "dish", ref: "ingredient_1" }],
        labelSourceRefs: [],
      });
    }).toThrow(/wrong-kind|wrong kind/i);
  });

  it("rejects a label source outside the allowed source namespaces", () => {
    expect(() => {
      assertMaterializationRefUnion({
        serverKnownDeclarations: [...serverKnown, "label_1"],
        replacementDeclarations: replacement,
        referencedRefs: [],
        labelSourceRefs: ["pantry_1"],
      });
    }).toThrow(/label source/i);
  });
});
