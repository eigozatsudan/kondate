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
 * 辞書の中身（alias 集合）の sha256 hex。
 * 辞書の版の文字列を据え置いたまま alias 行だけを足す・消す・変えるマイグレーションでも、
 * 保存済み献立の stale 判定や生成中の TOCTOU 検出が働くよう、fingerprint に含める。
 *
 * SQL private.current_safety_fingerprint / public.shopping_safety_fingerprint と byte 一致させる:
 * - 行は (allergenId, normalizedAlias, aliasKind, requiresLabelConfirmation) の 4 項目だけ。
 *   表示用の alias 原文と版は含めない（版は payload の dictionaryVersion が担う）。
 * - 並びは allergenId → normalizedAlias の COLLATE "C" 昇順（compareFingerprintText）。
 *   (allergen_id, normalized_alias, dictionary_version) は DB 上一意なので全順序になる。
 * - SQL は jsonb を使わず to_json のスカラー連結で直列化する（jsonb はキーを長さ→バイト順に
 *   並べ替え、区切りに空白を入れるため）。ここでも JSON.stringify の空白無し出力を使い、
 *   キーは下の宣言順（SQL の連結順と同じ）になる。
 * context の aliases は get_current_safety_snapshot が現行版だけに絞り、validateSnapshot が
 * 全行の版一致を検査済みなので、ここでは版で絞り直さない。
 */
export function createAllergenDictionaryDigest(
  aliases: CurrentSafetyContext["allergenDictionary"]["aliases"],
): string {
  const rows = [...aliases]
    .sort(
      (left, right) =>
        compareFingerprintText(left.allergenId, right.allergenId) ||
        compareFingerprintText(left.normalizedAlias, right.normalizedAlias),
    )
    .map((row) => ({
      allergenId: row.allergenId,
      normalizedAlias: row.normalizedAlias,
      aliasKind: row.aliasKind,
      requiresLabelConfirmation: row.requiresLabelConfirmation,
    }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
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
    // 版の文字列だけでは alias 行の追補を検出できないため、辞書の中身のハッシュも含める。
    dictionaryDigest: createAllergenDictionaryDigest(context.allergenDictionary.aliases),
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
