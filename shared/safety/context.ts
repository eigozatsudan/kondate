import type {
  AgeBand,
  AllergyStatus,
  RequiredSafetyConstraint,
  UnsupportedDietKind,
  UnsupportedDietStatus,
} from "../contracts/domain.js";
import type { AllergenDictionary } from "./allergens.js";
import type { FoodSafetyRule } from "./food-rules.js";

/** 確認済み自由登録アレルギー（評価 hard match + 設計 §4.2 の prompt DTO 送信対象）。 */
export type CurrentSafetyCustomAllergy = {
  name: string;
  aliases: readonly string[];
};

export type CurrentSafetyMember = {
  householdMemberId: string;
  anonymousRef: string;
  ageBand: AgeBand;
  allergyStatus: AllergyStatus;
  allergenIds: readonly string[];
  /**
   * 緊急献立など標準 ID しか照合できない経路向け。
   * 自由登録がある場合 true（fixture では検査不能 → fail-closed）。
   * AI 生成は customAllergies を evaluateAllergens で照合し、このフラグだけでは拒否しない（AGS-I2）。
   */
  hasUnmappedCustomAllergy: boolean;
  /** 確認済みカスタムアレルギー。name + aliases を hard match する。 */
  customAllergies: readonly CurrentSafetyCustomAllergy[];
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
