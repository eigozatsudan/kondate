import { describe, expect, it } from "vitest";
import type { ShoppingDiff } from "../contracts/shopping.js";
import {
  canonicalizePreviewedQuantities,
  previewedQuantitiesEqual,
  previewedQuantitiesMatchDiff,
  snapshotPreviewedQuantities,
} from "./previewed-quantities.js";

const itemId = "10000000-0000-4000-8000-000000000021";

function makeAdd(
  overrides: Partial<ShoppingDiff["add"][number]> = {},
): ShoppingDiff["add"][number] {
  return {
    key: "carrot-add",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    pantryCheckRequired: false,
    sourceIngredients: [
      {
        ingredientId: "10000000-0000-4000-8000-000000000001",
        dishId: "10000000-0000-4000-8000-000000000002",
        dishName: "サラダ",
        name: "にんじん",
        quantityValue: 3,
        quantityText: "3本",
        unit: "本",
        storeSection: "produce",
      },
    ],
    labelWarnings: [],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<ShoppingDiff> = {}): ShoppingDiff {
  return {
    add: [makeAdd()],
    replace: [
      {
        itemId,
        current: {
          displayName: "じゃがいも",
          quantityText: "1個",
          storeSection: "produce",
        },
        next: {
          ...makeAdd({
            key: "potato-replace",
            displayName: "じゃがいも",
            normalizedName: "じゃがいも",
            quantityValue: 2,
            quantityText: "2個",
            unit: "個",
          }),
        },
      },
    ],
    remove: [],
    protectedItemIds: [],
    listLabelWarnings: [],
    ...overrides,
  };
}

describe("snapshotPreviewedQuantities", () => {
  it("copies add keys and replace next quantities from the preview diff", () => {
    expect(snapshotPreviewedQuantities(makeDiff())).toEqual({
      add: [{ key: "carrot-add", quantityValue: 1, quantityText: "1本" }],
      replace: [{ itemId, quantityValue: 2, quantityText: "2個" }],
    });
  });
});

describe("previewedQuantitiesMatchDiff", () => {
  it("accepts the snapshot taken from the same diff", () => {
    const diff = makeDiff();
    expect(previewedQuantitiesMatchDiff(snapshotPreviewedQuantities(diff), diff)).toBe(true);
  });

  it("rejects the same add key when the recomputed quantity drifted", () => {
    const preview = makeDiff();
    const snapshot = snapshotPreviewedQuantities(preview);
    const drifted: ShoppingDiff = {
      ...preview,
      add: [makeAdd({ quantityValue: 3, quantityText: "3本" })],
    };
    expect(previewedQuantitiesMatchDiff(snapshot, drifted)).toBe(false);
  });

  it("rejects when an add key appears or disappears after preview", () => {
    const preview = makeDiff({ replace: [] });
    const snapshot = snapshotPreviewedQuantities(preview);
    expect(
      previewedQuantitiesMatchDiff(snapshot, {
        ...preview,
        add: [makeAdd(), makeAdd({ key: "extra-add", displayName: "玉ねぎ" })],
      }),
    ).toBe(false);
    expect(previewedQuantitiesMatchDiff(snapshot, { ...preview, add: [] })).toBe(false);
  });
});

describe("canonicalizePreviewedQuantities", () => {
  it("sorts add keys and replace item ids so the same set hashes equal", () => {
    const left = canonicalizePreviewedQuantities({
      add: [
        { key: "b", quantityValue: 2, quantityText: "2個" },
        { key: "a", quantityValue: 1, quantityText: "1本" },
      ],
      replace: [
        { itemId: "20000000-0000-4000-8000-000000000002", quantityValue: 4, quantityText: "4個" },
        { itemId: "10000000-0000-4000-8000-000000000001", quantityValue: 3, quantityText: "3本" },
      ],
    });
    const right = canonicalizePreviewedQuantities({
      add: [
        { key: "a", quantityValue: 1, quantityText: "1本" },
        { key: "b", quantityValue: 2, quantityText: "2個" },
      ],
      replace: [
        { itemId: "10000000-0000-4000-8000-000000000001", quantityValue: 3, quantityText: "3本" },
        { itemId: "20000000-0000-4000-8000-000000000002", quantityValue: 4, quantityText: "4個" },
      ],
    });
    expect(left).toEqual(right);
    expect(previewedQuantitiesEqual(left, right)).toBe(true);
  });
});
