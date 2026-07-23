import { describe, expect, it } from "vitest";
import type { PlannerSubmission } from "@shared/contracts/planner";
import { createPlannerDraftFromMenu } from "./draft-from-menu";

const ideaSubmission: Extract<PlannerSubmission, { targetMode: "idea" }> = {
  mealType: "dinner",
  mainIngredients: ["鶏肉", "きのこ"],
  cuisineGenre: "japanese",
  targetMode: "idea",
  targetMemberIds: [],
  servings: 3,
  timeLimitMinutes: 30,
  budgetPreference: "economy",
  avoidIngredients: ["セロリ"],
  memo: "さっぱりめに",
  pantrySelections: [
    {
      pantryItemId: "66000000-0000-4000-8000-000000000001",
      priority: "must_use",
    },
  ],
};

const householdSubmission: Extract<PlannerSubmission, { targetMode: "household" }> = {
  mealType: "breakfast",
  mainIngredients: ["ごはん"],
  cuisineGenre: "western",
  targetMode: "household",
  targetMemberIds: ["55000000-0000-4000-8000-000000000001"],
  servings: null,
  timeLimitMinutes: 15,
  budgetPreference: "standard",
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

describe("createPlannerDraftFromMenu", () => {
  it("copies meal, ingredients, genre, optional fields, and pantry while resetting audience fields", () => {
    const draft = createPlannerDraftFromMenu(ideaSubmission);
    expect(draft).toEqual({
      mealType: "dinner",
      mainIngredients: ["鶏肉", "きのこ"],
      cuisineGenre: "japanese",
      targetMode: null,
      targetMemberIds: [],
      servings: null,
      timeLimitMinutes: 30,
      budgetPreference: "economy",
      avoidIngredients: ["セロリ"],
      memo: "さっぱりめに",
      pantrySelections: [
        {
          pantryItemId: "66000000-0000-4000-8000-000000000001",
          priority: "must_use",
        },
      ],
    });
  });

  it("resets household audience fields without carrying member ids into the new draft", () => {
    const draft = createPlannerDraftFromMenu(householdSubmission);
    expect(draft.targetMode).toBeNull();
    expect(draft.targetMemberIds).toEqual([]);
    expect(draft.servings).toBeNull();
    expect(draft.mealType).toBe("breakfast");
    expect(draft.mainIngredients).toEqual(["ごはん"]);
    expect(draft.cuisineGenre).toBe("western");
  });

  it("does not mutate the source submission arrays", () => {
    const draft = createPlannerDraftFromMenu(ideaSubmission);
    draft.mainIngredients.push("改変");
    draft.pantrySelections.push({
      pantryItemId: "66000000-0000-4000-8000-000000000099",
      priority: "prefer_use",
    });
    expect(ideaSubmission.mainIngredients).toEqual(["鶏肉", "きのこ"]);
    expect(ideaSubmission.pantrySelections).toHaveLength(1);
  });
});
