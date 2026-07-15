import { describe, expect, it } from "vitest";
import { pantryItemInputSchema, pantrySelectionDraftSchema, pantryUsageSchema } from "./pantry.js";

describe("pantry contracts", () => {
  it("requires positive paired quantity and unit", () => {
    expect(
      pantryItemInputSchema.safeParse({
        name: "にんじん",
        quantity: -1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
    expect(
      pantryItemInputSchema.safeParse({
        name: "にんじん",
        quantity: 2,
        unit: null,
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });

  it("canonicalizes ECMAScript padding and counts Unicode code points", () => {
    expect(
      pantryItemInputSchema.parse({
        name: "\u00a0🍳\ufeff",
        quantity: 1.234,
        unit: "\ufeff個\u00a0",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }),
    ).toMatchObject({ name: "🍳", quantity: 1.234, unit: "個" });
    expect(
      pantryItemInputSchema.safeParse({
        name: "🍳".repeat(81),
        quantity: null,
        unit: null,
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });

  it("rejects quantity with more than three decimal places", () => {
    expect(
      pantryItemInputSchema.safeParse({
        name: "牛乳",
        quantity: 1.2345,
        unit: "ml",
        expiresOn: null,
        expirationType: null,
        openedState: null,
      }).success,
    ).toBe(false);
  });

  it("does not accept expiry confirmation in a persisted selection", () => {
    expect(
      pantrySelectionDraftSchema.safeParse({
        pantryItemId: "20000000-0000-4000-8000-000000000001",
        priority: "must_use",
        checkedAt: "2026-07-11T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("requires an unused reason and exact shortage arithmetic", () => {
    expect(
      pantryUsageSchema.safeParse({
        selectionId: "21000000-0000-4000-8000-000000000001",
        pantryItemId: null,
        pantryItemName: "にんじん",
        priority: "prefer_use",
        usageStatus: "unused",
        plannedQuantity: null,
        inventoryQuantity: null,
        shortageQuantity: null,
        unit: null,
        dishIds: [],
        unusedReason: null,
      }).success,
    ).toBe(false);
    expect(
      pantryUsageSchema.safeParse({
        selectionId: "21000000-0000-4000-8000-000000000001",
        pantryItemId: null,
        pantryItemName: "にんじん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 3,
        inventoryQuantity: 2,
        shortageQuantity: 0,
        unit: "本",
        dishIds: ["22000000-0000-4000-8000-000000000001"],
        unusedReason: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a shortage with more than three decimal places or incorrect integer-unit arithmetic", () => {
    const usage = {
      selectionId: "21000000-0000-4000-8000-000000000001",
      pantryItemId: null,
      pantryItemName: "にんじん",
      priority: "must_use",
      usageStatus: "used",
      plannedQuantity: 3,
      inventoryQuantity: 2,
      unit: "本",
      dishIds: ["22000000-0000-4000-8000-000000000001"],
      unusedReason: null,
    } as const;

    expect(pantryUsageSchema.safeParse({ ...usage, shortageQuantity: 0.99995 }).success).toBe(
      false,
    );
    expect(pantryUsageSchema.safeParse({ ...usage, shortageQuantity: 0.999 }).success).toBe(false);
  });

  it("requires a unit exactly when at least one usage quantity exists", () => {
    const usage = {
      selectionId: "21000000-0000-4000-8000-000000000001",
      pantryItemId: null,
      pantryItemName: "にんじん",
      priority: "prefer_use",
      usageStatus: "used",
      dishIds: ["22000000-0000-4000-8000-000000000001"],
      unusedReason: null,
    } as const;

    expect(
      pantryUsageSchema.safeParse({
        ...usage,
        plannedQuantity: 1,
        inventoryQuantity: 1,
        shortageQuantity: 0,
        unit: null,
      }).success,
    ).toBe(false);
    expect(
      pantryUsageSchema.safeParse({
        ...usage,
        plannedQuantity: null,
        inventoryQuantity: null,
        shortageQuantity: null,
        unit: "本",
      }).success,
    ).toBe(false);
  });
});
