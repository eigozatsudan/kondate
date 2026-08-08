// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeIngredientQuantity } from "./quantity-display.js";

describe("normalizeIngredientQuantity", () => {
  it.each([
    {
      name: "15 tbsp oil -> 225ml",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: "大さじ" },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "30 tbsp milk -> 450ml",
      input: { quantityValue: 30, quantityText: "30大さじ", unit: "大さじ" },
      expected: { quantityValue: 450, quantityText: "450ml", unit: "ml" },
    },
    {
      name: "2 tbsp stays",
      input: { quantityValue: 2, quantityText: "2大さじ", unit: "大さじ" },
      expected: { quantityValue: 2, quantityText: "2大さじ", unit: "大さじ" },
    },
    {
      name: "boundary 3 tbsp stays",
      input: { quantityValue: 3, quantityText: "3大さじ", unit: "大さじ" },
      expected: { quantityValue: 3, quantityText: "3大さじ", unit: "大さじ" },
    },
    {
      name: "just over 3 tbsp converts",
      input: { quantityValue: 3.001, quantityText: "3.001大さじ", unit: "大さじ" },
      expected: { quantityValue: 45.015, quantityText: "45.015ml", unit: "ml" },
    },
    {
      name: "4 tsp -> 20ml",
      input: { quantityValue: 4, quantityText: "4小さじ", unit: "小さじ" },
      expected: { quantityValue: 20, quantityText: "20ml", unit: "ml" },
    },
    {
      name: "P2 parse text only 30大さじ",
      input: { quantityValue: null, quantityText: "30大さじ", unit: null },
      expected: { quantityValue: 450, quantityText: "450ml", unit: "ml" },
    },
    {
      name: "P2 parse 大さじ15 prefix",
      input: { quantityValue: null, quantityText: "大さじ15", unit: null },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "P2 value set unit null text spoon uses value",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: null },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      // M2-1: value 欠落でも unit がスプーンなら text から補完
      name: "P1b value null unit spoon text 15大さじ",
      input: { quantityValue: null, quantityText: "15大さじ", unit: "大さじ" },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "P1b value null unit spoon text 大さじ15 prefix",
      input: { quantityValue: null, quantityText: "大さじ15", unit: "大さじ" },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      name: "P1b unit spoon text other spoon type stays",
      input: { quantityValue: null, quantityText: "10小さじ", unit: "大さじ" },
      expected: { quantityValue: null, quantityText: "10小さじ", unit: "大さじ" },
    },
    {
      name: "non-spoon unit does not parse text spoon",
      input: { quantityValue: 15, quantityText: "15大さじ", unit: "g" },
      expected: { quantityValue: 15, quantityText: "15大さじ", unit: "g" },
    },
    {
      // value が非有限でも text 同種スプーンがあれば補完（M2-1 と同じ経路）
      name: "non-finite value recovers from spoon text",
      input: { quantityValue: Number.NaN, quantityText: "15大さじ", unit: "大さじ" },
      expected: { quantityValue: 225, quantityText: "225ml", unit: "ml" },
    },
    {
      // text も補完不能なら入力のまま（NaN は toEqual で一致）
      name: "non-finite value without parseable text stays",
      input: { quantityValue: Number.NaN, quantityText: "適量っぽい", unit: "大さじ" },
      expected: { quantityValue: Number.NaN, quantityText: "適量っぽい", unit: "大さじ" },
    },
    {
      name: "tsp boundary 3 stays",
      input: { quantityValue: 3, quantityText: "3小さじ", unit: "小さじ" },
      expected: { quantityValue: 3, quantityText: "3小さじ", unit: "小さじ" },
    },
    {
      name: "大匙 synonym converts",
      input: { quantityValue: 10, quantityText: "10大匙", unit: "大匙" },
      expected: { quantityValue: 150, quantityText: "150ml", unit: "ml" },
    },
    {
      name: "1少々 -> 少々",
      input: { quantityValue: 1, quantityText: "1少々", unit: "少々" },
      expected: { quantityValue: null, quantityText: "少々", unit: null },
    },
    {
      name: "text 適量 only",
      input: { quantityValue: null, quantityText: "適量", unit: null },
      expected: { quantityValue: null, quantityText: "適量", unit: null },
    },
    {
      name: "partial 少し多め untouched",
      input: { quantityValue: null, quantityText: "少し多め", unit: null },
      expected: { quantityValue: null, quantityText: "少し多め", unit: null },
    },
    {
      name: "english tbsp untouched",
      input: { quantityValue: 15, quantityText: "15tbsp", unit: "tbsp" },
      expected: { quantityValue: 15, quantityText: "15tbsp", unit: "tbsp" },
    },
    {
      name: "grams untouched",
      input: { quantityValue: 300, quantityText: "300g", unit: "g" },
      expected: { quantityValue: 300, quantityText: "300g", unit: "g" },
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(normalizeIngredientQuantity(input)).toEqual(expected);
  });

  it("prefers qualitative when text is bare 適量 even if unit is spoon", () => {
    expect(
      normalizeIngredientQuantity({
        quantityValue: 15,
        quantityText: "適量",
        unit: "大さじ",
      }),
    ).toEqual({ quantityValue: null, quantityText: "適量", unit: null });
  });

  it("rebuilds text from value+unit when spoon numeric wins over contradictory 適量 in middle", () => {
    // text が定性「のみ」でない場合は Step B（P1）
    expect(
      normalizeIngredientQuantity({
        quantityValue: 15,
        quantityText: "だいたい適量",
        unit: "大さじ",
      }),
    ).toEqual({ quantityValue: 225, quantityText: "225ml", unit: "ml" });
  });
});
