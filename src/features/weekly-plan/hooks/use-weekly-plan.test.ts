import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const getWeeklyPlanByIdMock = vi.hoisted(() => vi.fn());
const postWeeklyPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../weekly-plan-api.js", () => ({
  getWeeklyPlanById: getWeeklyPlanByIdMock,
  postWeeklyPlan: postWeeklyPlanMock,
}));

import { useCreateWeeklyPlan, useWeeklyPlan } from "./use-weekly-plan.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

// こちらも .length(7) を通す必要がある（hooks は API 関数経由で parse される）。
const sampleDays = Array.from({ length: 7 }, (_, index) => ({
  dayIndex: index + 1,
  label: `${String(index + 1)}日目`,
  mainName: "肉じゃが",
  ingredients: ["じゃがいも", "牛肉"],
}));

const sampleResult = {
  weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  weekStartJst: "2026-09-07",
  days: sampleDays,
  targetMemberIds: [],
  cuisineGenre: "japanese" as const,
  partialHousehold: false,
  staleSafety: false,
};

beforeEach(() => {
  getWeeklyPlanByIdMock.mockReset();
  postWeeklyPlanMock.mockReset();
});

describe("useWeeklyPlan", () => {
  it("fetches by id", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(sampleResult);
    const { result } = renderHook(
      () => useWeeklyPlan("tok", "33333333-3333-4333-8333-333333333333"),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.weeklyPlanId).toBe(sampleResult.weeklyPlanId);
  });
});

describe("useCreateWeeklyPlan", () => {
  it("posts and returns the result", async () => {
    postWeeklyPlanMock.mockResolvedValue(sampleResult);
    const { result } = renderHook(() => useCreateWeeklyPlan("tok"), { wrapper });
    const created = await result.current.mutateAsync({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
      cuisineGenre: "japanese",
      budgetPreference: null,
      noveltyPreference: null,
    });
    expect(created.weeklyPlanId).toBe(sampleResult.weeklyPlanId);
  });
});
