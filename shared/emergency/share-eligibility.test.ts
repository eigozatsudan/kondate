// @vitest-environment node

import { describe, expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { evaluateShareEligibility } from "./share-eligibility.js";

describe("evaluateShareEligibility", () => {
  it("accepts a default factory menu within emergency bounds", () => {
    const result = evaluateShareEligibility(makeValidatedMenu());
    expect(result).toEqual({ ok: true });
  });

  it("rejects totalElapsedMinutes > 15", () => {
    const menu = makeValidatedMenu({ totalElapsedMinutes: 16 });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "not_emergency_duration" });
  });

  it("accepts totalElapsedMinutes === 15", () => {
    const menu = makeValidatedMenu({ totalElapsedMinutes: 15 });
    expect(evaluateShareEligibility(menu)).toEqual({ ok: true });
  });

  it("rejects any pantrySelectionId non-null", () => {
    const base = makeValidatedMenu();
    const selectionId = "58000000-0000-4000-8000-000000000001";
    const dishes = base.dishes.map((dish, dishIndex) =>
      dishIndex === 0
        ? {
            ...dish,
            ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
              ingredientIndex === 0
                ? { ...ingredient, pantrySelectionId: selectionId }
                : ingredient,
            ),
          }
        : dish,
    );
    const menu = makeValidatedMenu({
      dishes,
      pantryUsage: [
        {
          selectionId,
          pantryItemId: "59000000-0000-4000-8000-000000000001",
          pantryItemName: "ごはん",
          priority: "prefer_use",
          usageStatus: "used",
          plannedQuantity: 300,
          inventoryQuantity: 300,
          shortageQuantity: 0,
          unit: "g",
          dishIds: [base.dishes[0]!.id],
          unusedReason: null,
        },
      ],
    });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "pantry_bound" });
  });

  it("rejects non-empty pantryUsage even when selection ids are null", () => {
    // dishes は factory 既定（pantrySelectionId はすべて null）のまま usage だけ載せる
    const menu = makeValidatedMenu({
      pantryUsage: [
        {
          selectionId: "58000000-0000-4000-8000-000000000099",
          pantryItemId: "59000000-0000-4000-8000-000000000099",
          pantryItemName: "残りもの",
          priority: "prefer_use",
          usageStatus: "unused",
          plannedQuantity: null,
          inventoryQuantity: null,
          shortageQuantity: null,
          unit: null,
          dishIds: [],
          unusedReason: "使わなかった",
        },
      ],
    });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "pantry_bound" });
  });

  it("rejects below minimum dish count for mealType", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      mealType: "breakfast",
      dishes: [base.dishes[0]!],
    });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "ineligible_structure" });
  });

  it("rejects empty timeline", () => {
    const menu = makeValidatedMenu({ timeline: [] });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "ineligible_structure" });
  });

  it("rejects a dish with empty steps", () => {
    const base = makeValidatedMenu();
    const dishes = base.dishes.map((dish, index) => (index === 0 ? { ...dish, steps: [] } : dish));
    const menu = makeValidatedMenu({ dishes });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "ineligible_structure" });
  });

  it("rejects missing required dish roles", () => {
    const base = makeValidatedMenu();
    const dishes = base.dishes.map((dish) => ({ ...dish, role: "main" as const }));
    const menu = makeValidatedMenu({ dishes });
    const result = evaluateShareEligibility(menu);
    expect(result).toEqual({ ok: false, reason: "ineligible_structure" });
  });
});
