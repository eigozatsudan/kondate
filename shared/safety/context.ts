import type {
  AgeBand,
  AllergyStatus,
  RequiredSafetyConstraint,
  UnsupportedDietKind,
  UnsupportedDietStatus,
} from "../contracts/domain.js";
import type { AllergenDictionary } from "./allergens.js";
import type { FoodSafetyRule } from "./food-rules.js";

export type CurrentSafetyMember = {
  householdMemberId: string;
  anonymousRef: string;
  ageBand: AgeBand;
  allergyStatus: AllergyStatus;
  allergenIds: readonly string[];
  hasUnmappedCustomAllergy: boolean;
  requiredSafetyConstraints: readonly RequiredSafetyConstraint[];
  unsupportedDietStatus: UnsupportedDietStatus;
  unsupportedDietKinds: readonly UnsupportedDietKind[];
};

export type CurrentSafetyContext = {
  dictionaryVersion: string;
  foodRuleVersion: string;
  requestText: string;
  members: readonly CurrentSafetyMember[];
  allergenDictionary: AllergenDictionary;
  foodSafetyRules: readonly FoodSafetyRule[];
};
