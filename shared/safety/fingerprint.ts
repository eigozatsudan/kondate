import { createHash } from "node:crypto";
import type { CurrentSafetyContext } from "./context.js";

/**
 * SQL private.current_safety_fingerprint は p_target_member_ids の ordinality で
 * member_1..N を採番する。再生成コンテキストは履歴 ref（member_2 等）を safety に
 * 載せたまま validate/prompt するため、finalize 用 fingerprint は ordinal 再採番後に取る。
 */
export function withSqlOrdinalAnonymousRefs(
  context: CurrentSafetyContext,
  targetMemberIdsInOrder: readonly string[],
): CurrentSafetyContext {
  const refById = new Map(
    targetMemberIdsInOrder.map((id, index) => [id, `member_${String(index + 1)}`] as const),
  );
  return {
    ...context,
    members: context.members.map((member) => {
      const ref = refById.get(member.householdMemberId);
      return ref === undefined ? member : { ...member, anonymousRef: ref };
    }),
  };
}

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

/**
 * finalize / succeed が SQL に渡す target 配列順と同一の ordinal ref で fingerprint する。
 */
export function createFinalizeSafetyFingerprint(
  context: CurrentSafetyContext,
  targetMemberIdsInOrder: readonly string[],
): string {
  return createCurrentSafetyFingerprint(
    withSqlOrdinalAnonymousRefs(context, targetMemberIdsInOrder),
  );
}
