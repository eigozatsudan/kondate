/**
 * 課金の日時（ISO-8601・offset 付き）を JST の「2026年10月23日」形式にする。
 * null や解釈できない値は null を返し、呼び出し側は何も出さない（推測しない）。
 * Plus LP と設定のプラン節で同じ書式を使う。
 */
export function formatBillingDate(iso: string | null): string | null {
  if (iso === null) return null;
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "long",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * これから来る日時だけを整形する。現在時刻以前（同時刻を含む）や解釈できない値は null。
 * webhook の遅れで古い期間末・無料期間の終了が残っていても、過去の日付を断言しないために使う。
 */
export function formatUpcomingBillingDate(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms <= now.getTime()) return null;
  return formatBillingDate(iso);
}

/**
 * これから来る終了の日時を、使える最後の日として整形する（「X日まで」の X）。
 * 期間末は「その時刻から使えない」境界なので、1ms 前の JST の日付にする。
 * 例: 2026-10-22T15:00Z（10/23 0:00 JST）は「2026年10月22日」。
 * 「X日に終了します」だと X 日も使えると読まれうるため（最終レビュー B Minor 3）。
 * 現在時刻以前（同時刻を含む）や解釈できない値は null。
 */
export function formatUpcomingBillingLastDay(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms <= now.getTime()) return null;
  return formatBillingDate(new Date(ms - 1).toISOString());
}
