import { describe, expect, it } from "vitest";
import {
  collectNonJapaneseUserTextIssues,
  collectNonJapaneseUserTextIssuesFromDishRegenAiOutput,
  isAcceptableJapaneseUserText,
} from "./japanese-user-text.js";
import { makeGeneratedMenu } from "../testing/factories.js";

describe("isAcceptableJapaneseUserText", () => {
  it.each([
    "牛肉炒飯",
    "野菜入りの炒めご飯",
    "フライパンに油を熱し、牛肉を炒める。",
    "ごはん",
    "大さじ1",
    "少々",
    "適量",
    "BBQソース",
    "mainを調理",
  ])("accepts Japanese or CJK-bearing text: %s", (text) => {
    expect(isAcceptableJapaneseUserText(text)).toBe(true);
  });

  it.each(["300g", "1/2", "200", "g", "ml", "kg", "L", "15ml", "  10g  "])(
    "accepts measurement-only text: %s",
    (text) => {
      expect(isAcceptableJapaneseUserText(text)).toBe(true);
    },
  );

  it.each([
    "Beef fried rice with vegetables.",
    "fallback model success fixture",
    "Stir fry beef",
    "main dish",
    "ketchup",
    "1 tbsp",
    "Привет",
    "مرحبا",
  ])("rejects Latin-or-foreign prose without Japanese script: %s", (text) => {
    expect(isAcceptableJapaneseUserText(text)).toBe(false);
  });
});

describe("collectNonJapaneseUserTextIssues", () => {
  it("flags English dish description at the canonical path", () => {
    const base = makeGeneratedMenu();
    const menu = makeGeneratedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, description: "Beef fried rice with vegetables." } : dish,
      ),
    });
    const issues = collectNonJapaneseUserTextIssues(menu);
    expect(issues).toEqual([
      expect.objectContaining({
        code: "invalid_menu_structure",
        path: "dishes.0.description",
        message: "利用者向けの文言は日本語で書いてください",
      }),
    ]);
  });

  it("does not flag measurement quantityText or unit", () => {
    const base = makeGeneratedMenu();
    const first = base.dishes[0]!;
    const menu = makeGeneratedMenu({
      dishes: [
        {
          ...first,
          ingredients: [
            {
              ...first.ingredients[0]!,
              quantityText: "300g",
              unit: "g",
            },
          ],
        },
        ...base.dishes.slice(1),
      ],
    });
    expect(collectNonJapaneseUserTextIssues(menu)).toEqual([]);
  });

  it("flags English timeline instruction", () => {
    const base = makeGeneratedMenu();
    const menu = makeGeneratedMenu({
      timeline: base.timeline.map((step, index) =>
        index === 0 ? { ...step, instruction: "Cook the main dish" } : step,
      ),
    });
    expect(collectNonJapaneseUserTextIssues(menu)).toEqual([
      expect.objectContaining({
        code: "invalid_menu_structure",
        path: "timeline.0.instruction",
      }),
    ]);
  });

  // 結果 UI の「使わなかった理由」は collectMenuTextSources 外だが利用者向け文言
  it("flags English pantryUsage.unusedReason", () => {
    const menu = makeGeneratedMenu({
      pantryUsage: [
        {
          selectionId: "58000000-0000-4000-8000-000000000001",
          pantryItemId: "59000000-0000-4000-8000-000000000001",
          pantryItemName: "にんじん",
          priority: "prefer_use",
          usageStatus: "unused",
          plannedQuantity: null,
          inventoryQuantity: null,
          shortageQuantity: null,
          unit: null,
          dishIds: [],
          unusedReason: "spoiled and skipped",
        },
      ],
    });
    expect(collectNonJapaneseUserTextIssues(menu)).toEqual([
      expect.objectContaining({
        code: "invalid_menu_structure",
        path: "pantryUsage.0.unusedReason",
        message: "利用者向けの文言は日本語で書いてください",
      }),
    ]);
  });

  it("rejects English unit tokens (tsp) that fixtures must not emit", () => {
    expect(isAcceptableJapaneseUserText("tsp")).toBe(false);
    expect(isAcceptableJapaneseUserText("piece")).toBe(false);
  });
});

describe("collectNonJapaneseUserTextIssuesFromDishRegenAiOutput", () => {
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

  it("accepts Japanese AI output", () => {
    expect(collectNonJapaneseUserTextIssuesFromDishRegenAiOutput(baseOutput)).toEqual([]);
  });

  it("flags English replacement description without caring about retained dishes", () => {
    const issues = collectNonJapaneseUserTextIssuesFromDishRegenAiOutput({
      ...baseOutput,
      replacementDish: {
        ...baseOutput.replacementDish,
        description: "Beef fried rice with vegetables.",
      },
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "invalid_menu_structure",
        path: "replacementDish.description",
        message: "利用者向けの文言は日本語で書いてください",
      }),
    ]);
  });

  it("flags English timeline instruction from AI", () => {
    const issues = collectNonJapaneseUserTextIssuesFromDishRegenAiOutput({
      ...baseOutput,
      timeline: [
        {
          ...baseOutput.timeline[0]!,
          instruction: "Cook the main dish",
        },
      ],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        path: "timeline.0.instruction",
      }),
    ]);
  });
});
