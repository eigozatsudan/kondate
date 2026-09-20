import { describe, expect, it } from "vitest";
import {
  createDishSignature,
  createMenuSignature,
  isMateriallySameDish,
  isMateriallySameMenu,
} from "./deduplicate.js";

describe("material duplicate helpers", () => {
  it("rejects dishes with the same role and materially same ingredients", () => {
    expect(
      isMateriallySameDish(
        {
          role: "main",
          name: "鶏肉と白菜の煮物",
          primaryIngredients: ["鶏もも肉", "白菜", "しょうゆ"],
        },
        {
          role: "main",
          name: "白菜と鶏肉の煮物",
          primaryIngredients: ["白菜", "鶏もも肉", "しょうゆ"],
        },
      ),
    ).toBe(true);
  });

  it("rejects a whole menu when every role is materially unchanged", () => {
    const first = {
      dishes: [
        {
          role: "main",
          name: "鶏肉と白菜の煮物",
          primaryIngredients: ["鶏もも肉", "白菜"],
        },
        {
          role: "side",
          name: "にんじんの和え物",
          primaryIngredients: ["にんじん"],
        },
      ],
    };
    const second = {
      dishes: [
        {
          role: "side",
          name: "人参の和え物",
          primaryIngredients: ["にんじん"],
        },
        {
          role: "main",
          name: "白菜と鶏肉の煮物",
          primaryIngredients: ["白菜", "鶏もも肉"],
        },
      ],
    };
    expect(isMateriallySameMenu(first, second)).toBe(true);
  });

  it("builds deterministic dish and menu signatures", () => {
    const left = createDishSignature({
      role: "main",
      name: "鶏肉と白菜の煮物",
      primaryIngredients: ["鶏もも肉", "白菜"],
    });
    const right = createDishSignature({
      role: "main",
      name: "鶏肉と白菜の煮物",
      primaryIngredients: ["白菜", "鶏もも肉"],
    });
    expect(left).toBe(right);

    // シグネチャは正規化名と材料集合の決定論的 JSON。同義表記の吸収は material-same 側の役割。
    const menu = createMenuSignature({
      dishes: [
        {
          role: "side",
          name: "にんじんの和え物",
          primaryIngredients: ["にんじん"],
        },
        {
          role: "main",
          name: "鶏肉と白菜の煮物",
          primaryIngredients: ["鶏もも肉", "白菜"],
        },
      ],
    });
    expect(menu).toBe(
      createMenuSignature({
        dishes: [
          {
            role: "main",
            name: "鶏肉と白菜の煮物",
            primaryIngredients: ["白菜", "鶏もも肉"],
          },
          {
            role: "side",
            name: "にんじんの和え物",
            primaryIngredients: ["にんじん"],
          },
        ],
      }),
    );
  });

  it("treats different roles as not the same dish", () => {
    expect(
      isMateriallySameDish(
        { role: "main", name: "同一名", primaryIngredients: ["卵"] },
        { role: "side", name: "同一名", primaryIngredients: ["卵"] },
      ),
    ).toBe(false);
  });

  it("matches same-role dishes one-to-one without reusing a counterpart", () => {
    const left = {
      dishes: [
        { role: "side", name: "A", primaryIngredients: ["にんじん"] },
        { role: "side", name: "A", primaryIngredients: ["にんじん"] },
      ],
    };
    const right = {
      dishes: [
        { role: "side", name: "A", primaryIngredients: ["にんじん"] },
        { role: "side", name: "B", primaryIngredients: ["大根"] },
      ],
    };
    // 左の 2 品目は右の "B" と実質同一ではない。候補を使い回すと誤って true になる。
    expect(isMateriallySameMenu(left, right)).toBe(false);
    expect(isMateriallySameMenu(right, left)).toBe(false);
  });

  it("finds a complete matching when greedy order would consume the only partner", () => {
    // left[0] は right 両方と実質同一（同名/0.8 重複）だが、
    // left[1] は right[0] にしか対応しない。貪欲で left[0]→right[0] を先に消費すると
    // 完全マッチング（left[0]→right[1], left[1]→right[0]）が存在するのに false になる。
    const left = {
      dishes: [
        {
          role: "main",
          name: "鶏の照り焼き",
          primaryIngredients: ["鶏もも肉", "しょうゆ", "みりん", "砂糖", "酒"],
        },
        {
          role: "main",
          name: "別の鶏料理",
          primaryIngredients: ["鶏もも肉", "しょうゆ", "みりん", "砂糖"],
        },
      ],
    };
    const right = {
      dishes: [
        {
          role: "main",
          name: "鶏の照り焼き",
          primaryIngredients: ["鶏もも肉", "しょうゆ", "みりん", "砂糖", "酒"],
        },
        {
          role: "main",
          name: "照り焼き風",
          primaryIngredients: ["鶏もも肉", "しょうゆ", "みりん", "酒"],
        },
      ],
    };
    // left[1] vs right[1]: intersection 3 / union 5 = 0.6 で非同一。
    // 完全マッチングは left[0]→right[1], left[1]→right[0]。
    expect(isMateriallySameMenu(left, right)).toBe(true);
  });

  it("rejects menus whose shared-role candidates cannot cover every dish", () => {
    // 左の2品がどちらも右の1品にしか対応しない（Hall 条件違反）→ 完全マッチングなし
    const left = {
      dishes: [
        { role: "main", name: "A", primaryIngredients: ["にんじん"] },
        { role: "main", name: "A", primaryIngredients: ["にんじん"] },
      ],
    };
    const right = {
      dishes: [
        { role: "main", name: "A", primaryIngredients: ["にんじん"] },
        { role: "main", name: "B", primaryIngredients: ["大根", "白菜", "きゅうり", "豆腐", "卵"] },
      ],
    };
    expect(isMateriallySameMenu(left, right)).toBe(false);
  });
});
