// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ValidatedMenu } from "../contracts/generation.js";
import { makeValidatedMenu } from "../testing/factories.js";
import { buildShareCanonicalMenu } from "./share-canonical.js";

/** 決定論 idFactory。source 既定 UUID 帯（5x）と重ならない 6x 帯を採番する */
function createTestIdFactory(start = 1): () => string {
  let n = start;
  return () => {
    const suffix = String(n++).padStart(12, "0");
    return `60000000-0000-4000-8000-${suffix}`;
  };
}

function makeValidatedMenuWithPortion(portionText: string): ValidatedMenu {
  const base = makeValidatedMenu();
  const dish = base.dishes[0]!;
  const step = dish.steps[0]!;
  return makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: dish.id,
        anonymousMemberRef: "member_2",
        portionText,
        branchBeforeRecipeStepId: step.id,
        additionalCutting: "太郎用に細かくする",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "太郎の分を取り分けたことを確認する",
        safetyTags: [],
        safetyActions: [],
      },
    ],
  });
}

function collectEntityIds(menu: ValidatedMenu): Set<string> {
  const ids = new Set<string>([menu.menuId]);
  for (const dish of menu.dishes) {
    ids.add(dish.id);
    for (const ingredient of dish.ingredients) ids.add(ingredient.id);
    for (const step of dish.steps) ids.add(step.id);
  }
  for (const step of menu.timeline) {
    ids.add(step.id);
    if (step.dishId !== null) ids.add(step.dishId);
    if (step.recipeStepId !== null) ids.add(step.recipeStepId);
  }
  for (const adaptation of menu.adaptations) {
    ids.add(adaptation.id);
    ids.add(adaptation.dishId);
    ids.add(adaptation.branchBeforeRecipeStepId);
    for (const action of adaptation.safetyActions) {
      ids.add(action.dishId);
      ids.add(action.ingredientId);
      ids.add(action.beforeRecipeStepId);
    }
  }
  return ids;
}

