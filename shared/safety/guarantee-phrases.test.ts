import { describe, expect, it } from "vitest";
import { collectGuaranteePhraseIssuesFromDishRegenAiOutput } from "./guarantee-phrases.js";

describe("collectGuaranteePhraseIssuesFromDishRegenAiOutput", () => {
  const baseOutput = {
    replacementDish: {
      dishRef: "dish_1",
      role: "main" as const,
      position: 1,
      name: "豚肉炒め",
      description: "さっと炒める主菜",
      cookingTimeMinutes: 15,
      ingredients: [
        {
          ingredientRef: "ingredient_1",
          position: 1,
          name: "豚こま肉",
          quantityValue: 200,
          quantityText: "200g",
          unit: "g",
          storeSection: "meat_fish" as const,
          pantryRef: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          stepRef: "step_1",
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
        durationMinutes: 15,
        instruction: "主菜を炒める",
        dishRef: "dish_1",
        stepRef: "step_1",
      },
    ],
    adaptations: [],
    pantryUsage: [],
    labelConfirmations: [],
  };

  it("accepts ordinary Japanese AI output", () => {
    expect(collectGuaranteePhraseIssuesFromDishRegenAiOutput(baseOutput)).toEqual([]);
  });

  it("rejects replacement description that guarantees safety", () => {
    expect(
      collectGuaranteePhraseIssuesFromDishRegenAiOutput({
        ...baseOutput,
        replacementDish: {
          ...baseOutput.replacementDish,
          description: "小麦アレルギーでも安全です",
        },
      }),
    ).toEqual([
      {
        code: "invalid_menu_structure",
        path: "replacementDish.description",
        message: "利用者向け本文に安全保証の表現は書けません",
      },
    ]);
  });
});
