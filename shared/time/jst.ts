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
 * PE12 / PE-R5: 入力がローカル今日のときだけ JST と揃える。
 * 遅れ TZ（local < jst）は JST 今日へ進める（即期限切れを避ける）。
 * 進み TZ（local > jst）は巻き戻さない（入力表示と保存を一致させる）。
 * パッケージ記載の他日はそのまま。
 */
export function alignDateInputTodayToJst(
  value: string,
  localToday: string,
  jstToday: string,
): string {
  if (value === localToday && localToday < jstToday) {
    return jstToday;
  }
  return value;
}

export function alignLocalDateInputToJstDay(value: string, now: Date): string {
  return alignDateInputTodayToJst(value, getLocalDateKey(now), getJstDateKey(now));
}

export function getNextJstMidnight(now: Date): Date {
  return new Date(`${getJstDateKey(now)}T15:00:00.000Z`);
}
