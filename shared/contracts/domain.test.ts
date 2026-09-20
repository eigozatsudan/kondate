import { describe, expect, it } from "vitest";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";
import {
  ageBands,
  allergyStatuses,
  changeReasons,
  cuisineGenres,
  easePreferences,
  generationStatuses,
  householdMemberStatuses,
  isAllowedMenuDishCount,
  isRemoveBonesApplicableAgeBand,
  mealTypes,
  menuDishCountMax,
  minDishCountForMealType,
  onboardingStatuses,
  pantryPriorities,
  portionSizes,
  privacyNoticeVersion,
  REMOVE_BONES_APPLICABLE_AGE_BANDS,
  requiredSafetyConstraints,
  spiceLevels,
  unsupportedDietKinds,
  unsupportedDietStatuses,
} from "./domain.js";

describe("domain contracts", () => {
  it("keeps roadmap values stable", () => {
    expect(mealTypes).toEqual(["breakfast", "lunch", "dinner"]);
    expect(cuisineGenres).toEqual(["japanese", "western", "chinese", "any"]);
    expect(ageBands).toHaveLength(7);
    expect(allergyStatuses).toEqual(["none", "registered", "unconfirmed"]);
    expect(unsupportedDietStatuses).toEqual(["none", "present", "unconfirmed"]);
    expect(generationStatuses[0]).toBe("not_started");
    expect(pantryPriorities).toEqual(["must_use", "prefer_use"]);
    expect(changeReasons).toHaveLength(5);
  });

  it("locks mealType dish count helpers (S11 SSOT)", () => {
    expect(minDishCountForMealType("breakfast")).toBe(2);
    expect(minDishCountForMealType("lunch")).toBe(2);
    expect(minDishCountForMealType("dinner")).toBe(3);
    expect(menuDishCountMax).toBe(5);
    expect(isAllowedMenuDishCount("dinner", 1)).toBe(false);
    expect(isAllowedMenuDishCount("dinner", 3)).toBe(true);
  });

  it("keeps household values aligned with database checks", () => {
    expect(onboardingStatuses).toEqual(["not_started", "in_progress", "complete", "skipped"]);
    expect(householdMemberStatuses).toEqual(["draft", "complete"]);
    expect(portionSizes).toEqual(["small", "regular", "large"]);
    expect(spiceLevels).toEqual(["none", "mild", "regular"]);
    expect(easePreferences).toEqual(["small_pieces", "boneless", "soft"]);
    expect(requiredSafetyConstraints).toEqual(["remove_bones", "cut_small"]);
    expect(unsupportedDietKinds).toEqual([
      "weaning_food",
      "swallowing_concern",
      "therapeutic_diet",
    ]);
    expect(privacyNoticeVersion).toBe("2026-07-29.v1");
  });

  it("keeps REMOVE_BONES_APPLICABLE_AGE_BANDS aligned with the safety rules catalog", () => {
    // UI 側の写しが bones_for_young_and_senior 系規則の appliesToAgeBands 和集合と
    // 一致することを固定する（対象外の年齢帯では remove_bones は評価されない）。
    const catalogBands = [
      ...new Set(
        currentFoodSafetyRulesV1.flatMap((rule) =>
          rule.requiredSafetyTag === "remove_bones" ? rule.appliesToAgeBands : [],
        ),
      ),
    ].sort();
    expect([...REMOVE_BONES_APPLICABLE_AGE_BANDS].sort()).toEqual(catalogBands);
    expect(REMOVE_BONES_APPLICABLE_AGE_BANDS).toEqual(["post_weaning_to_2", "age_3_5", "senior"]);
    // 対象帯だけ true。未選択・対象外は false（「骨を除く」を出さない判定に使う）
    expect(isRemoveBonesApplicableAgeBand("age_3_5")).toBe(true);
    expect(isRemoveBonesApplicableAgeBand("senior")).toBe(true);
    expect(isRemoveBonesApplicableAgeBand("age_6_8")).toBe(false);
    expect(isRemoveBonesApplicableAgeBand("adult")).toBe(false);
    expect(isRemoveBonesApplicableAgeBand("")).toBe(false);
  });
});
