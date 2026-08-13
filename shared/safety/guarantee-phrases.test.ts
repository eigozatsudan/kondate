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
    ).toEqual([guaranteeIssue]);
  });

  it.each([
    { name: "mid-word spaces", description: "小麦アレルギーでも安全 です" },
    { name: "zero-width space", description: "小麦アレルギーでも安全\u200bです" },
    { name: "katakana desu", description: "主菜は安全デス" },
    { name: "halfwidth katakana allergy-ready", description: "ｱﾚﾙｷﾞｰ対応済み" },
  ])("rejects folded guarantee phrasing ($name)", ({ description }) => {
    expect(
      collectGuaranteePhraseIssuesFromDishRegenAiOutput({
        ...baseOutput,
        replacementDish: {
          ...baseOutput.replacementDish,
          description,
        },
      }),
    ).toEqual([guaranteeIssue]);
  });

  it("does not treat the fixed disclaimer as a guarantee after folding", () => {
    // 固定免責は「である / であることを」が挟まる。畳み（NFKC / Cf / 空白削除 / カナ幅）後も
    // 「安全です」「安全を保証」には当たらない。句読点除去までは掛けない前提の回帰。
    expect(
      collectGuaranteePhraseIssuesFromDishRegenAiOutput({
        ...baseOutput,
        replacementDish: {
          ...baseOutput.replacementDish,
          description: MENU_LABEL_DISCLAIMER_COPY,
        },
      }),
    ).toEqual([]);
  });
});

const guaranteeIssue = {
  code: "invalid_menu_structure",
  path: "replacementDish.description",
  message: "利用者向け本文に安全保証の表現は書けません",
} as const;

/** src の MENU_LABEL_DISCLAIMER と同文。shared から UI 定数は import しない。 */
const MENU_LABEL_DISCLAIMER_COPY =
  "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。";
