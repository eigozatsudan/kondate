import type { CurrentSafetyContext } from "../safety/context.js";
import {
  currentAllergenCatalogV1,
  currentAllergenCatalogVersion,
} from "../safety/current-allergen-catalog.v1.js";
import {
  currentFoodSafetyRulesV1,
  hardBeanAndReviewedNutRule,
} from "../safety/current-food-safety-rules.v1.js";

/** idea 合成メンバー専用。fixture / DB のどの id とも重複しない reserved band */
const IDEA_SYNTHETIC_MEMBER_ID = "83000000-0000-4000-8000-000000000001";

// currentFoodSafetyRulesV1 の版と同期。ハードコード文字列だと版 bump 時に Stage S 全滅する。
const IDEA_FOOD_RULE_VERSION = hardBeanAndReviewedNutRule.ruleVersion;

/**
 * idea 個人パス用の固定 CurrentSafetyContext。
 * 家族アレルギー・年齢・requiredSafetyConstraints は適用しない（成人・アレルギーなし）。
 * wire の path: "idea" が製品上の真実。validation は常に HouseholdGenerationContext で行う。
 */
export function buildIdeaPersonalSafetyContext(): {
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
} {
  return {
    memberLabels: Object.freeze({ member_1: "あなた" }),
    context: {
      dictionaryVersion: currentAllergenCatalogVersion,
      foodRuleVersion: IDEA_FOOD_RULE_VERSION,
      requestText: "",
      members: [
        {
          householdMemberId: IDEA_SYNTHETIC_MEMBER_ID,
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          hasUnmappedCustomAllergy: false,
          customAllergies: [],
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: {
        version: currentAllergenCatalogVersion,
        catalog: currentAllergenCatalogV1.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          catalogVersion: entry.catalogVersion,
        })),
        aliases: currentAllergenCatalogV1.map((entry) => ({
          allergenId: entry.id,
          alias: entry.displayName,
          normalizedAlias: entry.displayName,
          aliasKind: "direct" as const,
          requiresLabelConfirmation: false,
          dictionaryVersion: entry.catalogVersion,
        })),
      },
      foodSafetyRules: [...currentFoodSafetyRulesV1],
    },
  };
}
