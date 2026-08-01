/**
 * planner 確認・対象選択向けのアレルギー開示ラベルと選択可否。
 * status=none でも未解決残存があれば「アレルギーなし」に落とさない（P3 / H2 整合）。
 */

export type PlannerAllergyDisclosureInput = {
  allergyStatus: "none" | "registered" | "unconfirmed" | null;
  /** カタログ／custom 名が解決できた表示名 */
  allergyNames: readonly string[];
  /** カタログ欠落 id・custom_confirmed かつ name 欠落など、表示できない残存件数 */
  unresolvedAllergyCount: number;
};

export type PlannerAllergyDisclosure = {
  allergyLabel: string;
  /**
   * 既存 blockedReason（未確認・医療など）に載せる前のアレルギー起因ブロック。
   * null ならアレルギー理由では止めない。
   */
  allergyBlockedReason: string | null;
};

const unresolvedOnlyLabel = "名前を表示できないアレルギー項目があります";
const unresolvedBlockReason = "アレルギー名を確認できないため、この家族では献立を作れません";

/**
 * 解決済み名を優先し、未解決のみ／未解決主体では「なし」と誤開示しない。
 * registered で名前 0 件も選択不可（表示名だけの有無要約を出さない）。
 */
export function resolvePlannerAllergyDisclosure(
  input: PlannerAllergyDisclosureInput,
): PlannerAllergyDisclosure {
  const { allergyStatus, allergyNames, unresolvedAllergyCount } = input;
  const hasResolved = allergyNames.length > 0;
  const hasUnresolved = unresolvedAllergyCount > 0;

  if (hasResolved) {
    return {
      allergyLabel: hasUnresolved
        ? `${allergyNames.join("・")}（ほか名前を表示できない項目あり）`
        : allergyNames.join("・"),
      // 一部解決時は label で under-disclosure を明示し、選択は維持（サーバは allergen id で照合）
      allergyBlockedReason: null,
    };
  }

  // 名前が1件も解決できない残存がある: status に関わらず「なし」へ落とさない
  if (hasUnresolved) {
    return {
      allergyLabel: unresolvedOnlyLabel,
      allergyBlockedReason: unresolvedBlockReason,
    };
  }

  if (allergyStatus === "none") {
    return { allergyLabel: "アレルギーなし", allergyBlockedReason: null };
  }
  if (allergyStatus === "unconfirmed") {
    return { allergyLabel: "アレルギー未確認", allergyBlockedReason: null };
  }
  // registered かつ解決名 0・未解決 0（空登録）: 有無だけの要約を避け選択不可
  return {
    allergyLabel: unresolvedOnlyLabel,
    allergyBlockedReason: unresolvedBlockReason,
  };
}
