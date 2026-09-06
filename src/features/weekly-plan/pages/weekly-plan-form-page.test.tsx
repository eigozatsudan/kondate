import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENERATION_IN_PROGRESS_RETRY_MS } from "@/features/generation/hooks/use-generation-recovery";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { availableUsageTodayFixture } from "@shared/testing/factories";
import type { WeeklyPlanRequest } from "@shared/contracts/weekly-plan";
import { WeeklyPlanApiError } from "../weekly-plan-api";
import { WeeklyPlanFormPage } from "./weekly-plan-form-page";

const postWeeklyPlanMock = vi.hoisted(() => vi.fn());
const useUsageTodayMock = vi.hoisted(() => vi.fn());
const useLatestWeeklyPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../weekly-plan-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../weekly-plan-api")>();
  return { ...actual, postWeeklyPlan: postWeeklyPlanMock };
});
vi.mock("@/features/generation/hooks/use-usage-today", () => ({
  useUsageToday: useUsageTodayMock,
}));
vi.mock("../weekly-plan-latest", () => ({
  useLatestWeeklyPlan: useLatestWeeklyPlanMock,
}));

const members = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    displayName: "本人",
    ageBandLabel: "大人",
    allergyLabel: "なし",
    safetyLabels: [],
    blockedReason: null,
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    displayName: "こども",
    ageBandLabel: "幼児",
    allergyLabel: "なし",
    safetyLabels: [],
    blockedReason: null,
  },
] as const;

function renderPage(overrides: Partial<React.ComponentProps<typeof WeeklyPlanFormPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderTree = (props: Partial<React.ComponentProps<typeof WeeklyPlanFormPage>>) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/weekly"]}>
        <AppToastProvider>
          <Routes>
            <Route
              path="/weekly"
              element={
                <WeeklyPlanFormPage
                  accessToken="tok"
                  userId="user-1"
                  eligibleMembers={members}
                  unsatisfiableMemberIds={[]}
                  {...props}
                />
              }
            />
            <Route path="/weekly/:id" element={<p>週献立結果</p>} />
          </Routes>
        </AppToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(renderTree(overrides));
  return {
    ...result,
    rerenderPage: (props: Partial<React.ComponentProps<typeof WeeklyPlanFormPage>>) => {
      result.rerender(renderTree(props));
    },
  };
}

