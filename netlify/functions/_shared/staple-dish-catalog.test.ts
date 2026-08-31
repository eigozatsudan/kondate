import { describe, expect, it } from "vitest";
import { lookupStapleDishes, STAPLE_DISH_CATALOG } from "./staple-dish-catalog.js";

describe("lookupStapleDishes", () => {
  it("returns staple dishes for a known ingredient", () => {
    expect(lookupStapleDishes(["豚肉"], 12)).toContain("豚の生姜焼き");
  });

  it("matches katakana and hiragana spellings of the same alias", () => {
    // normalizeFoodText はカタカナ→ひらがなを畳む
    expect(lookupStapleDishes(["ブタニク"], 12)).toEqual(lookupStapleDishes(["ぶたにく"], 12));
  });

  it("does not fold kanji into kana, so both spellings are listed as aliases", () => {
    // normalizeFoodText は漢字を畳まない。豚肉 と ぶた肉 は alias 列挙でのみ一致する
    expect(lookupStapleDishes(["ぶた肉"], 12)).toContain("豚の生姜焼き");
  });

  it("returns an empty list for an ingredient outside the catalog", () => {
    expect(lookupStapleDishes(["ドラゴンフルーツ"], 12)).toEqual([]);
  });

  it("caps the result at max", () => {
    expect(lookupStapleDishes(["豚肉", "鶏肉", "牛肉", "卵"], 3)).toHaveLength(3);
  });

  it("does not repeat a dish name across ingredients", () => {
    const dishes = lookupStapleDishes(["豚肉", "ぶた肉"], 12);
    expect(new Set(dishes).size).toBe(dishes.length);
  });

  it("lists both kanji and kana aliases for every entry", () => {
    for (const entry of STAPLE_DISH_CATALOG) {
      expect(entry.ingredientAliases.length).toBeGreaterThan(1);
      expect(entry.stapleDishes.length).toBeGreaterThan(0);
    }
  });
});
