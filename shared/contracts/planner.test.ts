import { describe, expect, it } from "vitest";
import { plannerDraftInputSchema, plannerSubmissionSchema } from "./planner.js";

const incompleteDraft = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMemberIds: [],
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

describe("planner contracts", () => {
  it("allows an incomplete autosave draft", () => {
    expect(plannerDraftInputSchema.parse(incompleteDraft)).toEqual(incompleteDraft);
  });

  it("requires the three basic choices and one target for submission", () => {
    expect(plannerSubmissionSchema.safeParse(incompleteDraft).success).toBe(false);
    expect(
      plannerSubmissionSchema.safeParse({
        ...incompleteDraft,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMemberIds: ["30000000-0000-4000-8000-000000000001"],
      }).success,
    ).toBe(true);
  });

  it("limits memo to 200 characters", () => {
    expect(
      plannerDraftInputSchema.safeParse({ ...incompleteDraft, memo: "あ".repeat(201) }).success,
    ).toBe(false);
  });

  it("canonicalizes Unicode padding in draft text fields", () => {
    expect(
      plannerDraftInputSchema.parse({
        ...incompleteDraft,
        mainIngredients: ["\u00a0🍳\ufeff"],
        avoidIngredients: ["\u2028乳\u2029"],
        memo: "\ufeffメモ\u00a0",
      }),
    ).toMatchObject({
      mainIngredients: ["🍳"],
      avoidIngredients: ["乳"],
      memo: "メモ",
    });
  });

  it("counts astral draft text by Unicode code point", () => {
    expect(
      plannerDraftInputSchema.safeParse({
        ...incompleteDraft,
        mainIngredients: ["🍳".repeat(80)],
        memo: "🍳".repeat(200),
      }).success,
    ).toBe(true);
    expect(
      plannerDraftInputSchema.safeParse({
        ...incompleteDraft,
        mainIngredients: ["🍳".repeat(81)],
      }).success,
    ).toBe(false);
  });
});
