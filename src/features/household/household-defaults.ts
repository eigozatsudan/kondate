import type {
  AgeBand,
  EasePreference,
  PortionSize,
  RequiredSafetyConstraint,
  SpiceLevel,
} from "@shared/contracts/domain";

export type HouseholdDefaults = {
  portion_size: PortionSize;
  spice_level: SpiceLevel;
  ease_preferences: EasePreference[];
  required_safety_constraints: RequiredSafetyConstraint[];
};

export function defaultsForAgeBand(ageBand: AgeBand): HouseholdDefaults {
  if (ageBand === "post_weaning_to_2" || ageBand === "age_3_5") {
    return {
      portion_size: "small",
      spice_level: "none",
      ease_preferences: ["small_pieces", "boneless", "soft"],
      required_safety_constraints: ["remove_bones", "cut_small"],
    };
  }
  if (ageBand === "age_6_8" || ageBand === "age_9_12") {
    return {
      portion_size: "regular",
      spice_level: "mild",
      ease_preferences: ["boneless"],
      required_safety_constraints: ["remove_bones"],
    };
  }
  if (ageBand === "senior") {
    return {
      portion_size: "small",
      spice_level: "mild",
      ease_preferences: ["soft"],
      required_safety_constraints: [],
    };
  }
  return {
    portion_size: "regular",
    spice_level: "regular",
    ease_preferences: [],
    required_safety_constraints: [],
  };
}
