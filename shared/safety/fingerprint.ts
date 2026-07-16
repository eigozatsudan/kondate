import { createHash } from "node:crypto";
import type { CurrentSafetyContext } from "./context.js";

export function createCurrentSafetyFingerprint(context: CurrentSafetyContext): string {
  const payload = {
    dictionaryVersion: context.dictionaryVersion,
    foodRuleVersion: context.foodRuleVersion,
    members: [...context.members]
      .map((member) => ({
        householdMemberId: member.householdMemberId,
        anonymousRef: member.anonymousRef,
        ageBand: member.ageBand,
        allergyStatus: member.allergyStatus,
        allergenIds: [...member.allergenIds].sort(),
        hasUnmappedCustomAllergy: member.hasUnmappedCustomAllergy,
        requiredSafetyConstraints: [...member.requiredSafetyConstraints].sort(),
        unsupportedDietStatus: member.unsupportedDietStatus,
        unsupportedDietKinds: [...member.unsupportedDietKinds].sort(),
      }))
      .sort((left, right) => left.householdMemberId.localeCompare(right.householdMemberId)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
