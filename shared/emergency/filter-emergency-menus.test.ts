import { describe, expect, it } from "vitest";
import type { AgeBand } from "../contracts/domain.js";
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

        expect(validateGeneratedMenu(menu, context)).toMatchObject({ ok: true });
      }
    },
  );

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
