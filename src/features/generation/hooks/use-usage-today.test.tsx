import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUsageTodayMock = vi.hoisted(() => vi.fn());

vi.mock("../api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));

import {
  jstDayKey,
  msUntilNextJstMidnight,
  plusUsageRefetchIntervalMs,
  usageTodayQueryKey,
  useUsageToday,
} from "./use-usage-today";

describe("useUsageToday", () => {
  beforeEach(() => {
    getUsageTodayMock.mockReset();
    getUsageTodayMock.mockResolvedValue({
      plan: "free" as const,
      plusEntitled: false,
      success: { consumed: 0, limit: 3, remaining: 3 },
      attempts: { sent: 0, limit: 6, remaining: 6 },
      shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
      quality: {
        day: { consumed: 0, limit: 3, remaining: 3 },
        month: { consumed: 0, limit: 20, remaining: 20 },
        available: false,
      },
      flyerWeekly: {
        successConsumed: 0,
        successLimit: 2,
        successRemaining: 2,
        triesConsumed: 0,
        triesLimit: 6,
        triesRemaining: 6,
        weekStartJst: "2026-07-27",
      },
      globalAvailable: true,
      retryAt: null,
    });
  });

  it("uses the locked query key shape and loads usage", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const userId = "10000000-0000-4000-8000-000000000001";
    const { result } = renderHook(() => useUsageToday(userId), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.success.remaining).toBe(3);
    expect(usageTodayQueryKey(userId)).toEqual(["usage-today", userId, jstDayKey()]);
  });

  it("PE10: Plus usage refetches on focus and while entitled so upload UI does not stick", async () => {
    getUsageTodayMock.mockResolvedValue({
      plan: "plus" as const,
      plusEntitled: true,
      success: { consumed: 0, limit: 10, remaining: 10 },
      attempts: { sent: 0, limit: 20, remaining: 20 },
      shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
      quality: {
        day: { consumed: 0, limit: 3, remaining: 3 },
        month: { consumed: 0, limit: 20, remaining: 20 },
        available: true,
      },
      flyerWeekly: {
        successConsumed: 0,
        successLimit: 2,
        successRemaining: 2,
        triesConsumed: 0,
        triesLimit: 6,
        triesRemaining: 6,
        weekStartJst: "2026-07-27",
      },
      globalAvailable: true,
      retryAt: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const userId = "10000000-0000-4000-8000-000000000001";
    const { result } = renderHook(() => useUsageToday(userId), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const cached = client.getQueryCache().find({ queryKey: usageTodayQueryKey(userId) });
    expect(cached).toBeDefined();
    const options = cached?.options as {
      staleTime?: number;
      refetchOnWindowFocus?: unknown;
      refetchInterval?: (query: unknown) => number | false;
    };
    expect(options.staleTime).toBe(0);
    expect(options.refetchOnWindowFocus).toBe("always");
    expect(typeof options.refetchInterval).toBe("function");
    if (cached !== undefined && typeof options.refetchInterval === "function") {
      expect(options.refetchInterval(cached)).toBe(plusUsageRefetchIntervalMs);
      expect(plusUsageRefetchIntervalMs).toBe(3_000);
    }
  });

  it("G12: msUntilNextJstMidnight shrinks toward JST midnight and is under one day", () => {
    // 2026-07-29 14:59:50 UTC = JST 23:59:50 → 残り約 10s
    const nearBoundary = new Date("2026-07-29T14:59:50.000Z");
    expect(msUntilNextJstMidnight(nearBoundary)).toBe(10_000);
    // 2026-07-29 15:00:00 UTC = JST 0:00 ちょうど → 次の深夜まで 1 日
    const onBoundary = new Date("2026-07-29T15:00:00.000Z");
    expect(msUntilNextJstMidnight(onBoundary)).toBe(86_400_000);
    // 正午 JST = 03:00 UTC → 残り 12h
    const noonJst = new Date("2026-07-29T03:00:00.000Z");
    expect(msUntilNextJstMidnight(noonJst)).toBe(12 * 60 * 60 * 1000);
  });
});
