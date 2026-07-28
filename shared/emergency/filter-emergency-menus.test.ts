import { describe, expect, it } from "vitest";
import type { AgeBand, RequiredSafetyConstraint } from "../contracts/domain.js";
import { normalizeFoodText } from "../safety/allergens.js";
import { currentAllergenCatalogV1 } from "../safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import { makeCurrentSafetyContext, makeGenerationContext } from "../testing/factories.js";
import {
  emergencyFixtureMetadataV1,
  emergencyFixtureVersion,
  emergencyMenuFixturesV1,
} from "./fixtures.v1.js";
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
    const mealTypes = emergencyMenuFixturesV1.map((menu) => menu.mealType);
    expect(new Set(mealTypes)).toEqual(new Set(["breakfast", "lunch", "dinner"]));
    expect(emergencyMenuFixturesV1.length).toBeGreaterThanOrEqual(9);
    expect(emergencyMenuFixturesV1.length).toBeLessThanOrEqual(12);
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
    expect(result).toEqual({
      menus: [],
      emptyReason: "current_safety_unavailable",
      matchMode: null,
    });
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

    // カタログ拡充後は breakfast が複数ある。adaptation 写像は先頭候補で十分検証できる
    expect(result.menus.length).toBeGreaterThan(0);
    const menu = result.menus[0]!;
    const memberRefs = menu.adaptations.map((item) => item.anonymousMemberRef);
    // 料理ごとの adaptation 行があるため、各メンバーが少なくとも1行持つことだけを見る
    expect(new Set(memberRefs)).toEqual(new Set(["member_1", "member_2"]));
    expect(
      menu.adaptations.flatMap((item) =>
        item.safetyActions.map((action) => action.anonymousMemberRef),
      ),
    ).toEqual(expect.arrayContaining(["member_1", "member_2"]));
  });

  it("returns no candidate when one member blocks every dinner fixture via allergen union", () => {
    const base = makeCurrentSafetyContext();
    const firstMember = base.members[0]!;
    // 複数 dinner があるため、dinner 全 metadata の allergen 和集合で Stage S を空にする
    const dinnerUnion = [
      ...new Set(
        emergencyMenuFixturesV1
          .filter((menu) => menu.mealType === "dinner")
          .flatMap((menu) => emergencyFixtureMetadataV1[menu.menuId]!.standardAllergenIds),
      ),
    ];
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
            allergenIds: dinnerUnion,
          },
        ],
      }),
    });
    expect(result).toEqual({
      menus: [],
      emptyReason: "no_matching_fixture",
      matchMode: null,
    });
  });

  it("keeps only reviewed menus whose dish or ingredient names match every main ingredient", () => {
    const matching = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["鶏", "きゅうり"],
      pantryNames: [],
      context: makeCurrentSafetyContext(),
    });
    expect(matching.menus).toHaveLength(1);
    expect(matching.matchMode).toBe("main_ingredient");
    expect(matching.emptyReason).toBeNull();
  });

  it("falls back to safety_only when main ingredients do not match", () => {
    const result = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["存在しないメイン食材XYZ"],
      pantryNames: [],
      context: adultContext([]),
    });
    expect(result.emptyReason).toBeNull();
    expect(result.matchMode).toBe("safety_only");
    expect(result.menus.length).toBeGreaterThan(0);
  });

  it("returns main_ingredient when all mains match dish or ingredient names", () => {
    const result = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      pantryNames: [],
      context: adultContext([]),
    });
    expect(result.matchMode).toBe("main_ingredient");
    expect(result.emptyReason).toBeNull();
    expect(result.menus.length).toBeGreaterThan(0);
  });

  it("returns none when main ingredients empty", () => {
    const result = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: [],
      pantryNames: [],
      context: adultContext([]),
    });
    expect(result.matchMode).toBe("none");
    expect(result.emptyReason).toBeNull();
  });

  it("matches main ingredients only as substrings of dish/ingredient names (not reverse)", () => {
    // NFKC/trim 後に fixture の材料名「鶏肉」へ forward 部分一致する
    const normalized = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["　鶏肉　"],
      pantryNames: [],
      context: makeCurrentSafetyContext(),
    });
    expect(normalized.menus).toHaveLength(1);
    expect(normalized.matchMode).toBe("main_ingredient");

    // 手順文だけに現れる語は料理名・材料名に無いため Stage M 不一致 → safety_only
    const instructionOnly = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["湯"],
      pantryNames: [],
      context: makeCurrentSafetyContext(),
    });
    expect(instructionOnly.emptyReason).toBeNull();
    expect(instructionOnly.matchMode).toBe("safety_only");
    expect(instructionOnly.menus.length).toBeGreaterThan(0);

    // 逆方向 includes（"塩鮭".includes("塩")）は調味料などで過剰マッチするため採用しない
    const shortToken = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["塩鮭"],
      pantryNames: [],
      context: makeCurrentSafetyContext(),
    });
    expect(shortToken.emptyReason).toBeNull();
    expect(shortToken.matchMode).toBe("safety_only");
    expect(shortToken.menus.length).toBeGreaterThan(0);
  });

  it.each(["鶏 肉", "鶏。肉", "\u200B"])(
    "does not over-match a main ingredient that differs after NFKC and trim: %s",
    (mainIngredient) => {
      const result = filterEmergencyMenus({
        mealType: "dinner",
        mainIngredients: [mainIngredient],
        pantryNames: [],
        context: makeCurrentSafetyContext(),
      });

      // NFKC+trim 後も forward 一致しない → safety_only フォールバック（空にしない）
      expect(result.emptyReason).toBeNull();
      expect(result.matchMode).toBe("safety_only");
      expect(result.menus.length).toBeGreaterThan(0);
    },
  );

  it("prefers safety exclusion over main-ingredient when every fixture is unsafe", () => {
    const context = makeCurrentSafetyContext();
    const union = [
      ...new Set(
        Object.values(emergencyFixtureMetadataV1).flatMap((meta) => meta.standardAllergenIds),
      ),
    ];
    const result = filterEmergencyMenus({
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      pantryNames: [],
      context: makeCurrentSafetyContext({
        members: [
          {
            ...context.members[0]!,
            allergyStatus: "registered",
            allergenIds: union,
          },
        ],
      }),
    });

    // メイン食材があっても、安全条件で候補が0なら no_matching_fixture
    expect(result).toEqual({
      menus: [],
      emptyReason: "no_matching_fixture",
      matchMode: null,
    });
  });

  it.each([{ unsupportedDietStatus: "present" as const }, { hasUnmappedCustomAllergy: true }])(
    "uses current_safety_unavailable for early safety exclusion even with main ingredients",
    (memberPatch) => {
      const context = makeCurrentSafetyContext();
      const result = filterEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        pantryNames: [],
        context: makeCurrentSafetyContext({
          members: [{ ...context.members[0]!, ...memberPatch }],
        }),
      });

      expect(result).toEqual({
        menus: [],
        emptyReason: "current_safety_unavailable",
        matchMode: null,
      });
    },
  );

  const adultContext = (allergenIds: readonly string[]) =>
    makeCurrentSafetyContext({
      members: [
        {
          ...makeCurrentSafetyContext().members[0]!,
          ageBand: "adult",
          allergenIds: [...allergenIds],
          allergyStatus: allergenIds.length === 0 ? "none" : "registered",
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          hasUnmappedCustomAllergy: false,
        },
      ],
      foodSafetyRules: currentFoodSafetyRulesV1,
    });

  const matrix: readonly { name: string; allergens: readonly string[] }[] = [
    { name: "none", allergens: [] },
    { name: "chicken", allergens: ["chicken"] },
    { name: "salmon", allergens: ["salmon"] },
    { name: "egg", allergens: ["egg"] },
    { name: "chicken+salmon", allergens: ["chicken", "salmon"] },
    { name: "chicken+egg", allergens: ["chicken", "egg"] },
  ];

  it.each(matrix)("coverage matrix $name yields ≥1 per mealType", ({ allergens }) => {
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const result = filterEmergencyMenus({
        mealType,
        pantryNames: [],
        context: adultContext(allergens),
      });
      expect(result.menus.length, `${mealType}/${allergens.join("+") || "none"}`).toBeGreaterThan(
        0,
      );
      expect(result.emptyReason).toBeNull();
      expect(result.matchMode).toBe("none");
    }
  });

  it("union of all metadata standardAllergenIds yields no_matching_fixture per mealType", () => {
    const union = [
      ...new Set(
        Object.values(emergencyFixtureMetadataV1).flatMap((meta) => meta.standardAllergenIds),
      ),
    ];
    expect(union.length).toBeGreaterThan(0);
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const result = filterEmergencyMenus({
        mealType,
        pantryNames: [],
        context: adultContext(union),
      });
      expect(result.menus, mealType).toEqual([]);
      expect(result.emptyReason, mealType).toBe("no_matching_fixture");
      expect(result.matchMode, mealType).toBeNull();
    }
  });

  it("fixtureVersion is 2026-07-28.v1 and menu schemaVersion stays 2026-07-11.v1", () => {
    expect(emergencyFixtureVersion).toBe("2026-07-28.v1");
    for (const menu of emergencyMenuFixturesV1) {
      expect(menu.schemaVersion).toBe("2026-07-11.v1");
    }
    expect(emergencyMenuFixturesV1.length).toBeGreaterThanOrEqual(9);
    expect(emergencyMenuFixturesV1.length).toBeLessThanOrEqual(12);
  });

  it("all fixture UUIDs are unique and avoid idea synthetic member id", () => {
    const ideaMember = "83000000-0000-4000-8000-000000000001";
    const ids: string[] = [];
    for (const menu of emergencyMenuFixturesV1) {
      ids.push(menu.menuId);
      for (const dish of menu.dishes) {
        ids.push(dish.id, ...dish.ingredients.map((i) => i.id), ...dish.steps.map((s) => s.id));
      }
      ids.push(...menu.timeline.map((t) => t.id), ...menu.adaptations.map((a) => a.id));
    }
    expect(ids).not.toContain(ideaMember);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("metadata standardAllergenIds cover catalog displayName and alias exact hits; ids ⊆ catalog", () => {
    const catalogIds = new Set(currentAllergenCatalogV1.map((e) => e.id));
    // displayName と alias の両方を exact normalize 対象にする（複合語は人手レビュー）
    const byNormalizedName = new Map<string, string>();
    for (const entry of currentAllergenCatalogV1) {
      byNormalizedName.set(normalizeFoodText(entry.displayName), entry.id);
    }
    // factory と同型: catalog displayName を alias としても載せる実装が多い。
    // 追加 alias が dictionary に存在する場合は makeCurrentSafetyContext().allergenDictionary.aliases も走査する。
    const dictionaryAliases = makeCurrentSafetyContext().allergenDictionary.aliases;
    for (const alias of dictionaryAliases) {
      byNormalizedName.set(normalizeFoodText(alias.normalizedAlias), alias.allergenId);
      byNormalizedName.set(normalizeFoodText(alias.alias), alias.allergenId);
    }

    // 大豆の displayName は「大豆」のみ。豆腐は exact-hit に乗らないが、
    // fixture では大豆由来として standardAllergenIds に soy を必ず載せる。
    const normalizedTofu = normalizeFoodText("豆腐");

    for (const menu of emergencyMenuFixturesV1) {
      const meta = emergencyFixtureMetadataV1[menu.menuId]!;
      for (const id of meta.standardAllergenIds) {
        expect(catalogIds.has(id), `unknown catalog id ${id} on ${menu.menuId}`).toBe(true);
      }
      for (const dish of menu.dishes) {
        for (const ingredient of dish.ingredients) {
          const hit = byNormalizedName.get(normalizeFoodText(ingredient.name));
          if (hit !== undefined) {
            expect(meta.standardAllergenIds, ingredient.name).toContain(hit);
          }
          // 豆腐（部分一致または normalize 一致）は soy 申告を必須にする
          const normalizedName = normalizeFoodText(ingredient.name);
          if (ingredient.name.includes("豆腐") || normalizedName.includes(normalizedTofu)) {
            expect(meta.standardAllergenIds, `${menu.menuId}/${ingredient.name}`).toContain("soy");
          }
        }
      }
    }
  });
});
