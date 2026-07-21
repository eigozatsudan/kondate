import { expect, it } from "vitest";
import { computeShoppingDiff, resolveApprovedDiff } from "./diff.js";
import type { ShoppingDraft, ShoppingLabelSnapshot, ShoppingList } from "../contracts/shopping.js";

it("does not propose checked, manual, edited, or removed rows", () => {
  const current = makeShoppingList([
    makeItem({ id: "10000000-0000-4000-8000-000000000001", isChecked: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000002", isManual: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000003", isManuallyEdited: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000004", isRemovedByUser: true }),
  ]);
  const diff = computeShoppingDiff(current, { items: [], listLabelWarnings: [] });
  expect(diff.remove.map((operation) => operation.itemId)).toEqual([]);
  expect(diff.protectedItemIds).toHaveLength(4);
});

it("matches repeated ambiguous rows one-to-one without dropping warnings", () => {
  const first = {
    ...makeDraft().items[0]!,
    key: "salt-small",
    displayName: "塩",
    normalizedName: "塩",
    storeSection: "seasonings" as const,
    quantityValue: null,
    quantityText: "少々",
    unit: null,
    labelWarnings: [makeShoppingWarning({ sourceDisplayName: "塩 少々" })],
  };
  const second = {
    ...first,
    key: "salt-as-needed",
    quantityText: "適量",
    labelWarnings: [makeShoppingWarning({ sourceDisplayName: "塩 適量" })],
  };
  const diff = computeShoppingDiff(makeShoppingList([]), {
    items: [first, second],
    listLabelWarnings: [],
  });
  expect(
    diff.add.map((item) => [item.key, item.quantityText, item.labelWarnings[0]?.sourceDisplayName]),
  ).toEqual([
    ["salt-small", "少々", "塩 少々"],
    ["salt-as-needed", "適量", "塩 適量"],
  ]);
});

it("resolves only operation IDs contained in the server diff", () => {
  const diff = computeShoppingDiff(makeShoppingList([]), makeDraft());
  expect(() =>
    resolveApprovedDiff(diff, {
      addKeys: ["client-invented"],
      replaceItemIds: [],
      removeItemIds: [],
    }),
  ).toThrow("approved_diff_mismatch");
});

it("preserves a checked derived row and proposes only its positive required delta", () => {
  const current = makeShoppingList([
    makeItem({
      id: crypto.randomUUID(),
      quantityValue: 1,
      quantityText: "1本",
      unit: "本",
      isChecked: true,
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.protectedItemIds).toEqual([current.items[0]!.id]);
  expect(diff.add[0]).toMatchObject({ quantityValue: 2, quantityText: "2本" });
  expect(diff.remove).toEqual([]);
});

it("keeps a removed row and proposes its larger known delta or unknown review item", () => {
  const removed = makeItem({
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    isRemovedByUser: true,
  });
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  expect(computeShoppingDiff(makeShoppingList([removed]), next).add[0]).toMatchObject({
    quantityValue: 2,
    quantityText: "2本",
  });
  next.items[0] = { ...next.items[0], quantityValue: null, quantityText: "適量", unit: null };
  expect(computeShoppingDiff(makeShoppingList([removed]), next).add[0]).toMatchObject({
    pantryCheckRequired: true,
  });
});

function makeItem(
  overrides: Partial<ShoppingList["items"][number]> = {},
): ShoppingList["items"][number] {
  return {
    id: crypto.randomUUID(),
    listId: "10000000-0000-4000-8000-000000000010",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    pantryCheckRequired: false,
    isChecked: false,
    isManual: false,
    isManuallyEdited: false,
    isRemovedByUser: false,
    labelWarnings: [],
    ...overrides,
  };
}
function makeShoppingWarning(
  overrides: Partial<ShoppingLabelSnapshot> = {},
): ShoppingLabelSnapshot {
  return {
    confirmationId: null,
    warningKey: "c".repeat(64),
    sourceMenuId: crypto.randomUUID(),
    sourceDerivationGroupId: crypto.randomUUID(),
    sourceType: "ingredient",
    sourceId: crypto.randomUUID(),
    sourcePath: "dishes.0.ingredients.0.name",
    allergenId: "wheat",
    allergenDisplayName: "小麦",
    anonymousMemberRef: "member_1",
    memberDisplayName: "子ども",
    sourceDisplayName: "材料",
    dictionaryVersion: "allergen-v1",
    confirmationStatus: "pending",
    ...overrides,
  };
}
function makeShoppingList(items: ShoppingList["items"]): ShoppingList {
  return {
    id: "10000000-0000-4000-8000-000000000010",
    status: "active",
    version: 1,
    items,
    listLabelWarnings: [],
  };
}
function makeDraft(): ShoppingDraft {
  return {
    items: [
      {
        key: "add-key",
        displayName: "牛乳",
        normalizedName: "牛乳",
        storeSection: "dairy_eggs",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        pantryCheckRequired: false,
        sourceIngredients: [],
        labelWarnings: [],
      },
    ],
    listLabelWarnings: [],
  };
}
