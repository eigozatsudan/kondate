import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUsageTodayMock = vi.hoisted(() => vi.fn());

vi.mock("../api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));

import { jstDayKey, usageTodayQueryKey, useUsageToday } from "./use-usage-today";

describe("useUsageToday", () => {
  beforeEach(() => {
    getUsageTodayMock.mockReset();
    getUsageTodayMock.mockResolvedValue({
      success: { consumed: 0, limit: 5, remaining: 5 },
      attempts: { sent: 0, limit: 12, remaining: 12 },
      shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
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
    expect(result.current.data?.success.remaining).toBe(5);
    expect(usageTodayQueryKey(userId)).toEqual(["usage-today", userId, jstDayKey()]);
  });
});
