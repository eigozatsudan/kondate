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

export function getNextJstMidnight(now: Date): Date {
  return new Date(`${getJstDateKey(now)}T15:00:00.000Z`);
}
