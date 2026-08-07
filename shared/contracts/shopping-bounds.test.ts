import { describe, expect, it } from "vitest";
import { shoppingItemSchema, shoppingListSchema } from "./shopping.js";

const listId = "10000000-0000-4000-8000-000000000001";
const itemId = "10000000-0000-4000-8000-000000000002";

const validItem = {
  id: itemId,
  listId,
  displayName: "にんじん",
  normalizedName: "にんじん",
  storeSection: "produce" as const,
  quantityValue: 2,
  quantityText: "2本",
  unit: "本",
  pantryCheckRequired: false,
  isChecked: false,
  isManual: false,
  isManuallyEdited: false,
  isRemovedByUser: false,
  labelWarnings: [],
};

describe("shopping response bounds (S2/S8)", () => {
  it("accepts draft-aligned item strings and quantity ceiling", () => {
    expect(shoppingItemSchema.safeParse(validItem).success).toBe(true);
    expect(
      shoppingItemSchema.safeParse({ ...validItem, quantityValue: 999_999 }).success,
    ).toBe(true);
  });

  it("rejects unbounded displayName / quantityValue", () => {
    expect(
      shoppingItemSchema.safeParse({ ...validItem, displayName: "あ".repeat(101) }).success,
    ).toBe(false);
    expect(
      shoppingItemSchema.safeParse({ ...validItem, quantityValue: 1e15 }).success,
    ).toBe(false);
    expect(
      shoppingListSchema.safeParse({
        id: listId,
        status: "active",
        version: 1,
        items: [{ ...validItem, quantityText: "x".repeat(61) }],
        listLabelWarnings: [],
      }).success,
    ).toBe(false);
  });
});
