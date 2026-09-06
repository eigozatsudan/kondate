import { describe, expect, it } from "vitest";
import {
  plannerDraftInputSchema,
  type PlannerDraft,
  type PlannerDraftInput,
} from "@shared/contracts/planner";
import {
  buildPlannerDraftInputFromWeeklyPlanDay,
  draftNeedsOverwriteConfirmation,
} from "./weekly-plan-draft-handoff.js";

const MEMBER_ONE_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_TWO_ID = "22222222-2222-4222-8222-222222222222";

const sampleDay = {
  dayIndex: 1,
  label: "月",
  mainName: "鶏の照り焼き",
  sideName: "ほうれん草のおひたし",
  ingredients: Array.from({ length: 10 }, (_, index) => `食材${String(index + 1)}`),
  notes: null,
};

const samplePlan = {
  targetMemberIds: [MEMBER_ONE_ID, MEMBER_TWO_ID],
  cuisineGenre: "japanese" as const,
  budgetPreference: null,
  noveltyPreference: null,
};

describe("buildPlannerDraftInputFromWeeklyPlanDay", () => {
  it("fills all 13 PlannerDraftInput keys with schema-valid values", () => {
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, samplePlan, [
      MEMBER_ONE_ID,
      MEMBER_TWO_ID,
    ]);
    if ("error" in outcome) throw new Error("expected success");

    expect(outcome.input).toEqual({
      mealType: "dinner",
      mainIngredients: Array.from({ length: 8 }, (_, index) => `食材${String(index + 1)}`),
      cuisineGenre: "japanese",
      targetMode: "household",
      targetMemberIds: [MEMBER_ONE_ID, MEMBER_TWO_ID],
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
      avoidIngredients: [],
      memo: "主菜: 鶏の照り焼き",
      pantrySelections: [],
    });
    expect(plannerDraftInputSchema.safeParse(outcome.input).success).toBe(true);
  });

  it("carries budgetPreference/noveltyPreference through when non-null", () => {
    const plan = {
      ...samplePlan,
      budgetPreference: "economy" as const,
      noveltyPreference: "twist" as const,
    };
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, plan, [
      MEMBER_ONE_ID,
      MEMBER_TWO_ID,
    ]);
    if ("error" in outcome) throw new Error("expected success");

    expect(outcome.input.budgetPreference).toBe("economy");
    expect(outcome.input.noveltyPreference).toBe("twist");
  });

  it("keeps only target members in the current complete household", () => {
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, samplePlan, [MEMBER_TWO_ID]);
    if ("error" in outcome) throw new Error("expected success");

    expect(outcome.input.targetMemberIds).toEqual([MEMBER_TWO_ID]);
  });

  it("errors when target members and current complete members are disjoint", () => {
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, samplePlan, [
      "33333333-3333-4333-8333-333333333333",
    ]);

    expect(outcome).toEqual({ error: "no_eligible_members" });
  });

  it("errors when there are no current complete members", () => {
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, samplePlan, []);

    expect(outcome).toEqual({ error: "no_eligible_members" });
  });

  it("uses the first eight ingredients before truncating, trimming, and filtering", () => {
    const longEmojiName = "😀".repeat(81);
    const day = {
      ...sampleDay,
      ingredients: [
        "  ",
        longEmojiName,
        " 食材3 ",
        "食材4",
        "食材5",
        "食材6",
        "食材7",
        "食材8",
        "食材9",
      ],
    };
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(day, samplePlan, [MEMBER_ONE_ID]);
    if ("error" in outcome) throw new Error("expected success");

    expect(outcome.input.mainIngredients).toHaveLength(7);
    expect(Array.from(outcome.input.mainIngredients[0] ?? "")).toHaveLength(80);
    expect(outcome.input.mainIngredients[1]).toBe("食材3");
    expect(outcome.input.mainIngredients).not.toContain("食材9");
  });

  it("truncates before trimming an ingredient", () => {
    const day = { ...sampleDay, ingredients: [`${" ".repeat(80)}食材`] };
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(day, samplePlan, [MEMBER_ONE_ID]);
    if ("error" in outcome) throw new Error("expected success");

    expect(outcome.input.mainIngredients).toEqual([]);
  });

  it("truncates the prefixed memo to 200 Unicode code points", () => {
    const day = { ...sampleDay, mainName: "😀".repeat(250) };
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(day, samplePlan, [MEMBER_ONE_ID]);
    if ("error" in outcome) throw new Error("expected success");

    expect(Array.from(outcome.input.memo)).toHaveLength(200);
    expect(outcome.input.memo.startsWith("主菜: ")).toBe(true);
  });

  it("does not mutate day, plan, or current member inputs", () => {
    const day = structuredClone(sampleDay);
    const plan = structuredClone(samplePlan);
    const currentMemberIds = [MEMBER_TWO_ID, MEMBER_ONE_ID];
    const before = structuredClone({ day, plan, currentMemberIds });

    buildPlannerDraftInputFromWeeklyPlanDay(day, plan, currentMemberIds);

    expect({ day, plan, currentMemberIds }).toEqual(before);
  });
});

