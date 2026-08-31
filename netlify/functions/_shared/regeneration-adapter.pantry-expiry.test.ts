import { describe, expect, it } from "vitest";
import type { ExpiredPantryConfirmation } from "../../../shared/contracts/generation.js";
import type { PantryItem } from "../../../shared/contracts/pantry.js";
import type { PlannerSubmission } from "../../../shared/contracts/planner.js";
import { applyRegenerationPantryExpiryPolicy } from "./regeneration-adapter.js";

const pantryId = "74000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-28T03:00:00.000Z"); // JST 12:00 same day

function submissionWithPantry(ids: readonly string[]): PlannerSubmission {
  return {
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
    targetMode: "household",
    targetMemberIds: ["55000000-0000-4000-8000-000000000001"],
    servings: null,
    timeLimitMinutes: 30,
    budgetPreference: null,
    ingredientPreference: null,
    noveltyPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: ids.map((pantryItemId) => ({
      pantryItemId,
      priority: "prefer_use" as const,
    })),
  };
}

function pantryItem(
  overrides: Partial<PantryItem> & Pick<PantryItem, "id" | "expiresOn">,
): PantryItem {
  return {
    id: overrides.id,
    userId: "11000000-0000-4000-8000-000000000001",
    name: overrides.name ?? "牛乳",
    quantity: 1,
    unit: "本",
    expiresOn: overrides.expiresOn,
    expirationType: "best_before",
    openedState: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("applyRegenerationPantryExpiryPolicy", () => {
  it("design §269: rejects unconfirmed expired pantry without stripping the selection", () => {
    const submission = submissionWithPantry([pantryId]);
    const items = [pantryItem({ id: pantryId, expiresOn: "2026-07-20" })];
    try {
      applyRegenerationPantryExpiryPolicy(submission, items, [], now);
      expect.unreachable("expected expired_pantry_unconfirmed");
    } catch (error) {
      expect(error).toMatchObject({ status: 422, code: "expired_pantry_unconfirmed" });
    }
    // 選択は呼び出し前のまま（strip しない）
    expect(submission.pantrySelections).toHaveLength(1);
  });

  it("accepts same-day confirmations and keeps expired selections in the submission", () => {
    const submission = submissionWithPantry([pantryId]);
    const items = [pantryItem({ id: pantryId, expiresOn: "2026-07-20" })];
    const confirmations: readonly ExpiredPantryConfirmation[] = [
      { pantryItemId: pantryId, checkedAt: now.toISOString() },
    ];
    const result = applyRegenerationPantryExpiryPolicy(submission, items, confirmations, now);
    expect(result.submission.pantrySelections).toEqual(submission.pantrySelections);
    expect(result.expiredPantryChecks).toEqual(confirmations);
  });

  it("passes through when no selected pantry is expired", () => {
    const submission = submissionWithPantry([pantryId]);
    const items = [pantryItem({ id: pantryId, expiresOn: "2026-08-01" })];
    const result = applyRegenerationPantryExpiryPolicy(submission, items, [], now);
    expect(result.submission).toBe(submission);
    expect(result.expiredPantryChecks).toEqual([]);
  });
});
