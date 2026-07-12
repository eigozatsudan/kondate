import { describe, expect, it } from "vitest";
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
});
