import { useEffect, useState } from "react";
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

/**
 * プランナーと終端パネルが共有する当日利用状況クエリ。
 * QUOTA-M1: アイドル中の JST 日跨ぎで queryKey が古いまま残らないよう、
 * 分単位で暦日キーを再評価する。
 */
export function useUsageToday(userId: string) {
  const [jstDay, setJstDay] = useState(() => jstDayKey());
  useEffect(() => {
    const tick = (): void => {
      const next = jstDayKey();
      setJstDay((current) => (current === next ? current : next));
    };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return useQuery({
    queryKey: usageTodayQueryKey(userId, jstDay),
    queryFn: () => getUsageToday(),
    staleTime: 30_000,
    enabled: userId.length > 0,
  });
}
