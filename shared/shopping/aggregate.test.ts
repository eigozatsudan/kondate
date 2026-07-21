import { describe, expect, it } from "vitest";
import { buildShoppingDraft } from "./aggregate.js";
import { reviewedShoppingAliases } from "./reviewed-aliases.js";

const ingredient = (
  overrides: Partial<{
    ingredientId: string;
    dishId: string;
    dishName: string;
    name: string;
    quantityValue: number | null;
    quantityText: string;
    unit: string | null;
    storeSection: "produce" | "meat_fish" | "dairy_eggs" | "dry_goods" | "seasonings" | "other";
  }> = {},
) => ({
  ingredientId: "10000000-0000-4000-8000-000000000001",
  dishId: "10000000-0000-4000-8000-000000000002",
  dishName: "料理",
  name: "にんじん",
  quantityValue: 1,
  quantityText: "1本",
  unit: "本",
  storeSection: "produce" as const,
  ...overrides,
});

describe("buildShoppingDraft", () => {
  it("combines only numeric same-name same-unit rows and subtracts known pantry", () => {
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [
        ingredient(),
        ingredient({
          ingredientId: "10000000-0000-4000-8000-000000000003",
          name: "人参",
          quantityValue: 2,
          quantityText: "2本",
        }),
      ],
      pantry: [{ name: "にんじん", quantity: 1, unit: "本" }],
      aliases: new Map([["人参", "にんじん"]]),
      labels: [],
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      normalizedName: "にんじん",
      quantityValue: 2,
      quantityText: "2本",
      unit: "本",
      storeSection: "produce",
      pantryCheckRequired: false,
    });
  });

  it("keeps ambiguous quantities and different units separate", () => {
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [
        ingredient({
          quantityValue: null,
          quantityText: "少々",
          unit: null,
          storeSection: "seasonings",
        }),
        ingredient({
          ingredientId: "10000000-0000-4000-8000-000000000004",
          quantityValue: null,
          quantityText: "適量",
          unit: null,
          storeSection: "seasonings",
        }),
      ],
      pantry: [],
      aliases: new Map(),
      labels: [],
    });
    expect(draft.items.map((item) => item.quantityText)).toEqual(["少々", "適量"]);
    expect(draft.items.every((item) => item.storeSection === "seasonings")).toBe(true);
  });

  it("retains quantity when matching pantry quantity is unknown and snapshots labels", () => {
    const source = ingredient();
    const draft = buildShoppingDraft({
      menuId: "10000000-0000-4000-8000-000000000010",
      menuVersion: 1,
      ingredients: [source],
      pantry: [{ name: "にんじん", quantity: null, unit: null }],
      aliases: new Map(),
      labels: [
        {
          confirmationId: "10000000-0000-4000-8000-000000000020",
          warningKey: "a".repeat(64),
          sourceMenuId: "10000000-0000-4000-8000-000000000010",
          sourceDerivationGroupId: "10000000-0000-4000-8000-000000000011",
          sourceType: "ingredient",
          sourceId: source.ingredientId,
          sourcePath: "dishes.0.ingredients.0",
          allergenId: "soy",
          allergenDisplayName: "大豆",
          anonymousMemberRef: "member_1",
          memberDisplayName: "家族1",
          sourceDisplayName: "にんじん",
          dictionaryVersion: "allergen-v1",
          confirmationStatus: "pending",
        },
      ],
    });
    expect(draft.items[0]).toMatchObject({ quantityValue: 1, pantryCheckRequired: true });
    expect(draft.items[0]?.labelWarnings).toHaveLength(1);
  });

  it("matches pantry by reviewed name first and requires a check for unknown or mismatched units", () => {
    const draft = buildShoppingDraft({
      menuId: crypto.randomUUID(),
      menuVersion: 1,
      ingredients: [
        ingredient({ name: "人参", quantityValue: 2, unit: "本", quantityText: "2本" }),
      ],
      pantry: [{ name: "にんじん", quantity: 1, unit: null }],
      aliases: reviewedShoppingAliases,
      labels: [],
    });
    expect(draft.items[0]).toMatchObject({ quantityValue: 2, pantryCheckRequired: true });
  });

  it("resets confirmed menu labels to human-readable shopping pending warnings", () => {
    const source = ingredient();
    const confirmed = {
      confirmationId: crypto.randomUUID(),
      warningKey: "b".repeat(64),
      sourceMenuId: crypto.randomUUID(),
      sourceDerivationGroupId: crypto.randomUUID(),
      sourceType: "ingredient" as const,
      sourceId: source.ingredientId,
      sourcePath: "dishes.0.ingredients.0.name",
      allergenId: "wheat",
      allergenDisplayName: "小麦",
      anonymousMemberRef: "member_1",
      memberDisplayName: "子ども",
      sourceDisplayName: "カレールー",
      dictionaryVersion: "allergen-v1",
      confirmationStatus: "confirmed" as const,
    };
    const draft = buildShoppingDraft({
      menuId: crypto.randomUUID(),
      menuVersion: 1,
      ingredients: [source],
      pantry: [],
      aliases: new Map(),
      labels: [confirmed],
    });
    expect(draft.items[0]?.labelWarnings[0]).toMatchObject({
      confirmationStatus: "pending",
      sourceDisplayName: "カレールー",
      allergenDisplayName: "小麦",
      memberDisplayName: "子ども",
    });
  });
});
