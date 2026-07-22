import { describe, expect, it } from "vitest";
import {
  ageBands,
  allergyStatuses,
  changeReasons,
  cuisineGenres,
  easePreferences,
  generationStatuses,
  householdMemberStatuses,
  mealTypes,
  onboardingStatuses,
  pantryPriorities,
  portionSizes,
  privacyNoticeVersion,
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
    expect(privacyNoticeVersion).toBe("2026-07-11.v1");
  });
});
