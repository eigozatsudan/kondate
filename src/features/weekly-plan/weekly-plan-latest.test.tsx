import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLatestWeeklyPlanId,
  latestWeeklyPlanQueryKey,
  useLatestWeeklyPlan,
} from "./weekly-plan-latest";

const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

beforeEach(() => {
  getBrowserSupabaseClientMock.mockReset();
});

describe("latest weekly plan query", () => {
  it("separates cache entries by user and JST week", () => {
    expect(latestWeeklyPlanQueryKey("u1", "2026-09-07")).not.toEqual(
      latestWeeklyPlanQueryKey("u2", "2026-09-07"),
    );
    expect(latestWeeklyPlanQueryKey("u1", "2026-09-07")).not.toEqual(
      latestWeeklyPlanQueryKey("u1", "2026-09-14"),
    );
  });

  it("selects the latest owner row for the current week and validates its id", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const secondEq = vi.fn(() => ({ order }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    getBrowserSupabaseClientMock.mockReturnValue({ from: vi.fn(() => ({ select })) });

    await expect(getLatestWeeklyPlanId("u1", "2026-09-07")).resolves.toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(firstEq).toHaveBeenCalledWith("user_id", "u1");
    expect(secondEq).toHaveBeenCalledWith("week_start", "2026-09-07");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("fails closed for a malformed id and exposes a retryable query error", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "bad" }, error: null });
    const chain = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle })) })),
          })),
        })),
      })),
    };
    getBrowserSupabaseClientMock.mockReturnValue({ from: vi.fn(() => chain) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLatestWeeklyPlan("u1", "2026-09-07"), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});
