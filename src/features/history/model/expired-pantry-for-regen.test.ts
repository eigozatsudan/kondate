import { describe, expect, it } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerSubmission } from "@shared/contracts/planner";
import { listExpiredPantryForRegeneration } from "./expired-pantry-for-regen";

const now = new Date("2026-07-28T03:00:00.000Z");

function item(id: string, name: string, expiresOn: string | null): PantryItem {
  return {
    id,
    userId: "u1",
    name,
    quantity: 1,
    unit: "個",
    expiresOn,
    expirationType: null,
    openedState: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

const submission = {
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "idea",
  targetMemberIds: [],
  servings: 2,
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [
    { pantryItemId: "p-expired", priority: "prefer_use" },
    { pantryItemId: "p-fresh", priority: "must_use" },
  ],
} as PlannerSubmission;

describe("listExpiredPantryForRegeneration", () => {
  it("lists only selected pantry past entered expiry", () => {
    const live = [
      item("p-expired", "牛乳", "2026-07-01"),
      item("p-fresh", "にんじん", "2026-08-01"),
      item("p-other", "豆腐", "2026-07-01"),
    ];
    expect(listExpiredPantryForRegeneration(submission, live, now)).toEqual([
      { pantryItemId: "p-expired", name: "牛乳" },
    ]);
  });

  it("returns empty when submission is null or nothing is expired", () => {
    expect(
      listExpiredPantryForRegeneration(null, [item("p-expired", "牛乳", "2026-07-01")], now),
    ).toEqual([]);
    expect(
      listExpiredPantryForRegeneration(
        submission,
        [item("p-expired", "牛乳", "2026-08-10"), item("p-fresh", "にんじん", null)],
        now,
      ),
    ).toEqual([]);
  });
});
