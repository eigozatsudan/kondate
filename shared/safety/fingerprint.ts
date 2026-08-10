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
 * locale 非依存の文字列昇順。
 * SQL 側は `ORDER BY … COLLATE "C"`（UTF-8 バイト順）で並べる。BMP 範囲では
 * Unicode 符号点順と一致し、JS の `<`/`>`（UTF-16 符号単位）とも一致する。
 * `localeCompare` は ICU/実行環境 locale 依存のため使わない（H4/S6）。
 */
export function compareFingerprintText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 現行安全 fingerprint。
 * SQL private.current_safety_fingerprint と **同一の JSON 形状** で sha256 する。
 * F-SAF-002: custom アレルギーの name/aliases を載せ、生成中の差し替え TOCTOU を検出する。
 * 自由文そのものはログに出さず、ハッシュ入力のみ。
 * customAllergies / aliases の並びは compareFingerprintText（SQL COLLATE "C" と同型）。
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
        allergenIds: [...member.allergenIds].sort(compareFingerprintText),
        hasUnmappedCustomAllergy: member.hasUnmappedCustomAllergy,
        // name 昇順・aliases 昇順で安定化（SQL string_agg / array_agg … COLLATE "C" と同型）
        customAllergies: [...member.customAllergies]
          .map((entry) => ({
            name: entry.name,
            aliases: [...entry.aliases].sort(compareFingerprintText),
          }))
          .sort((left, right) => compareFingerprintText(left.name, right.name)),
        requiredSafetyConstraints: [...member.requiredSafetyConstraints].sort(
          compareFingerprintText,
        ),
        unsupportedDietStatus: member.unsupportedDietStatus,
        unsupportedDietKinds: [...member.unsupportedDietKinds].sort(compareFingerprintText),
      }))
      .sort((left, right) =>
        compareFingerprintText(left.householdMemberId, right.householdMemberId),
      ),
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
