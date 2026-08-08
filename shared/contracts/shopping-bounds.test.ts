import { describe, expect, it } from "vitest";
import {
  reconcileShoppingListRequestSchema,
  shoppingDraftItemSchema,
  shoppingDraftSchema,
  shoppingItemLabelWarningsMax,
  shoppingItemSchema,
  shoppingItemsMax,
  shoppingListSchema,
  shoppingSourceIngredientsMax,
} from "./shopping.js";

const listId = "10000000-0000-4000-8000-000000000001";
const itemId = "10000000-0000-4000-8000-000000000002";
const menuId = "10000000-0000-4000-8000-000000000003";
const idempotencyKey = "10000000-0000-4000-8000-000000000004";

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

const validDraftItem = {
  key: "にんじん|本",
  displayName: "にんじん",
  normalizedName: "にんじん",
  storeSection: "produce" as const,
  quantityValue: 2,
  quantityText: "2本",
  unit: "本",
  pantryCheckRequired: false,
  sourceIngredients: [
    {
      ingredientId: itemId,
      dishId: listId,
      dishName: "サラダ",
      name: "にんじん",
      quantityValue: 2,
      quantityText: "2本",
      unit: "本",
      storeSection: "produce" as const,
    },
  ],
  labelWarnings: [],
};

describe("shopping response bounds (S2/S8)", () => {
  it("accepts draft-aligned item strings and quantity ceiling", () => {
    expect(shoppingItemSchema.safeParse(validItem).success).toBe(true);
    expect(shoppingItemSchema.safeParse({ ...validItem, quantityValue: 999_999 }).success).toBe(
      true,
    );
  });

  it("rejects unbounded displayName / quantityValue", () => {
    expect(
      shoppingItemSchema.safeParse({ ...validItem, displayName: "あ".repeat(101) }).success,
    ).toBe(false);
    expect(shoppingItemSchema.safeParse({ ...validItem, quantityValue: 1e15 }).success).toBe(false);
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

  it("rejects sub-milli quantityValue on shopping item (S3)", () => {
    expect(shoppingItemSchema.safeParse({ ...validItem, quantityValue: 1e-10 }).success).toBe(
      false,
    );
    expect(shoppingItemSchema.safeParse({ ...validItem, quantityValue: 1.23456789 }).success).toBe(
      false,
    );
    expect(shoppingItemSchema.safeParse({ ...validItem, quantityValue: 0.001 }).success).toBe(true);
  });

  it("rejects draft/list items arrays over shoppingItemsMax (S6)", () => {
    const overMax = Array.from({ length: shoppingItemsMax + 1 }, (_, index) => ({
      ...validItem,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(
      shoppingListSchema.safeParse({
        id: listId,
        status: "active",
        version: 1,
        items: overMax,
        listLabelWarnings: [],
      }).success,
    ).toBe(false);

    const overMaxDraft = Array.from({ length: shoppingItemsMax + 1 }, (_, index) => ({
      ...validDraftItem,
      key: `item-${String(index)}`,
    }));
    expect(
      shoppingDraftSchema.safeParse({ items: overMaxDraft, listLabelWarnings: [] }).success,
    ).toBe(false);
    expect(
      shoppingDraftSchema.safeParse({
        items: [validDraftItem],
        listLabelWarnings: [],
      }).success,
    ).toBe(true);
  });

  it("rejects reconcile approval key arrays over shoppingItemsMax (S6)", () => {
    const overMaxKeys = Array.from(
      { length: shoppingItemsMax + 1 },
      (_, index) => `key-${String(index)}`,
    );
    expect(
      reconcileShoppingListRequestSchema.safeParse({
        expectedListVersion: 1,
        sourceMenuId: menuId,
        sourceMenuVersion: 1,
        idempotencyKey,
        approval: {
          addKeys: overMaxKeys,
          replaceItemIds: [],
          removeItemIds: [],
        },
      }).success,
    ).toBe(false);
    expect(
      reconcileShoppingListRequestSchema.safeParse({
        expectedListVersion: 1,
        sourceMenuId: menuId,
        sourceMenuVersion: 1,
        idempotencyKey,
        approval: {
          addKeys: ["にんじん|本"],
          replaceItemIds: [],
          removeItemIds: [],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects nested sourceIngredients over shoppingSourceIngredientsMax (S8)", () => {
    const source = validDraftItem.sourceIngredients[0];
    const overMax = Array.from({ length: shoppingSourceIngredientsMax + 1 }, (_, index) => ({
      ...source,
      ingredientId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(
      shoppingDraftItemSchema.safeParse({ ...validDraftItem, sourceIngredients: overMax }).success,
    ).toBe(false);
    expect(
      shoppingDraftItemSchema.safeParse({
        ...validDraftItem,
        sourceIngredients: overMax.slice(0, shoppingSourceIngredientsMax),
      }).success,
    ).toBe(true);
  });

  it("rejects per-item labelWarnings over shoppingItemLabelWarningsMax (S8)", () => {
    const warning = {
      confirmationId: null,
      warningKey: "a".repeat(64),
      sourceMenuId: menuId,
      sourceDerivationGroupId: listId,
      sourceType: "ingredient" as const,
      sourceId: itemId,
      sourcePath: "dishes.0.ingredients.0.name",
      allergenId: "egg",
      allergenDisplayName: "卵",
      anonymousMemberRef: "member_1",
      memberDisplayName: "本人",
      sourceDisplayName: "マヨネーズ",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending" as const,
    };
    const overMax = Array.from({ length: shoppingItemLabelWarningsMax + 1 }, () => warning);
    expect(
      shoppingDraftItemSchema.safeParse({ ...validDraftItem, labelWarnings: overMax }).success,
    ).toBe(false);
    expect(shoppingItemSchema.safeParse({ ...validItem, labelWarnings: overMax }).success).toBe(
      false,
    );
    const atMax = overMax.slice(0, shoppingItemLabelWarningsMax);
    expect(
      shoppingDraftItemSchema.safeParse({ ...validDraftItem, labelWarnings: atMax }).success,
    ).toBe(true);
    expect(shoppingItemSchema.safeParse({ ...validItem, labelWarnings: atMax }).success).toBe(true);
  });
});
