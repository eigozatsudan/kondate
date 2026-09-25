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
 * 課金の日時を JST の「2026年10月23日 14:32」形式（24 時間表記の HH:MM）にする。
 * 終了の瞬間を示すために使う（UX 残り R3 M-2 でユーザーが決めた形）。日付の部分は
 * formatBillingDate と同じ書式。null や解釈できない値は null。
 */
export function formatBillingDateTime(iso: string | null): string | null {
  const date = formatBillingDate(iso);
  if (iso === null || date === null) return null;
  try {
    const time = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
    return `${date} ${time}`;
  } catch {
    return null;
  }
}

/**
 * これから来る終了の日時を「日付 時刻」で整形する。現在時刻以前（同時刻を含む）や
 * 解釈できない値は null（過去の日時を断言しない。formatUpcomingBillingDate と同じ扱い）。
 */
export function formatUpcomingBillingDateTime(iso: string | null, now: Date): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms <= now.getTime()) return null;
  return formatBillingDateTime(iso);
}
