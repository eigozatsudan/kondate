import { describe, expect, it } from "vitest";
import type { AgeBand, RequiredSafetyConstraint } from "../contracts/domain.js";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import { makeCurrentSafetyContext, makeGenerationContext } from "../testing/factories.js";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1.js";
import { filterEmergencyMenus } from "./filter-emergency-menus.js";

// shared から src を import しない（tsconfig 境界）。
// household-defaults の年齢帯 defaults と一致させる固定値。
function requiredSafetyConstraintsForAgeBand(
  ageBand: AgeBand,
): readonly RequiredSafetyConstraint[] {
  if (ageBand === "post_weaning_to_2" || ageBand === "age_3_5") {
    return ["remove_bones", "cut_small"];
  }
  if (ageBand === "age_6_8" || ageBand === "age_9_12") {
    return ["remove_bones"];
  }
  return [];
}

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
    "validates every reviewed fixture in a complete %s generation context with age defaults",
    (ageBand) => {
      // 空制約ではなく年齢 defaults を使い、未就学 cut_small を偽グリーンにしない
      const requiredSafetyConstraints = requiredSafetyConstraintsForAgeBand(ageBand);
      for (const menu of emergencyMenuFixturesV1) {
        const base = makeGenerationContext();
        const safety = makeCurrentSafetyContext({
          members: [
            {
              ...base.safety.members[0]!,
              ageBand,
              requiredSafetyConstraints,
            },
          ],
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
          memberPreferences: [
            {
              ...base.memberPreferences[0]!,
              // 安全制約だけを年齢 defaults で検証。portion/spice 文面は fixture 共通
              portionSize: "regular",
              spiceLevel: "regular",
              easePreferences: [],
            },
          ],
        });

        const result = validateGeneratedMenu(menu, context);
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      }
    },
  );

  it("keeps under-six defaults non-empty through filterEmergencyMenus", () => {
    const base = makeCurrentSafetyContext();
    const requiredSafetyConstraints = requiredSafetyConstraintsForAgeBand("post_weaning_to_2");
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const result = filterEmergencyMenus({
        mealType,
        pantryNames: [],
        context: makeCurrentSafetyContext({
          members: [
            {
              ...base.members[0]!,
              ageBand: "post_weaning_to_2",
              requiredSafetyConstraints,
            },
          ],
          foodSafetyRules: currentFoodSafetyRulesV1,
        }),
      });
      expect(result.emptyReason, mealType).toBeNull();
      expect(result.menus.length, mealType).toBeGreaterThan(0);
    }
  });

  it("binds every safety action to the exact protected ingredient and its owner graph", () => {
    // 主アクション（除骨・加熱）に加え、全料理の cut_small も ingredient-bound であること
    const expectedBindings = [
      {
        mealType: "breakfast",
        kind: "remove_bones" as const,
        ingredientId: "82200000-0000-4000-8000-000000000012",
        ingredientName: "鮭",
      },
      {
        mealType: "breakfast",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000012",
        ingredientName: "鮭",
      },
      {
        mealType: "breakfast",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000013",
        ingredientName: "にんじん",
      },
      {
        mealType: "lunch",
        kind: "heat_thoroughly" as const,
        ingredientId: "82200000-0000-4000-8000-000000000021",
        ingredientName: "鶏ひき肉",
      },
      {
        mealType: "lunch",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000021",
        ingredientName: "鶏ひき肉",
      },
      {
        mealType: "lunch",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000023",
        ingredientName: "かぼちゃ",
      },
      {
        mealType: "dinner",
        kind: "heat_thoroughly" as const,
        ingredientId: "82200000-0000-4000-8000-000000000001",
        ingredientName: "鶏肉",
      },
      {
        mealType: "dinner",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000001",
        ingredientName: "鶏肉",
      },
      {
        mealType: "dinner",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000004",
        ingredientName: "きゅうり",
      },
      {
        mealType: "dinner",
        kind: "cut_small" as const,
        ingredientId: "82200000-0000-4000-8000-000000000005",
        ingredientName: "玉ねぎ",
      },
    ];

    for (const expected of expectedBindings) {
      const menu = emergencyMenuFixturesV1.find(
        (candidate) => candidate.mealType === expected.mealType,
      );
      expect(menu).toBeDefined();
      if (menu === undefined) continue;
      const actions = menu.adaptations.flatMap((adaptation) =>
        adaptation.safetyActions.map((action) => ({ action, adaptation })),
      );
      const binding = actions.find(
        (entry) =>
          entry.action.kind === expected.kind &&
          entry.action.ingredientId === expected.ingredientId,
      );
      expect(binding, `${expected.mealType}/${expected.kind}`).toBeDefined();
      if (binding === undefined) continue;
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
      // branch は料理内の工程へ載っていればよい（kind ごとに同一 step とは限らない）
      expect(
        dish?.steps.some(
          (candidate) => candidate.id === binding.adaptation.branchBeforeRecipeStepId,
        ),
      ).toBe(true);
      expect(ingredient?.name).toBe(expected.ingredientName);
      expect(step).toBeDefined();
      expect(binding.action.instruction).toContain(expected.ingredientName);
    }

    // 各食事で cut_small が料理数ぶんあること（missing-evidence は料理単位）
    for (const menu of emergencyMenuFixturesV1) {
      const cutSmallDishIds = new Set(
        menu.adaptations.flatMap((adaptation) =>
          adaptation.safetyActions
            .filter((action) => action.kind === "cut_small")
            .map((action) => action.dishId),
        ),
      );
      expect(cutSmallDishIds.size).toBe(menu.dishes.length);
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
    const memberRefs = result.menus[0]?.adaptations.map((item) => item.anonymousMemberRef) ?? [];
    // 料理ごとの adaptation 行があるため、各メンバーが少なくとも1行持つことだけを見る
    expect(new Set(memberRefs)).toEqual(new Set(["member_1", "member_2"]));
    expect(
      result.menus[0]?.adaptations.flatMap((item) =>
        item.safetyActions.map((action) => action.anonymousMemberRef),
      ),
    ).toEqual(expect.arrayContaining(["member_1", "member_2"]));
  });

  it("returns no candidate when one member is incompatible with the remapped fixture", () => {
    const base = makeCurrentSafetyContext();
    const firstMember = base.members[0]!;
    // dinner fixture は standardAllergenIds に chicken を持つ。ease 写像に依存せず拒否する。
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
            allergyStatus: "registered",
            allergenIds: ["chicken"],
          },
        ],
      }),
    });

    expect(result).toEqual({ menus: [], emptyReason: "no_matching_fixture" });
  });
});