beforeEach(() => {
  sessionStorage.clear();
  postWeeklyPlanMock.mockReset();
  useUsageTodayMock.mockReturnValue({
    data: availableUsageTodayFixture,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  useLatestWeeklyPlanMock.mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WeeklyPlanFormPage", () => {
  it("submits all complete members with sticky defaults and prevents a second submit", async () => {
    let resolveRequest: ((value: { weeklyPlanId: string }) => void) | undefined;
    postWeeklyPlanMock.mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)),
    );
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/成功 2 \/ 2、試行 6 \/ 6/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "今週の献立をつくっています" }));
    expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    const [, body] = postWeeklyPlanMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      targetMemberIds: members.map((member) => member.id),
      cuisineGenre: "any",
      budgetPreference: null,
      noveltyPreference: null,
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
    expect(sessionStorage.getItem("weekly-plan-idempotency-key")).toBe(body.idempotencyKey);
    if (resolveRequest !== undefined) {
      resolveRequest({ weeklyPlanId: "33333333-3333-4333-8333-333333333333" });
    }
    expect(await screen.findByText("週献立結果")).toBeInTheDocument();
  });

  it("shows an existing plan link for the current week", () => {
    useLatestWeeklyPlanMock.mockReturnValue({
      data: "33333333-3333-4333-8333-333333333333",
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole("link", { name: "今週の献立はあります" })).toHaveAttribute(
      "href",
      "/weekly/33333333-3333-4333-8333-333333333333",
    );
  });

  it("disables submission with a reason when either weekly quota is exhausted", () => {
    useUsageTodayMock.mockReturnValue({
      data: {
        ...availableUsageTodayFixture,
        flyerWeekly: {
          ...availableUsageTodayFixture.flyerWeekly,
          successConsumed: 2,
          successRemaining: 0,
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole("button", { name: "今週の献立をつくる" })).toBeDisabled();
    expect(screen.getByText(/作成上限に達しています/)).toBeInTheDocument();
    expect(
      screen.getByText(/週次枠は2026年8月3日（月）から新しい週になります/),
    ).toBeInTheDocument();
  });

  it("blocks while usage is loading and offers retry after a read failure", async () => {
    const refetch = vi.fn();
    useUsageTodayMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    renderPage();
    expect(screen.getByRole("button", { name: "今週の献立をつくる" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "残数を再読み込み" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("warns for unsatisfiable members and allows excluding them before submit", async () => {
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    const user = userEvent.setup();
    renderPage({ unsatisfiableMemberIds: [members[1].id] });
    expect(screen.getByText(/こどもの条件では週献立を作れません/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今週の献立をつくる" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /こども/ }));
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    expect(postWeeklyPlanMock.mock.calls[0]?.[1]).toMatchObject({
      targetMemberIds: [members[0].id],
    });
  });

  it("removes blocked and missing members from the submitted selection after prop updates", () => {
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    const { rerenderPage } = renderPage();
    useUsageTodayMock.mockReturnValue({
      data: availableUsageTodayFixture,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerenderPage({
      eligibleMembers: [{ ...members[0], blockedReason: "家族設定を確認してください" }],
    });
    expect(screen.getByRole("button", { name: "今週の献立をつくる" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /家族設定/ })).toBeInTheDocument();
  });

  it.each([
    ["weekly_plan_invalid_ai_response", false],
    ["generation_timeout", false],
    ["model_unavailable", false],
    ["weekly_plan_persist_failed", true],
    ["internal_error", true],
  ])("updates sticky storage for %s only when the request was consumed", async (code, retained) => {
    sessionStorage.setItem("weekly-plan-idempotency-key", "33333333-3333-4333-8333-333333333333");
    postWeeklyPlanMock.mockRejectedValue(new WeeklyPlanApiError(500, code, "作成失敗"));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("作成失敗");
    expect(sessionStorage.getItem("weekly-plan-idempotency-key") !== null).toBe(retained);
  });

  it("handles storage failures inside the page", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("この端末で");
    expect(postWeeklyPlanMock).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("does not POST when storing new request metadata fails", async () => {
    const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "weekly-plan-request-metadata") throw new DOMException("blocked");
      originalSetItem(key, value);
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(postWeeklyPlanMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("この端末で作成を開始できません");
  });

  it("navigates after success even when storing success metadata fails", async () => {
    const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "weekly-plan-request-metadata" && value.includes('"status":"succeeded"')) {
        throw new DOMException("blocked");
      }
      originalSetItem(key, value);
    });
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(await screen.findByText("週献立結果")).toBeInTheDocument();
  });

  it("keeps the API error actionable when metadata removal fails", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    postWeeklyPlanMock.mockRejectedValue(
      new WeeklyPlanApiError(400, "weekly_plan_invalid_ai_response", "確認できませんでした"),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("確認できませんでした");
    expect(screen.getByRole("button", { name: "新しい依頼として作り直す" })).toBeEnabled();
  });

  it("ignores a delayed success after unmount without updating storage", async () => {
    let resolveRequest: ((value: { weeklyPlanId: string }) => void) | undefined;
    postWeeklyPlanMock.mockImplementation(
      () => new Promise((resolve) => (resolveRequest = resolve)),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    const writesBeforeUnmount = setItem.mock.calls.length;
    unmount();
    await act(async () => {
      resolveRequest?.({ weeklyPlanId: "33333333-3333-4333-8333-333333333333" });
      await Promise.resolve();
    });
    expect(setItem).toHaveBeenCalledTimes(writesBeforeUnmount);
  });

  it("retries a retained request with its original payload after quota and members change", async () => {
    postWeeklyPlanMock.mockRejectedValueOnce(
      new WeeklyPlanApiError(500, "internal_error", "通信失敗"),
    );
    const user = userEvent.setup();
    const { rerenderPage } = renderPage();
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await screen.findByRole("alert");
    const originalBody = (postWeeklyPlanMock.mock.calls[0] as [string, WeeklyPlanRequest])[1];

    useUsageTodayMock.mockReturnValue({
      data: {
        ...availableUsageTodayFixture,
        flyerWeekly: {
          ...availableUsageTodayFixture.flyerWeekly,
          successConsumed: 2,
          successRemaining: 0,
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    postWeeklyPlanMock.mockResolvedValueOnce({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    rerenderPage({ eligibleMembers: [{ ...members[0], blockedReason: "確認が必要です" }] });
    await user.click(screen.getByRole("button", { name: "前回の依頼を再試行" }));

    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(2);
    });
    expect(postWeeklyPlanMock.mock.calls[1]?.[1]).toEqual(originalBody);
  });

  it("restores a successful result and rotates the key only on explicit new request", async () => {
    const oldKey = "33333333-3333-4333-8333-333333333333";
    sessionStorage.setItem("weekly-plan-idempotency-key", oldKey);
    sessionStorage.setItem(
      "weekly-plan-request-metadata",
      JSON.stringify({
        version: 1,
        ownerId: "user-1",
        status: "succeeded",
        request: {
          idempotencyKey: oldKey,
          targetMemberIds: members.map((member) => member.id),
          cuisineGenre: "any",
          budgetPreference: null,
          noveltyPreference: null,
        },
        resultId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("link", { name: "前回の献立を見る" })).toHaveAttribute(
      "href",
      "/weekly/44444444-4444-4444-8444-444444444444",
    );
    await user.click(screen.getByRole("button", { name: "新しい依頼を始める" }));
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "55555555-5555-4555-8555-555555555555",
    });
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    const newBody = (postWeeklyPlanMock.mock.calls[0] as [string, WeeklyPlanRequest])[1];
    expect(newBody.idempotencyKey).not.toBe(oldKey);
  });

  it("does not restore another owner's retained request", () => {
    sessionStorage.setItem(
      "weekly-plan-request-metadata",
      JSON.stringify({
        version: 1,
        ownerId: "other-user",
        status: "pending",
        request: {
          idempotencyKey: "33333333-3333-4333-8333-333333333333",
          targetMemberIds: [members[0].id],
          cuisineGenre: "any",
          budgetPreference: null,
          noveltyPreference: null,
        },
        resultId: null,
      }),
    );
    renderPage();
    expect(screen.queryByRole("button", { name: "前回の依頼を再試行" })).not.toBeInTheDocument();
  });

  it("discards malformed metadata without reusing its key", async () => {
    sessionStorage.setItem("weekly-plan-idempotency-key", "33333333-3333-4333-8333-333333333333");
    sessionStorage.setItem("weekly-plan-request-metadata", "{broken");
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "55555555-5555-4555-8555-555555555555",
    });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    const body = (postWeeklyPlanMock.mock.calls[0] as [string, WeeklyPlanRequest])[1];
    expect(body.idempotencyKey).not.toBe("33333333-3333-4333-8333-333333333333");
  });

  it("automatically retries 409 three times with the same payload then offers manual retry", async () => {
    vi.useFakeTimers();
    postWeeklyPlanMock.mockRejectedValue(
      new WeeklyPlanApiError(409, "generation_in_progress", "作成中です"),
    );
    renderPage();
    act(() => {
      screen.getByRole("button", { name: "今週の献立をつくる" }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GENERATION_IN_PROGRESS_RETRY_MS * 3);
    });
    expect(postWeeklyPlanMock).toHaveBeenCalledTimes(4);
    const bodies = postWeeklyPlanMock.mock.calls.map(
      (call) => (call as [string, WeeklyPlanRequest])[1],
    );
    expect(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
    expect(screen.getByRole("button", { name: "前回の依頼を再試行" })).toBeEnabled();
  });

  it("cancels a scheduled 409 retry when the owner changes", async () => {
    vi.useFakeTimers();
    postWeeklyPlanMock.mockRejectedValue(
      new WeeklyPlanApiError(409, "generation_in_progress", "作成中です"),
    );
    const { rerenderPage } = renderPage();
    act(() => {
      screen.getByRole("button", { name: "今週の献立をつくる" }).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    rerenderPage({ userId: "user-2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GENERATION_IN_PROGRESS_RETRY_MS * 2);
    });
    expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
  });

  it("stops 409 retries when a different error is returned", async () => {
    vi.useFakeTimers();
    postWeeklyPlanMock
      .mockRejectedValueOnce(new WeeklyPlanApiError(409, "generation_in_progress", "作成中です"))
      .mockRejectedValueOnce(new WeeklyPlanApiError(500, "internal_error", "失敗しました"));
    renderPage();
    act(() => {
      screen.getByRole("button", { name: "今週の献立をつくる" }).click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GENERATION_IN_PROGRESS_RETRY_MS * 3);
    });
    expect(postWeeklyPlanMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("失敗しました");
  });

  it("shows the weekly reset date for any 429 response", async () => {
    postWeeklyPlanMock.mockRejectedValue(
      new WeeklyPlanApiError(429, "some_other_limit", "上限です"),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(
      await screen.findByText(/週次枠は2026年8月3日（月）から新しい週になります/),
    ).toBeInTheDocument();
  });

  it("formats the next weekly boundary across a JST month boundary", () => {
    useUsageTodayMock.mockReturnValue({
      data: {
        ...availableUsageTodayFixture,
        flyerWeekly: {
          ...availableUsageTodayFixture.flyerWeekly,
          successConsumed: 2,
          successRemaining: 0,
          weekStartJst: "2026-09-28",
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(
      screen.getByText(/週次枠は2026年10月5日（月）から新しい週になります/),
    ).toBeInTheDocument();
  });

  it("shows recovery actions for a consumed 400 response", async () => {
    useLatestWeeklyPlanMock.mockReturnValue({
      data: "44444444-4444-4444-8444-444444444444",
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    postWeeklyPlanMock.mockRejectedValue(
      new WeeklyPlanApiError(400, "weekly_plan_invalid_ai_response", "確認できませんでした"),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(
      await screen.findByText("家族の条件に合わなくなりました。作り直してください"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前回の献立を見る" })).toBeInTheDocument();
  });

  it("presents one standard choice for each nullable preference", async () => {
    renderPage();
    expect(screen.getAllByRole("radio", { name: "標準" })).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "標準を指定" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("radio", { name: "標準" })[0]!);
  });

  it("shows the shared progress indicator and meter while creating", async () => {
    postWeeklyPlanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "0");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(document.querySelector(".gen-status-indicator")).toBeInTheDocument();
  });
});
