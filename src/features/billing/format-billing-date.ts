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
