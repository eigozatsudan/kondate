export type JstSeason = "spring" | "summer" | "autumn" | "winter";

export type SeasonContext = {
  month: number;
  season: JstSeason;
  labelJa: "春" | "夏" | "秋" | "冬";
};

const labelBySeason: Record<JstSeason, SeasonContext["labelJa"]> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

function jstMonth(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
  }).formatToParts(now);
  const month = parts.find((part) => part.type === "month")?.value;
  if (month === undefined) throw new Error("jst_month_unavailable");
  return Number(month);
}

function seasonForMonth(month: number): JstSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/**
 * JST カレンダー月に基づく季節。
 * 生成プロンプトの権威ある now は Function 側で渡す（クライアントは表示用のみ）。
 */
export function getJstSeasonContext(now: Date): SeasonContext {
  const month = jstMonth(now);
  const season = seasonForMonth(month);
  return { month, season, labelJa: labelBySeason[season] };
}
