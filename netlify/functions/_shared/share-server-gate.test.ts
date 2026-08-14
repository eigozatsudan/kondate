// @vitest-environment node

import { describe, expect, it } from "vitest";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import { captureShareIngredientGraphLock, runShareServerGate } from "./share-server-gate.js";

describe("runShareServerGate", () => {
  it("accepts a valid menu that matches the locked graph", () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    expect(runShareServerGate(menu, lock)).toEqual({ ok: true });
  });

  it("rejects guarantee phrase アレルギーでも安心", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, description: "この副菜はアレルギーでも安心な一品です" } : dish,
      ),
    });
    const lock = captureShareIngredientGraphLock(menu);
    expect(runShareServerGate(menu, lock)).toEqual({
      ok: false,
      code: "server_gate_failed",
    });
  });

  it("rejects ingredient name containing 太郎の", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0 ? { ...ingredient, name: "太郎の特製みそ" } : ingredient,
              ),
            }
          : dish,
      ),
    });
    const lock = captureShareIngredientGraphLock(menu);
    expect(runShareServerGate(menu, lock)).toEqual({
      ok: false,
      code: "server_gate_failed",
    });
  });

  it("rejects graph quantity mutation vs locked snapshot", () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    const mutated = makeValidatedMenu({
      dishes: menu.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0
                  ? {
                      ...ingredient,
                      // 数量の数値だけ改変（name / quantityText はロック対象外）
                      quantityValue: (ingredient.quantityValue ?? 0) + 100,
                      quantityText: "改変量",
                    }
                  : ingredient,
              ),
            }
          : dish,
      ),
    });
    expect(runShareServerGate(mutated, lock)).toEqual({
      ok: false,
      code: "server_gate_failed",
    });
  });

  it("rejects Zod-invalid payload without throwing", () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    expect(runShareServerGate({ not: "a menu" }, lock)).toEqual({
      ok: false,
      code: "server_gate_failed",
    });
  });

  it("allows free-text quantityText change when numeric quantities stay locked", () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    const rewritten = makeValidatedMenu({
      dishes: menu.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0 ? { ...ingredient, quantityText: "大さじ1" } : ingredient,
              ),
            }
          : dish,
      ),
    });
    expect(runShareServerGate(rewritten, lock)).toEqual({ ok: true });
  });

  it("allows free-text name change when graph quantities stay locked", () => {
    const menu = makeValidatedMenu();
    const lock = captureShareIngredientGraphLock(menu);
    const renamed = makeValidatedMenu({
      dishes: menu.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              // 一般化後の料理名差し替えは許可（グラフは不変）
              name: "朝のごはん",
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0 ? { ...ingredient, name: "白米ごはん" } : ingredient,
              ),
            }
          : dish,
      ),
    });
    expect(runShareServerGate(renamed, lock)).toEqual({ ok: true });
  });
});
