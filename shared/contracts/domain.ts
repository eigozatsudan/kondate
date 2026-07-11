export const mealTypes = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof mealTypes)[number];

export const cuisineGenres = ["japanese", "western", "chinese", "any"] as const;
export type CuisineGenre = (typeof cuisineGenres)[number];

export const ageBands = [
  "post_weaning_to_2",
  "age_3_5",
  "age_6_8",
  "age_9_12",
  "age_13_17",
  "adult",
  "senior",
] as const;
export type AgeBand = (typeof ageBands)[number];

export const allergyStatuses = ["none", "registered", "unconfirmed"] as const;
export type AllergyStatus = (typeof allergyStatuses)[number];

export const unsupportedDietStatuses = ["none", "present", "unconfirmed"] as const;
export type UnsupportedDietStatus = (typeof unsupportedDietStatuses)[number];

export const generationStatuses = [
  "not_started",
  "processing",
  "succeeded",
  "failed",
  "constraint_conflict",
] as const;
export type GenerationStatus = (typeof generationStatuses)[number];

export const pantryPriorities = ["must_use", "prefer_use"] as const;
export type PantryPriority = (typeof pantryPriorities)[number];

export const changeReasons = [
  "simpler",
  "different_ingredient",
  "child_friendly",
  "different_flavor",
  "custom",
] as const;
export type ChangeReason = (typeof changeReasons)[number];

export const onboardingStatuses = ["not_started", "in_progress", "complete"] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export const householdMemberStatuses = ["draft", "complete"] as const;
export type HouseholdMemberStatus = (typeof householdMemberStatuses)[number];

export const portionSizes = ["small", "regular", "large"] as const;
export type PortionSize = (typeof portionSizes)[number];

export const spiceLevels = ["none", "mild", "regular"] as const;
export type SpiceLevel = (typeof spiceLevels)[number];

export const easePreferences = ["small_pieces", "boneless", "soft"] as const;
export type EasePreference = (typeof easePreferences)[number];

export const requiredSafetyConstraints = ["remove_bones", "cut_small"] as const;
export type RequiredSafetyConstraint = (typeof requiredSafetyConstraints)[number];

export const unsupportedDietKinds = [
  "weaning_food",
  "swallowing_concern",
  "therapeutic_diet",
] as const;
export type UnsupportedDietKind = (typeof unsupportedDietKinds)[number];

export const privacyNoticeVersion = "2026-07-11.v1" as const;
