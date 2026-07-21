import { useQuery } from "@tanstack/react-query";
import { getUsageToday } from "../api/usage-today-api";

/** JST 暦日キー（Asia/Tokyo）。queryKey の日次境界に使う。 */
export function jstDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function usageTodayQueryKey(userId: string, jstDay: string = jstDayKey()) {
  return ["usage-today", userId, jstDay] as const;
}

/** プランナーと終端パネルが共有する当日利用状況クエリ。 */
export function useUsageToday(userId: string) {
  return useQuery({
    queryKey: usageTodayQueryKey(userId),
    queryFn: () => getUsageToday(),
    staleTime: 30_000,
    enabled: userId.length > 0,
  });
}
