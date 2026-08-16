const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getJstDateKey(now: Date): string {
  const parts: Record<"year" | "month" | "day", string> = { year: "", month: "", day: "" };
  for (const part of formatter.formatToParts(now)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      parts[part.type] = part.value;
    }
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** type=date と同じローカル暦日 YYYY-MM-DD。比較は JST と揃えない。 */
export function getLocalDateKey(now: Date): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * PE12: date 入力の「今日」がローカル暦日のとき、保存値を JST 今日へ揃える。
 * パッケージ記載の他日はそのまま（暦日ラベルをずらさない）。
 */
export function alignLocalDateInputToJstDay(value: string, now: Date): string {
  if (value === getLocalDateKey(now)) {
    return getJstDateKey(now);
  }
  return value;
}

export function getNextJstMidnight(now: Date): Date {
  return new Date(`${getJstDateKey(now)}T15:00:00.000Z`);
}
