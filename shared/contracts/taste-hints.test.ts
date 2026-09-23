import { describe, expect, it } from "vitest";
import {
  TASTE_AVOID_AXIS_MIN_COUNT,
  TASTE_FAVORITE_WEIGHT,
  TASTE_GENRE_MIN_SHARE,
  TASTE_HALF_LIFE_DAYS,
  TASTE_LIKED_DISHES_MAX,
  TASTE_LIKED_DISHES_QUERY_MAX,
  TASTE_LIKED_GENRES_MAX,
  TASTE_LIKED_INGREDIENTS_MAX,
  TASTE_LIKED_INGREDIENT_MIN_COUNT,
  TASTE_OVERUSED_INGREDIENTS_MAX,
  TASTE_OVERUSED_INGREDIENT_MIN_COUNT,
  TASTE_SELECTED_WEIGHT,
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

  it("lets the signals shape carry up to 24 liked dishes while hints stay at 12", () => {
    // SQL は最近の料理を落とす前の候補として 24 件返し、Function が落とした後に 12 件へ切る
    expect(TASTE_LIKED_DISHES_QUERY_MAX).toBe(24);
    const dishes = (length: number) =>
      Array.from({ length }, (_, index) => ({ dishName: `d${String(index)}` }));
    const signalsWith = (length: number) => ({
      ...empty,
      likedDishes: dishes(length),
      dishIngredientIndex: [],
    });
    expect(tasteSignalsSchema.safeParse(signalsWith(24)).success).toBe(true);
    expect(tasteSignalsSchema.safeParse(signalsWith(25)).success).toBe(false);
    expect(tasteHintsSchema.safeParse({ ...empty, likedDishes: dishes(12) }).success).toBe(true);
    expect(tasteHintsSchema.safeParse({ ...empty, likedDishes: dishes(13) }).success).toBe(false);
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

  // SQL 側はリテラルで持つ。ここで値を固定しないと片側だけの変更に気づけない
  it("locks the weights, minimum counts, share, and caps mirrored in SQL", () => {
    expect(TASTE_FAVORITE_WEIGHT).toBe(1.0);
    expect(TASTE_SELECTED_WEIGHT).toBe(0.3);
    expect(TASTE_LIKED_INGREDIENT_MIN_COUNT).toBe(2);
    expect(TASTE_OVERUSED_INGREDIENT_MIN_COUNT).toBe(3);
    expect(TASTE_AVOID_AXIS_MIN_COUNT).toBe(2);
    expect(TASTE_GENRE_MIN_SHARE).toBe(0.35);
    expect(TASTE_LIKED_GENRES_MAX).toBe(2);
    expect(TASTE_LIKED_INGREDIENTS_MAX).toBe(8);
    expect(TASTE_OVERUSED_INGREDIENTS_MAX).toBe(3);
  });

  it("rejects each array one past its cap", () => {
    const names = (count: number) =>
      Array.from({ length: count }, (_, index) => `n${String(index)}`);
    expect(tasteHintsSchema.safeParse({ ...empty, likedIngredients: names(8) }).success).toBe(true);
    expect(tasteHintsSchema.safeParse({ ...empty, likedIngredients: names(9) }).success).toBe(
      false,
    );
    expect(tasteHintsSchema.safeParse({ ...empty, overusedIngredients: names(3) }).success).toBe(
      true,
    );
    expect(tasteHintsSchema.safeParse({ ...empty, overusedIngredients: names(4) }).success).toBe(
      false,
    );
    expect(
      tasteHintsSchema.safeParse({ ...empty, likedGenres: ["japanese", "western", "chinese"] })
        .success,
    ).toBe(false);
    expect(
      tasteHintsSchema.safeParse({ ...empty, avoidAxes: ["child_unfriendly", "child_unfriendly"] })
        .success,
    ).toBe(false);
  });

  it("never reports a generated any as a liked genre", () => {
    expect(tasteHintsSchema.safeParse({ ...empty, likedGenres: ["any"] }).success).toBe(false);
  });

  // DB は char_length(btrim(name)) で 1〜100、planner も code point で数える。
  // UTF-16 で数えると絵文字の多い 1 語で parse 全体が落ち、学習が黙って止まる
  it("counts food names in code points like the database", () => {
    const tomatoes = (count: number) => "🍅".repeat(count);
    expect(
      tasteHintsSchema.safeParse({ ...empty, overusedIngredients: [tomatoes(100)] }).success,
    ).toBe(true);
    expect(
      tasteHintsSchema.safeParse({ ...empty, overusedIngredients: [tomatoes(101)] }).success,
    ).toBe(false);
    expect(tasteHintsSchema.safeParse({ ...empty, likedIngredients: ["   "] }).success).toBe(false);
    expect(
      tasteHintsSchema.safeParse({ ...empty, likedIngredients: [` ${"あ".repeat(100)} `] }).success,
    ).toBe(true);
  });

  it("records only applied:true with a strength", () => {
    expect(tasteHintsRecordSchema.safeParse({ applied: true, strength: "medium" }).success).toBe(
      true,
    );
    expect(tasteHintsRecordSchema.safeParse({ applied: false, strength: "medium" }).success).toBe(
      false,
    );
    expect(
      tasteHintsRecordSchema.safeParse({ applied: true, strength: "medium", likedDishes: [] })
        .success,
    ).toBe(false);
  });
});
