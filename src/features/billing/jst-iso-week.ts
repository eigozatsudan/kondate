/**
 * JST の ISO 週キー `YYYY-Www`（週は月曜始まり、ISO 週番号）。
 * flyer_upsell_week の localStorage 値に使う。
 */
export function jstIsoWeekKey(now: Date = new Date()): string {
  // Asia/Tokyo の暦日へ寄せてから UTC 日付として ISO 週を計算する。
  const jstParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(jstParts.find((p) => p.type === "year")?.value);
  const month = Number(jstParts.find((p) => p.type === "month")?.value);
  const day = Number(jstParts.find((p) => p.type === "day")?.value);
  // 正午 UTC 固定で DST やローカル TZ の影響を避ける（JST 暦日の週計算用）
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // ISO: 木曜日が属する年が週の年。週番号は 1 始まり。
  const dayOfWeek = utcNoon.getUTCDay(); // 0=Sun … 6=Sat
  const isoDow = dayOfWeek === 0 ? 7 : dayOfWeek; // 1=Mon … 7=Sun
  // 同じ週の木曜日へ移動
  utcNoon.setUTCDate(utcNoon.getUTCDate() + (4 - isoDow));
  const isoYear = utcNoon.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1, 12, 0, 0));
  const week = Math.floor((utcNoon.getTime() - yearStart.getTime()) / 86_400_000 / 7) + 1;
  return `${String(isoYear)}-W${String(week).padStart(2, "0")}`;
}

export const FLYER_UPSELL_WEEK_KEY = "flyer_upsell_week" as const;
