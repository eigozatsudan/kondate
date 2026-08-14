import { describe, expect, it } from "vitest";
import {
  collectGuaranteePhraseIssuesFromDishRegenAiOutput,
  collectGuaranteePhraseIssuesFromFlyerMenu,
  guaranteePhraseRedaction,
  redactGuaranteePhraseText,
} from "./guarantee-phrases.js";

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

  it("redacts guarantee phrasing and leaves ordinary text unchanged", () => {
    expect(
      redactGuaranteePhraseText("さっと炒める主菜", guaranteePhraseRedaction.description),
    ).toBe("さっと炒める主菜");
    // 葉全体をプレースホルダにすると小麦針が消え、後から家族へ小麦を足しても
    // 履歴再検証が direct_allergen_match を出せない。フレーズだけ剥がす。
    expect(
      redactGuaranteePhraseText("小麦アレルギーでも安全です", guaranteePhraseRedaction.description),
    ).toBe("小麦アレルギーでも");
    expect(redactGuaranteePhraseText("安全です", "アレルギーでも安心")).toBe("（省略）");
  });

  it("keeps allergen and food-rule tokens when stripping a guarantee phrase", () => {
    expect(
      redactGuaranteePhraseText("小麦アレルギーでも安全です", guaranteePhraseRedaction.description),
    ).toContain("小麦");
    expect(
      redactGuaranteePhraseText("卵を加えても安全です", guaranteePhraseRedaction.instruction),
    ).toContain("卵");
    expect(
      redactGuaranteePhraseText("炒り大豆でも安全です", guaranteePhraseRedaction.description),
    ).toContain("炒り大豆");
    expect(
      redactGuaranteePhraseText("小麦アレルギーでも安心", guaranteePhraseRedaction.description),
    ).toBe("小麦");
    expect(
      redactGuaranteePhraseText("小麦アレルギーでも安全です", guaranteePhraseRedaction.description),
    ).not.toContain("安全です");
  });

  it.each([
    { name: "mid-word spaces", text: "小麦アレルギーでも安全 です" },
    { name: "zero-width space", text: "小麦アレルギーでも安全\u200bです" },
    { name: "katakana desu", text: "小麦は安全デス" },
  ])("keeps wheat token after folded guarantee redaction ($name)", ({ text }) => {
    const redacted = redactGuaranteePhraseText(text, guaranteePhraseRedaction.description);
    expect(redacted).toContain("小麦");
    expect(redacted.includes("安全です")).toBe(false);
    expect(redacted.includes("安全デス")).toBe(false);
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

describe("collectGuaranteePhraseIssuesFromFlyerMenu", () => {
  function flyerMenu(mainName: string) {
    return {
      weekStartJst: "2026-07-27",
      days: Array.from({ length: 7 }, (_, index) => ({
        dayIndex: index + 1,
        label: `Day${String(index + 1)}`,
        mainName: index === 0 ? mainName : "野菜炒め",
        sideName: "味噌汁",
        ingredients: ["キャベツ"],
        notes: null as string | null,
      })),
    };
  }

  it("rejects the same generation guarantee needles in flyer text fields", () => {
    const issues = collectGuaranteePhraseIssuesFromFlyerMenu(flyerMenu("アレルギーでも安心チキン"));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatchObject({
      code: "invalid_menu_structure",
      path: "days.0.mainName",
    });
    expect(
      collectGuaranteePhraseIssuesFromFlyerMenu(flyerMenu("安全です煮")).length,
    ).toBeGreaterThan(0);
  });

  it("accepts ordinary flyer names", () => {
    expect(collectGuaranteePhraseIssuesFromFlyerMenu(flyerMenu("野菜炒め"))).toEqual([]);
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
