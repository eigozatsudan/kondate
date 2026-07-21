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
});
