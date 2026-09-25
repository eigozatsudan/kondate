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
import { medicalRequestBlockedMessage } from "@/features/planner/components/review-step";

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
    requiredSafetyConstraints: [],
    blockedReason: null,
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    displayName: "こども",
    ageBandLabel: "幼児",
    allergyLabel: "なし",
    safetyLabels: [],
    requiredSafetyConstraints: [],
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

    expect(screen.getByText("今週はあと 2 回つくれます（週 2 回まで）")).toBeInTheDocument();
    expect(
      screen.getByText("うまくいかなかった分も含めて、今週はあと 6 回まで試せます"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/使い切りました/)).not.toBeInTheDocument();
    expect(screen.queryByText(/やり直し/)).not.toBeInTheDocument();
    expect(screen.queryByText(/成功/)).not.toBeInTheDocument();
    expect(screen.queryByText(/試行 /)).not.toBeInTheDocument();
    expect(screen.queryByText(/チラシ献立と共通/)).not.toBeInTheDocument();
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
    expect(screen.getByText("今週の分は使い切りました")).toBeInTheDocument();
    // 成功枠が尽きたら試せる回数の行は出さない（押せないのに「試せます」と並べない）
    expect(screen.queryByText(/試せます/)).not.toBeInTheDocument();
    expect(screen.queryByText(/今週試せる回数を使い切りました/)).not.toBeInTheDocument();
    expect(screen.queryByText(/チラシ献立と共通/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/週次枠は2026年8月3日（月）から新しい週になります/),
    ).toBeInTheDocument();
  });

  it("shows the tries-only exhausted note when only tries remaining is 0", () => {
    useUsageTodayMock.mockReturnValue({
      data: {
        ...availableUsageTodayFixture,
        flyerWeekly: {
          ...availableUsageTodayFixture.flyerWeekly,
          triesRemaining: 0,
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole("button", { name: "今週の献立をつくる" })).toBeDisabled();
    // 使い切りの文は 1 回だけ。「あと n 回つくれます」「あと 0 回まで試せます」と並べない
    expect(
      screen.getAllByText(
        "今週試せる回数を使い切りました。うまくいかなかった回も数えるため、つくれる回数が残っていても今週はもう作れません。",
      ),
    ).toHaveLength(1);
    expect(screen.queryByText(/つくれます/)).not.toBeInTheDocument();
    expect(screen.queryByText(/試せます/)).not.toBeInTheDocument();
    expect(screen.queryByText("今週の分は使い切りました")).not.toBeInTheDocument();
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

  it("submits priorityIngredients added via the free-text input", async () => {
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText("食材名");
    await user.type(input, "鶏むね肉");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.type(input, " キャベツ ");
    await user.keyboard("{Enter}");

    // 追加済みチップが見え、先後どちらの追加経路でも登録されている
    expect(screen.getByRole("button", { name: "鶏むね肉を外す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キャベツを外す" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    const body = (postWeeklyPlanMock.mock.calls[0] as [string, WeeklyPlanRequest])[1];
    // NFKC+trim はモデル側で済んでいる（空白は送信しない）
    expect(body.priorityIngredients).toEqual(["鶏むね肉", "キャベツ"]);
  });

  it("rejects a duplicate priority ingredient without posting", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText("食材名");
    await user.type(input, "豆腐");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.type(input, " 豆腐 ");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "同じ食材はすでに追加されています。",
    );
    expect(screen.getAllByRole("button", { name: "豆腐を外す" })).toHaveLength(1);
  });

  it("rejects an empty priority ingredient", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "食材名を入力してから追加してください。",
    );
    expect(postWeeklyPlanMock).not.toHaveBeenCalled();
  });

  it("rejects a priority ingredient over the per-item character limit", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText("食材名");
    await user.type(input, "あ".repeat(81));
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("食材は1件80文字までです。");
    expect(screen.queryByRole("button", { name: /を外す/u })).not.toBeInTheDocument();
  });

  it("rejects a ninth priority ingredient", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText("食材名");
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      await user.type(input, name);
      await user.click(screen.getByRole("button", { name: "追加" }));
    }
    await user.type(input, "i");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("食材は8件までです。");
    expect(screen.getAllByRole("button", { name: /を外す/u })).toHaveLength(8);
  });

  it("removes a priority ingredient chip", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("食材名"), "豆腐");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.click(screen.getByRole("button", { name: "豆腐を外す" }));

    expect(screen.queryByRole("button", { name: "豆腐を外す" })).not.toBeInTheDocument();
  });

  it("blocks submission when a priority ingredient is a medical-scope request", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("食材名"), "離乳食");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));

    // 表示文言は日次 review と同じ共有定数（部分一致ではなく全文一致で文言変更を捕捉する）
    expect(await screen.findByRole("alert")).toHaveTextContent(medicalRequestBlockedMessage);
    // 送信も pending メタデータの保存も起きない
    expect(postWeeklyPlanMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("weekly-plan-request-metadata")).toBeNull();
  });
});
