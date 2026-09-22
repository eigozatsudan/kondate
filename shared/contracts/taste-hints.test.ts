import { describe, expect, it } from "vitest";
import {
  TASTE_HALF_LIFE_DAYS,
  TASTE_LIKED_DISHES_MAX,
  TASTE_STRENGTH_MEDIUM_MIN,
  TASTE_STRENGTH_STRONG_MIN,
  TASTE_WINDOW_DAYS,
  TASTE_WINDOW_MENUS,
  hasTasteContent,
  tasteHintsSchema,
  tasteHintsRecordSchema,
  tasteSignalsSchema,
  type TasteHints,
} from "./taste-hints.js";

const empty: TasteHints = {
  likedDishes: [],
  likedGenres: [],
  likedIngredients: [],
  likedTimeBand: null,
  overusedIngredients: [],
  avoidAxes: [],
  signalStrength: "strong",
};

describe("taste-hints contract", () => {
  it("locks the window, half-life, and strength boundaries", () => {
    expect(TASTE_WINDOW_DAYS).toBe(90);
    expect(TASTE_WINDOW_MENUS).toBe(50);
    expect(TASTE_HALF_LIFE_DAYS).toBe(30);
    expect(TASTE_STRENGTH_MEDIUM_MIN).toBe(5);
    expect(TASTE_STRENGTH_STRONG_MIN).toBe(15);
    expect(TASTE_LIKED_DISHES_MAX).toBe(12);
  });

  it("rejects unknown keys and over-long arrays", () => {
    expect(tasteHintsSchema.safeParse({ ...empty, extra: 1 }).success).toBe(false);
    expect(
      tasteHintsSchema.safeParse({
        ...empty,
        likedDishes: Array.from({ length: 13 }, (_, index) => ({ dishName: `d${String(index)}` })),
      }).success,
    ).toBe(false);
  });

  it("accepts the signals shape with the index but not the hints shape", () => {
    const signals = {
      ...empty,
      dishIngredientIndex: [{ dishName: "肉じゃが", ingredients: ["牛肉"] }],
    };
    expect(tasteSignalsSchema.safeParse(signals).success).toBe(true);
    expect(tasteHintsSchema.safeParse(signals).success).toBe(false);
  });

  it("treats strength alone as no content", () => {
    expect(hasTasteContent(empty)).toBe(false);
    expect(hasTasteContent({ ...empty, likedTimeBand: "standard" })).toBe(true);
    expect(hasTasteContent({ ...empty, likedDishes: [{ dishName: "肉じゃが" }] })).toBe(true);
    expect(hasTasteContent({ ...empty, avoidAxes: ["child_unfriendly"] })).toBe(true);
  });

  it("records only applied:true with a strength", () => {
    expect(tasteHintsRecordSchema.safeParse({ applied: true, strength: "medium" }).success).toBe(
      true,
    );
    expect(tasteHintsRecordSchema.safeParse({ applied: false, strength: "medium" }).success).toBe(
      false,
    );
  });
});
