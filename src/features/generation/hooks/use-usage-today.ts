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

/**
 * 次の JST 0:00 までのミリ秒。
 * JST は通年 UTC+9（DST なし）。サーバ日次枠（SQL JST）と queryKey を揃える（G12）。
 * ちょうど境界上は「次の」深夜＝1 日後を返す。
 */
export function msUntilNextJstMidnight(now: Date = new Date()): number {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const dayMs = 86_400_000;
  const jstEpochMs = now.getTime() + jstOffsetMs;
  const msIntoJstDay = ((jstEpochMs % dayMs) + dayMs) % dayMs;
  const remaining = dayMs - msIntoJstDay;
  return remaining === 0 ? dayMs : remaining;
}

export function usageTodayQueryKey(userId: string, jstDay: string = jstDayKey()) {
  return ["usage-today", userId, jstDay] as const;
}

/**
 * プランナーと終端パネルが共有する当日利用状況クエリ。
 * QUOTA-M1 / G12: アイドル中の JST 日跨ぎで queryKey が古いまま残らないよう、
 * 次の JST 深夜へ setTimeout し、保険として分単位 interval + focus/visibility でも再評価する。
 * 枠の権威は RPC 側（数値ロックは変更しない）。
 */
export function useUsageToday(userId: string) {
  const [jstDay, setJstDay] = useState(() => jstDayKey());
  useEffect(() => {
    const tick = (): void => {
      const next = jstDayKey();
      setJstDay((current) => (current === next ? current : next));
    };
    let boundaryTimer: number | undefined;
    const armBoundary = (): void => {
      // 境界直後の時計誤差を吸収する小さなスロップ（quota 値は不変）
      const delay = Math.min(msUntilNextJstMidnight() + 50, 86_400_000);
      boundaryTimer = window.setTimeout(() => {
        tick();
        armBoundary();
      }, delay);
    };
    armBoundary();
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (boundaryTimer !== undefined) window.clearTimeout(boundaryTimer);
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
