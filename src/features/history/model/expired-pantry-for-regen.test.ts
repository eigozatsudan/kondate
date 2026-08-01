import { describe, expect, it } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerSubmission } from "@shared/contracts/planner";
import {
  hasMissingPantrySelectionsForRegeneration,
  listExpiredPantryForRegeneration,
} from "./expired-pantry-for-regen";

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
  ingredientPreference: null,
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

  it("skips deleted live pantry from expiry list (HR5 pair: use missing gate)", () => {
    // 欠落 ID（p-expired）は期限リストに出さない。hasMissing で別途ゲートする。
    // 残っている p-fresh が期限切れなら、それは従来どおり期限確認対象に残る。
    expect(
      listExpiredPantryForRegeneration(
        submission,
        [item("p-fresh", "にんじん", "2026-07-01")],
        now,
      ),
    ).toEqual([{ pantryItemId: "p-fresh", name: "にんじん" }]);
  });
});

describe("hasMissingPantrySelectionsForRegeneration", () => {
  it("is true when a selected pantry id is absent from live (HR5)", () => {
    expect(
      hasMissingPantrySelectionsForRegeneration(submission, [
        item("p-fresh", "にんじん", "2026-08-01"),
      ]),
    ).toBe(true);
  });

  it("is false when all selections exist or submission has none", () => {
    expect(
      hasMissingPantrySelectionsForRegeneration(submission, [
        item("p-expired", "牛乳", "2026-07-01"),
        item("p-fresh", "にんじん", "2026-08-01"),
      ]),
    ).toBe(false);
    expect(hasMissingPantrySelectionsForRegeneration(null, [])).toBe(false);
    expect(
      hasMissingPantrySelectionsForRegeneration({ ...submission, pantrySelections: [] }, []),
    ).toBe(false);
  });
});
