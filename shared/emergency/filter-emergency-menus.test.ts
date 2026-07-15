import { describe, expect, it } from "vitest";
import { makeCurrentSafetyContext } from "../testing/factories.js";
import { emergencyMenuFixturesV1 } from "./fixtures.v1.js";
import { filterEmergencyMenus } from "./filter-emergency-menus.js";

describe("reviewed emergency menus", () => {
  it("provides complete reviewed fixtures for every meal", () => {
    expect(emergencyMenuFixturesV1.map((menu) => menu.mealType).toSorted()).toEqual([
      "breakfast",
      "dinner",
      "lunch",
    ]);
    for (const menu of emergencyMenuFixturesV1) {
      expect(menu.totalElapsedMinutes).toBeLessThanOrEqual(15);
      expect(menu.timeline.length).toBeGreaterThan(0);
      for (const dish of menu.dishes) {
        expect(dish.ingredients.length).toBeGreaterThan(0);
        expect(dish.steps.length).toBeGreaterThan(0);
      }
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
