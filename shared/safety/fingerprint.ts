import { createHash } from "node:crypto";
import type { CurrentSafetyContext } from "./context.js";

/**
 * 現行安全 fingerprint。
 * SQL private.current_safety_fingerprint と **同一の JSON 形状** で sha256 する。
 * F-SAF-002: custom アレルギーの name/aliases を載せ、生成中の差し替え TOCTOU を検出する。
 * 自由文そのものはログに出さず、ハッシュ入力のみ。
 */
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
        // name 昇順・aliases 昇順で安定化（SQL string_agg order と同型）
        customAllergies: [...member.customAllergies]
          .map((entry) => ({
            name: entry.name,
            aliases: [...entry.aliases].sort((a, b) => a.localeCompare(b)),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        requiredSafetyConstraints: [...member.requiredSafetyConstraints].sort(),
        unsupportedDietStatus: member.unsupportedDietStatus,
        unsupportedDietKinds: [...member.unsupportedDietKinds].sort(),
      }))
      .sort((left, right) => left.householdMemberId.localeCompare(right.householdMemberId)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
