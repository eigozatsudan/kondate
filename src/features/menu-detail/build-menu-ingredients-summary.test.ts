import { describe, expect, it } from "vitest";
import type { ValidatedMenu } from "@shared/contracts/generation";
import { buildMenuIngredientsSummary } from "./build-menu-ingredients-summary";

type Dish = ValidatedMenu["dishes"][number];
type Ingredient = Dish["ingredients"][number];

const ing = (overrides: Partial<Ingredient> & Pick<Ingredient, "id" | "name">): Ingredient => ({
  position: 1,
  quantityValue: 1,
  quantityText: "1",
  unit: "個",
  storeSection: "produce",
  pantrySelectionId: null,
  labelConfirmationRequired: false,
  ...overrides,
});

const dish = (
  overrides: Partial<Dish> & Pick<Dish, "id" | "name" | "ingredients">,
): Dish => ({
  role: "main",
  position: 1,
  description: "説明",
  cookingTimeMinutes: 10,
  steps: [
    {
      id: "51000000-0000-4000-8000-000000000099",
      position: 1,
      instruction: "作る",
    },
  ],
  ...overrides,
});

describe("buildMenuIngredientsSummary", () => {
  it("sums same normalized name and unit across dishes", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        position: 1,
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "玉ねぎ",
            quantityValue: 1,
            quantityText: "1個",
            unit: "個",
            storeSection: "produce",
          }),
        ],
      }),
      dish({
        id: "50000000-0000-4000-8000-000000000002",
        name: "B",
        position: 2,
        role: "side",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "玉ねぎ",
            quantityValue: 0.5,
            quantityText: "1/2個",
            unit: "個",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.storeSection).toBe("produce");
    expect(sections[0]?.lines).toHaveLength(1);
    expect(sections[0]?.lines[0]).toMatchObject({
      displayName: "玉ねぎ",
      quantityValue: 1.5,
      quantityText: "1.5個",
      unit: "個",
    });
  });

  it("merges gram synonyms (g and グラム)", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "小麦粉",
            quantityValue: 50,
            quantityText: "50g",
            unit: "g",
            storeSection: "dry_goods",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "小麦粉",
            position: 2,
            quantityValue: 30,
            quantityText: "30グラム",
            unit: "グラム",
            storeSection: "dry_goods",
          }),
        ],
      }),
    ]);
    const dry = sections.find((s) => s.storeSection === "dry_goods");
    expect(dry?.lines).toHaveLength(1);
    expect(dry?.lines[0]).toMatchObject({
      quantityValue: 80,
      quantityText: "80g",
      unit: "g",
    });
  });

  it("sums unregistered units by string identity after normalizeUnit (本)", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "にんじん",
            position: 2,
            quantityValue: 2,
            quantityText: "2本",
            unit: "本",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]).toMatchObject({
      quantityValue: 3,
      quantityText: "3本",
      unit: "本",
    });
  });

  it("keeps different units as separate lines", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "牛乳",
            quantityValue: 100,
            quantityText: "100ml",
            unit: "ml",
            storeSection: "dairy_eggs",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "牛乳",
            position: 2,
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "dairy_eggs",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines).toHaveLength(2);
  });

  it("collapses identical non-numeric rows (塩 少々 x3 → 1 line)", () => {
    const salt = (id: string, dishId: string, position: number) =>
      dish({
        id: dishId,
        name: `D${String(position)}`,
        position,
        role: position === 1 ? "main" : "side",
        ingredients: [
          ing({
            id,
            name: "塩",
            quantityValue: null,
            quantityText: "少々",
            unit: null,
            storeSection: "seasonings",
          }),
        ],
      });
    const sections = buildMenuIngredientsSummary([
      salt(
        "53000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        1,
      ),
      salt(
        "53000000-0000-4000-8000-000000000002",
        "50000000-0000-4000-8000-000000000002",
        2,
      ),
      salt(
        "53000000-0000-4000-8000-000000000003",
        "50000000-0000-4000-8000-000000000003",
        3,
      ),
    ]);
    const seasonings = sections.find((s) => s.storeSection === "seasonings");
    expect(seasonings?.lines).toHaveLength(1);
    expect(seasonings?.lines[0]).toMatchObject({
      displayName: "塩",
      quantityValue: null,
      quantityText: "少々",
      unit: null,
    });
  });

  it("does not collapse non-numeric rows with different quantityText", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "塩",
            quantityValue: null,
            quantityText: "少々",
            unit: null,
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "塩",
            position: 2,
            quantityValue: null,
            quantityText: "適量",
            unit: null,
            storeSection: "seasonings",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines).toHaveLength(2);
  });

  it("orders sections by storeSections definition and lines by first appearance", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "しょうゆ",
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "にんじん",
            position: 2,
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce",
          }),
        ],
      }),
    ]);
    expect(sections.map((s) => s.storeSection)).toEqual(["produce", "seasonings"]);
    expect(sections[0]?.lines[0]?.displayName).toBe("にんじん");
  });

  it("ORs labelConfirmationRequired within a group", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "しょうゆ",
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
            labelConfirmationRequired: false,
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "しょうゆ",
            position: 2,
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
            labelConfirmationRequired: true,
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]?.labelConfirmationRequired).toBe(true);
  });

  it("avoids floating-point noise when summing fractions", () => {
    const sections = buildMenuIngredientsSummary([
      dish({
        id: "50000000-0000-4000-8000-000000000001",
        name: "A",
        ingredients: [
          ing({
            id: "53000000-0000-4000-8000-000000000001",
            name: "みりん",
            quantityValue: 0.1,
            quantityText: "0.1大さじ",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
          ing({
            id: "53000000-0000-4000-8000-000000000002",
            name: "みりん",
            position: 2,
            quantityValue: 0.2,
            quantityText: "0.2大さじ",
            unit: "大さじ",
            storeSection: "seasonings",
          }),
        ],
      }),
    ]);
    expect(sections[0]?.lines[0]?.quantityValue).toBe(0.3);
    expect(sections[0]?.lines[0]?.quantityText).toBe("0.3大さじ");
  });
});