describe("buildShareCanonicalMenu", () => {
  it("assigns menuId different from source", () => {
    const source = makeValidatedMenu();
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.menu.menuId).not.toBe(source.menuId);
  });

  it("always sets servings to 2 regardless of source servings", () => {
    for (const servings of [1, 3, 4, 8] as const) {
      const source = makeValidatedMenu({ servings });
      const result = buildShareCanonicalMenu(source, createTestIdFactory());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.menu.servings).toBe(2);
    }
  });

  it("reassigns all entity ids so none match the source set", () => {
    const source = makeValidatedMenu({
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: "50000000-0000-4000-8000-000000000001",
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: "51000000-0000-4000-8000-000000000001",
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "取り分けを確認する",
          safetyTags: ["cut_small"],
          safetyActions: [
            {
              kind: "cut_small",
              dishId: "50000000-0000-4000-8000-000000000001",
              ingredientId: "53000000-0000-4000-8000-000000000001",
              anonymousMemberRef: "member_1",
              beforeRecipeStepId: "51000000-0000-4000-8000-000000000001",
              instruction: "食べやすい大きさに切る",
            },
          ],
        },
      ],
    });
    const sourceIds = collectEntityIds(source);
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const canonicalIds = collectEntityIds(result.menu);
    for (const id of canonicalIds) {
      expect(sourceIds.has(id)).toBe(false);
    }
  });

  it("does not copy source adaptation portionText", () => {
    const source = makeValidatedMenuWithPortion("太郎は骨を取り除いて少なめ");
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const a of result.menu.adaptations) {
        expect(a.portionText).not.toContain("太郎");
        expect(a.anonymousMemberRef).toBe("member_1");
        // ソースの自由文（表示名スナップショット相当）を残さない
        expect(a.additionalCutting).toBeNull();
        expect(a.servingCheck).not.toContain("太郎");
      }
    }
  });

  it("never returns empty adaptations array on ok:true", () => {
    const source = makeValidatedMenu({ adaptations: [] });
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.menu.adaptations.length).toBeGreaterThan(0);
    for (const adaptation of result.menu.adaptations) {
      expect(adaptation.anonymousMemberRef).toBe("member_1");
    }
  });

  it("clears pantryUsage and labelConfirmations", () => {
    const base = makeValidatedMenu();
    const ingredientId = base.dishes[0]!.ingredients[0]!.id;
    const source = makeValidatedMenu({
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: ingredientId,
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: base.dishes[0]!.ingredients[0]!.name,
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    });
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.menu.pantryUsage).toEqual([]);
    expect(result.menu.labelConfirmations).toEqual([]);
    for (const dish of result.menu.dishes) {
      for (const ingredient of dish.ingredients) {
        expect(ingredient.pantrySelectionId).toBeNull();
      }
    }
  });

  it("fails closed when safetyActions cannot be rebound", () => {
    const base = makeValidatedMenu();
    const dish = base.dishes[0]!;
    const step = dish.steps[0]!;
    // 存在しない ingredientId → 決定論 rebind 不能
    const source = makeValidatedMenu({
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: dish.id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: step.id,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "取り分けを確認する",
          safetyTags: ["cut_small"],
          safetyActions: [
            {
              kind: "cut_small",
              dishId: dish.id,
              ingredientId: "99999999-0000-4000-8000-000000000099",
              anonymousMemberRef: "member_1",
              beforeRecipeStepId: step.id,
              instruction: "細かく切る",
            },
          ],
        },
      ],
    });
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result).toEqual({ ok: false, reason: "ineligible_structure" });
  });

  it("rebinds valid safetyActions onto member_1 template adaptations", () => {
    const dishId = "50000000-0000-4000-8000-000000000001";
    const stepId = "51000000-0000-4000-8000-000000000001";
    const ingredientId = "53000000-0000-4000-8000-000000000001";
    const source = makeValidatedMenu({
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId,
          anonymousMemberRef: "member_2",
          portionText: "子ども用",
          branchBeforeRecipeStepId: stepId,
          additionalCutting: "細かく",
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "確認",
          safetyTags: ["cut_small"],
          safetyActions: [
            {
              kind: "cut_small",
              dishId,
              ingredientId,
              anonymousMemberRef: "member_2",
              beforeRecipeStepId: stepId,
              instruction: "食べやすい大きさに切る",
            },
          ],
        },
      ],
    });
    const result = buildShareCanonicalMenu(source, createTestIdFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.menu.adaptations.flatMap((a) => a.safetyActions);
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.kind).toBe("cut_small");
    expect(action.anonymousMemberRef).toBe("member_1");
    expect(action.instruction).toBe("食べやすい大きさに切る");
    // 新 ID へ rebind 済み
    expect(action.dishId).not.toBe(dishId);
    expect(action.ingredientId).not.toBe(ingredientId);
    expect(action.beforeRecipeStepId).not.toBe(stepId);
    // 新 dish の ingredients / steps に属すること
    const targetDish = result.menu.dishes.find((d) => d.id === action.dishId);
    expect(targetDish).toBeDefined();
    expect(targetDish!.ingredients.some((i) => i.id === action.ingredientId)).toBe(true);
    expect(targetDish!.steps.some((s) => s.id === action.beforeRecipeStepId)).toBe(true);
  });

  it("propagates eligibility failures without inventing structure", () => {
    const source = makeValidatedMenu({ totalElapsedMinutes: 30 });
    expect(buildShareCanonicalMenu(source, createTestIdFactory())).toEqual({
      ok: false,
      reason: "not_emergency_duration",
    });

    const base = makeValidatedMenu();
    const pantryMenu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0
                  ? {
                      ...ingredient,
                      pantrySelectionId: "58000000-0000-4000-8000-000000000001",
                    }
                  : ingredient,
              ),
            }
          : dish,
      ),
    });
    expect(buildShareCanonicalMenu(pantryMenu, createTestIdFactory())).toEqual({
      ok: false,
      reason: "pantry_bound",
    });
  });
});
