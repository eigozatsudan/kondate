import { describe, expect, it } from "vitest";
import { detectUnsupportedMedicalRequest } from "../safety/medical-scope.js";
import {
  collectPlannerRequestText,
  plannerDraftInputSchema,
  plannerDraftSchema,
  plannerSubmissionSchema,
} from "./planner.js";

const memberId = "30000000-0000-4000-8000-000000000001";

const incompleteDraft = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

const validBase = {
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
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
        ...validBase,
        targetMode: "household",
        targetMemberIds: [memberId],
        servings: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    { targetMode: "idea", targetMemberIds: [memberId], servings: 2 },
    { targetMode: "idea", targetMemberIds: [], servings: null },
    { targetMode: "household", targetMemberIds: [], servings: null },
    { targetMode: "household", targetMemberIds: [memberId], servings: 2 },
  ])("rejects contradictory target values", (target) => {
    expect(plannerSubmissionSchema.safeParse({ ...validBase, ...target }).success).toBe(false);
  });

  it("accepts an idea submission with no target members and a servings count", () => {
    expect(
      plannerSubmissionSchema.safeParse({
        ...validBase,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 3,
      }).success,
    ).toBe(true);
  });

  it("keeps mode and servings unselected for an incomplete draft", () => {
    expect(
      plannerDraftInputSchema.parse({
        ...incompleteDraft,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
      }),
    ).toMatchObject({
      targetMode: null,
      targetMemberIds: [],
      servings: null,
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
    });
  });

  it.each([
    { targetMode: "household", targetMemberIds: [], servings: null },
    { targetMode: "household", targetMemberIds: [memberId], servings: 2 },
    { targetMode: "idea", targetMemberIds: [memberId], servings: 2 },
    { targetMode: "idea", targetMemberIds: [], servings: null },
    { targetMode: null, targetMemberIds: [memberId], servings: null },
    { targetMode: null, targetMemberIds: [], servings: 2 },
  ])("rejects contradictory draft target values", (target) => {
    expect(plannerDraftInputSchema.safeParse({ ...incompleteDraft, ...target }).success).toBe(
      false,
    );
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
        mainIngredients: [" 🍳﻿"],
        avoidIngredients: [" 乳 "],
        memo: "﻿メモ ",
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

  it("projects every planner free-text field into canonical request text", () => {
    expect(
      collectPlannerRequestText({
        mainIngredients: [" 鶏肉 ", "離乳食"],
        avoidIngredients: [" 嚥下食 "],
        memo: " 治療食 ",
      }),
    ).toBe("鶏肉\n離乳食\n嚥下食\n治療食");
  });

  it("exposes main-ingredient medical requests to the shared detector", () => {
    expect(
      detectUnsupportedMedicalRequest(
        collectPlannerRequestText({
          mainIngredients: ["離乳食"],
          avoidIngredients: [],
          memo: "",
        }),
      ),
    ).toContain("weaning_food");
  });

  it("keeps the full stored draft row consistent with the same target/servings rules", () => {
    expect(
      plannerDraftSchema.safeParse({
        id: "31000000-0000-4000-8000-000000000001",
        userId: "32000000-0000-4000-8000-000000000001",
        ...incompleteDraft,
        targetMode: "household",
        targetMemberIds: [],
        revision: 0,
        createdAt: "2026-07-11T00:00:00+09:00",
        updatedAt: "2026-07-11T00:00:00+09:00",
      }).success,
    ).toBe(false);
  });
});