describe("draftNeedsOverwriteConfirmation", () => {
  const candidate = successfulCandidate();

  it("returns false when there is no existing draft", () => {
    expect(draftNeedsOverwriteConfirmation(null, candidate)).toBe(false);
  });

  it("returns false when all existing fields are empty", () => {
    expect(draftNeedsOverwriteConfirmation(emptyDraft(), candidate)).toBe(false);
  });

  it("returns false when all existing values equal the candidate", () => {
    expect(draftNeedsOverwriteConfirmation(structuredClone(candidate), candidate)).toBe(false);
  });

  it("ignores persisted draft metadata when all input values equal the candidate", () => {
    const existing: PlannerDraft = {
      ...structuredClone(candidate),
      id: "55555555-5555-4555-8555-555555555555",
      userId: "66666666-6666-4666-8666-666666666666",
      revision: 3,
      createdAt: "2026-09-05T00:00:00+09:00",
      updatedAt: "2026-09-05T01:00:00+09:00",
    };

    expect(draftNeedsOverwriteConfirmation(existing, candidate)).toBe(false);
  });

  const differingNonEmptyValues = {
    mealType: "breakfast",
    mainIngredients: ["豚肉"],
    cuisineGenre: "western",
    targetMode: "idea",
    targetMemberIds: [MEMBER_TWO_ID],
    servings: 2,
    timeLimitMinutes: 15,
    budgetPreference: "economy",
    ingredientPreference: "more",
    noveltyPreference: "twist",
    avoidIngredients: ["卵"],
    memo: "別のメモ",
    pantrySelections: [
      {
        pantryItemId: "44444444-4444-4444-8444-444444444444",
        priority: "must_use",
      },
    ],
  } as const satisfies PlannerDraftInput;

  for (const key of Object.keys(differingNonEmptyValues) as (keyof PlannerDraftInput)[]) {
    it(`returns true when the non-empty ${key} differs`, () => {
      const existing = emptyDraft();
      Object.assign(existing, { [key]: differingNonEmptyValues[key] });

      expect(draftNeedsOverwriteConfirmation(existing, candidate)).toBe(true);
    });
  }

  it("returns true when identical existing and candidate drafts both use idea mode", () => {
    const ideaDraft: PlannerDraftInput = {
      ...emptyDraft(),
      targetMode: "idea",
      servings: 2,
    };

    expect(draftNeedsOverwriteConfirmation(ideaDraft, structuredClone(ideaDraft))).toBe(true);
  });
});

function successfulCandidate(): PlannerDraftInput {
  const outcome = buildPlannerDraftInputFromWeeklyPlanDay(sampleDay, samplePlan, [
    MEMBER_ONE_ID,
    MEMBER_TWO_ID,
  ]);
  if ("error" in outcome) throw new Error("expected success");
  return outcome.input;
}

function emptyDraft(): PlannerDraftInput {
  return {
    mealType: null,
    mainIngredients: [],
    cuisineGenre: null,
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
    noveltyPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: [],
  };
}
