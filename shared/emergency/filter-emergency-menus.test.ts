import { describe, expect, it } from "vitest";
import type { AgeBand } from "../contracts/domain.js";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import { makeCurrentSafetyContext, makeGenerationContext } from "../testing/factories.js";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1.js";
import { filterEmergencyMenus } from "./filter-emergency-menus.js";

describe("reviewed emergency menus", () => {
  it("provides complete reviewed fixtures for every meal", () => {
    expect(emergencyMenuFixturesV1.map((menu) => menu.mealType).toSorted()).toEqual([
      "breakfast",
      "dinner",
      "lunch",
    ]);
    for (const menu of emergencyMenuFixturesV1) {
      expect(emergencyFixtureMetadataV1[menu.menuId]).toBeDefined();
      expect(menu.totalElapsedMinutes).toBeLessThanOrEqual(15);
      expect(menu.timeline.length).toBeGreaterThan(0);
      const roles = new Set(menu.dishes.map((dish) => dish.role));
      if (menu.mealType === "dinner") {
        expect(roles).toEqual(new Set(["main", "side", "soup"]));
      } else {
        expect(roles.has("main") || roles.has("staple")).toBe(true);
        expect(roles.has("side")).toBe(true);
      }
      for (const dish of menu.dishes) {
        expect(dish.ingredients.length).toBeGreaterThan(0);
        expect(dish.steps.length).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(emergencyFixtureMetadataV1).toSorted()).toEqual(
      emergencyMenuFixturesV1.map((menu) => menu.menuId).toSorted(),
    );
  });

  it.each(["post_weaning_to_2", "adult", "senior"] satisfies readonly AgeBand[])(
    "validates every reviewed fixture in a complete %s generation context",
    (ageBand) => {
      for (const menu of emergencyMenuFixturesV1) {
        const base = makeGenerationContext();
        const safety = makeCurrentSafetyContext({
          members: [{ ...base.safety.members[0]!, ageBand }],
          foodSafetyRules: currentFoodSafetyRulesV1,
        });
        const context = makeGenerationContext({
          submission: {
            ...base.submission,
            mealType: menu.mealType,
            mainIngredients: [],
            cuisineGenre: menu.cuisineGenre,
            timeLimitMinutes: 15,
          },
          safety,
        });

        const result = validateGeneratedMenu(menu, context);
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      }
    },
  );

  it("binds every safety action to the exact protected ingredient and its owner graph", () => {
    const expectedBindings = [
      {
        mealType: "breakfast",
        kind: "remove_bones",
        ingredientId: "82200000-0000-4000-8000-000000000012",
        ingredientName: "鮭",
      },
      {
        mealType: "lunch",
        kind: "heat_thoroughly",
        ingredientId: "82200000-0000-4000-8000-000000000021",
        ingredientName: "鶏ひき肉",
      },
      {
        mealType: "dinner",
        kind: "heat_thoroughly",
        ingredientId: "82200000-0000-4000-8000-000000000001",
        ingredientName: "鶏肉",
      },
    ] as const;

    for (const expected of expectedBindings) {
      const menu = emergencyMenuFixturesV1.find(
        (candidate) => candidate.mealType === expected.mealType,
      );
      expect(menu).toBeDefined();
      if (menu === undefined) continue;
      const actions = menu.adaptations.flatMap((adaptation) =>
        adaptation.safetyActions.map((action) => ({ action, adaptation })),
      );
      expect(actions).toHaveLength(1);
      const binding = actions[0]!;
      const dish = menu.dishes.find((candidate) => candidate.id === binding.action.dishId);
      const ingredient = dish?.ingredients.find(
        (candidate) => candidate.id === binding.action.ingredientId,
      );
      const step = dish?.steps.find(
        (candidate) => candidate.id === binding.action.beforeRecipeStepId,
      );

      expect(binding.action).toMatchObject({
        kind: expected.kind,
        ingredientId: expected.ingredientId,
        anonymousMemberRef: binding.adaptation.anonymousMemberRef,
      });
      expect(binding.adaptation.dishId).toBe(binding.action.dishId);
      expect(binding.adaptation.branchBeforeRecipeStepId).toBe(binding.action.beforeRecipeStepId);
      expect(ingredient?.name).toBe(expected.ingredientName);
      expect(step).toBeDefined();
      expect(binding.action.instruction).toContain(expected.ingredientName);
    }
  });

  it("does not relax an unconfirmed or unmapped current safety condition", () => {
    const context = makeCurrentSafetyContext();
    const result = filterEmergencyMenus({
      mealType: "dinner",
      pantryNames: [],
      context: makeCurrentSafetyContext({
        members: [
          {
            ...context.members[0]!,
            allergyStatus: "unconfirmed",
            hasUnmappedCustomAllergy: true,
          },
        ],
      }),
    });
    expect(result).toEqual({ menus: [], emptyReason: "current_safety_unavailable" });
  });

  it("assigns every requested member an ordered adaptation before one full-context validation", () => {
    const base = makeCurrentSafetyContext();
    const firstMember = base.members[0]!;
    const secondMemberId = "55000000-0000-4000-8000-000000000002";
    const result = filterEmergencyMenus({
      mealType: "breakfast",
      pantryNames: [],
      memberLabels: { member_1: "大人", member_2: "子ども" },
      context: makeCurrentSafetyContext({
        members: [
          firstMember,
          {
            ...firstMember,
            householdMemberId: secondMemberId,
            anonymousRef: "member_2",
            ageBand: "age_3_5",
            requiredSafetyConstraints: ["remove_bones"],
          },
        ],
      }),
    });

    expect(result.menus).toHaveLength(1);
    expect(result.menus[0]?.adaptations.map((item) => item.anonymousMemberRef)).toEqual([
      "member_1",
      "member_2",
    ]);
    expect(
      result.menus[0]?.adaptations.flatMap((item) =>
        item.safetyActions.map((action) => action.anonymousMemberRef),
      ),
    ).toEqual(["member_1", "member_2"]);
  });

  it("returns no candidate when one member is incompatible with the remapped fixture", () => {
    const base = makeCurrentSafetyContext();
    const firstMember = base.members[0]!;
    const result = filterEmergencyMenus({
      mealType: "dinner",
      pantryNames: [],
      context: makeCurrentSafetyContext({
        members: [
          firstMember,
          {
            ...firstMember,
            householdMemberId: "55000000-0000-4000-8000-000000000002",
            anonymousRef: "member_2",
            requiredSafetyConstraints: ["remove_bones"],
          },
        ],
      }),
    });

    expect(result).toEqual({ menus: [], emptyReason: "no_matching_fixture" });
  });
});
