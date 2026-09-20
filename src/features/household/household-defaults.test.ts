import { describe, expect, it } from "vitest";
import { isRemoveBonesApplicableAgeBand } from "@shared/contracts/domain";
import { defaultsForAgeBand } from "./household-defaults";

describe("defaultsForAgeBand", () => {
  it("uses conservative toddler defaults", () => {
    expect(defaultsForAgeBand("post_weaning_to_2")).toEqual({
      portion_size: "small",
      spice_level: "none",
      ease_preferences: ["small_pieces", "boneless", "soft"],
      required_safety_constraints: ["remove_bones", "cut_small"],
    });
  });

  it("does not silently add mandatory constraints for an adult", () => {
    expect(defaultsForAgeBand("adult")).toEqual({
      portion_size: "regular",
      spice_level: "regular",
      ease_preferences: [],
      required_safety_constraints: [],
    });
  });

  it.each(["age_6_8", "age_9_12"] as const)(
    "does not default remove_bones for %s (outside the rule's age bands)",
    (ageBand) => {
      // 骨を除く規則はこの年齢帯を対象にしないため、保存されても評価されない
      // 制約を既定値に載せない。boneless 嗜好は別系統で維持する。
      expect(defaultsForAgeBand(ageBand)).toEqual({
        portion_size: "regular",
        spice_level: "mild",
        ease_preferences: ["boneless"],
        required_safety_constraints: [],
      });
    },
  );

  it.each(["post_weaning_to_2", "age_3_5", "senior"] as const)(
    "keeps remove_bones defaults aligned with rule coverage for %s",
    (ageBand) => {
      // 規則対象帯の既定は従来どおり（senior は規則対象だが既定値は空のまま）
      expect(isRemoveBonesApplicableAgeBand(ageBand)).toBe(true);
    },
  );
});
