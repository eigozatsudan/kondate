import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { availableUsageTodayFixture } from "@shared/testing/factories";
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
    expect(await screen.findByRole("alert")).toHaveTextContent("この端末で作成を開始できません");
    expect(postWeeklyPlanMock).not.toHaveBeenCalled();
    getItem.mockRestore();
  });
});
