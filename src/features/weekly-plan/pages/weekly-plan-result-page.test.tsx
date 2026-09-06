import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WeeklyPlanResultPage } from "./weekly-plan-result-page";

const getWeeklyPlanByIdMock = vi.hoisted(() => vi.fn());
const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());

vi.mock("../weekly-plan-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../weekly-plan-api")>();
  return { ...original, getWeeklyPlanById: getWeeklyPlanByIdMock };
});

vi.mock("../../planner/planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../planner/planner-api")>();
  return {
    ...original,
    getPlannerDraft: getPlannerDraftMock,
    savePlannerDraft: saveMock,
  };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

type SampleDay = {
  dayIndex: number;
  label: string;
  mainName: string;
  sideName: string | null;
  ingredients: string[];
  notes: string | null;
};

function makeDay(overrides: Partial<SampleDay> = {}): SampleDay {
  return {
    dayIndex: 1,
    label: "月",
    mainName: "鶏の照り焼き",
    sideName: null,
    ingredients: ["鶏もも肉"],
    notes: null,
    ...overrides,
  };
}

const dayLabels = ["月", "火", "水", "木", "金", "土", "日"];

const samplePlan = {
  weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  weekStartJst: "2026-09-07",
  days: [1, 2, 3, 4, 5, 6, 7].map((dayIndex) =>
    makeDay({
      dayIndex,
      label: dayLabels[dayIndex - 1]!,
    }),
  ),
  targetMemberIds: ["m1"],
  cuisineGenre: "japanese" as const,
  partialHousehold: false,
  staleSafety: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/weekly/33333333-3333-4333-8333-333333333333"]}>
        <WeeklyPlanResultPage
          accessToken="tok"
          weeklyPlanId={samplePlan.weeklyPlanId}
          userId="u1"
          currentCompleteMemberIds={["m1"]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WeeklyPlanResultPage", () => {
  it("renders 7 days and hands off a day to the planner draft", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue({ revision: 1 });

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("鶏の照り焼き")).toHaveLength(7);
    });
    const buttons = screen.getAllByRole("button", { name: "この日の献立を作る" });
    expect(buttons).toHaveLength(7);
    await userEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    const [, , input] = saveMock.mock.calls[0] as [unknown, string, { mealType: string }];
    expect(input.mealType).toBe("dinner");
  });

  it("shows the partialHousehold notice when true", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({ ...samplePlan, partialHousehold: true });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText("外した家族の条件は見ていません。全員分を作るには作り直してください"),
      ).toBeInTheDocument();
    });
  });

  it("shows the staleSafety notice when true, and keeps the day CTA enabled", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({ ...samplePlan, staleSafety: true });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText("家族の設定が変わっています。作り直してください"),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "この日の献立を作る" })[0]).toBeEnabled();
  });

  it("renders day notes only when present", async () => {
    const withNotes = {
      ...samplePlan,
      days: samplePlan.days.map((day: SampleDay, index: number) =>
        index === 0 ? { ...day, notes: "冷凍保存できます" } : day,
      ),
    };
    getWeeklyPlanByIdMock.mockResolvedValue(withNotes);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("冷凍保存できます")).toBeInTheDocument();
    });
    // 他の6日は notes が null なので描画されない
    expect(screen.queryAllByText("冷凍保存できます")).toHaveLength(1);
  });
});
