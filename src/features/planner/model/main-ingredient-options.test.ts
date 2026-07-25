import { describe, expect, it } from "vitest";
import {
  excludeCanonicalMainIngredient,
  includesCanonicalMainIngredient,
  normalizeMainIngredient,
} from "./main-ingredient-options";

describe("normalizeMainIngredient", () => {
  it("applies NFKC and trims ASCII/full-width spaces", () => {
    expect(normalizeMainIngredient("ｶﾚｰ")).toBe("カレー");
    expect(normalizeMainIngredient(" ㌔ ")).toBe("キロ");
    expect(normalizeMainIngredient("　鶏肉　")).toBe("鶏肉");
  });

  it("normalizes empty and whitespace-only values to empty string without length limits", () => {
    expect(normalizeMainIngredient("")).toBe("");
    expect(normalizeMainIngredient("   ")).toBe("");
    expect(normalizeMainIngredient("　　")).toBe("");
    // helper 自体は 80 code points 上限を課さない（UI 側が Array.from で判定する）
    expect(normalizeMainIngredient("あ".repeat(81))).toBe("あ".repeat(81));
  });
});

describe("includesCanonicalMainIngredient", () => {
  it.each([
    ["ｶﾚｰ", "カレー"],
    [" ㌔ ", "キロ"],
    ["　鶏肉　", "鶏肉"],
  ])("treats %s and %s as canonical matches", (saved, candidate) => {
    expect(includesCanonicalMainIngredient([saved], candidate)).toBe(true);
    expect(includesCanonicalMainIngredient([candidate], saved)).toBe(true);
  });

  it("does not treat distinct ingredients as matches", () => {
    expect(includesCanonicalMainIngredient(["鮭"], "さば")).toBe(false);
    expect(includesCanonicalMainIngredient(["鶏肉"], "豚肉")).toBe(false);
  });
});

describe("excludeCanonicalMainIngredient", () => {
  it("removes only elements that match after normalization", () => {
    expect(excludeCanonicalMainIngredient([" 鶏肉 ", "豚肉"], "鶏肉")).toEqual(["豚肉"]);
    expect(excludeCanonicalMainIngredient(["ｶﾚｰ", "鮭"], "カレー")).toEqual(["鮭"]);
  });

  it("does not mutate the original array", () => {
    const original = [" 鶏肉 ", "豚肉"] as const;
    const snapshot = [...original];
    const result = excludeCanonicalMainIngredient(original, "鶏肉");
    expect(result).toEqual(["豚肉"]);
    expect(original).toEqual(snapshot);
    expect(result).not.toBe(original);
  });

  it("removes every element that matches the candidate canonically", () => {
    expect(excludeCanonicalMainIngredient(["鶏肉", " 鶏肉 ", "豚肉", "鶏肉"], "鶏肉")).toEqual([
      "豚肉",
    ]);
  });
});
