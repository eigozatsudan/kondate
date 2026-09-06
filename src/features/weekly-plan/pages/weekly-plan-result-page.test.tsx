import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import { WeeklyPlanResultPage } from "./weekly-plan-result-page";
import { DraftRevisionConflictError, plannerKeys } from "../../planner/planner-api";

const getWeeklyPlanByIdMock = vi.hoisted(() => vi.fn());
const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

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

vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});

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
const dayMains = [
  "鶏の照り焼き",
  "豚肉の生姜焼き",
  "鮭の塩焼き",
  "麻婆豆腐",
  "カレーライス",
  "餃子",
  "おでん",
];

function makeSampleDays(): SampleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((dayIndex) =>
    makeDay({
      dayIndex,
      label: dayLabels[dayIndex - 1]!,
      mainName: dayMains[dayIndex - 1]!,
      ingredients: [`具材${String(dayIndex)}`],
    }),
  );
}

const samplePlan = {
  weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  weekStartJst: "2026-09-07",
  days: makeSampleDays(),
  targetMemberIds: ["m1"],
  cuisineGenre: "japanese" as const,
  partialHousehold: false,
  staleSafety: false,
};

function renderPage(options?: {
  currentCompleteMemberIds?: readonly string[];
  client?: QueryClient;
}) {
  const client =
    options?.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/weekly/33333333-3333-4333-8333-333333333333"]}>
        <WeeklyPlanResultPage
          accessToken="tok"
          weeklyPlanId={samplePlan.weeklyPlanId}
          userId="u1"
          currentCompleteMemberIds={options?.currentCompleteMemberIds ?? ["m1"]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WeeklyPlanResultPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 7 days and hands off a day to the planner draft", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue({ revision: 1 });

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("鶏の照り焼き")).toHaveLength(1);
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

  it("renders day headings sorted by dayIndex even when the API returns days out of order, and navigates to /planner after handoff", async () => {
    const shuffledPlan = { ...samplePlan, days: [...samplePlan.days].reverse() };
    getWeeklyPlanByIdMock.mockResolvedValue(shuffledPlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue({ revision: 1 });

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
    });
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(dayLabels);

    const buttons = screen.getAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/planner");
    });
  });

  it("hands off the confirmed day's data after an overwrite confirmation, not a stale one", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    // targetMode: "idea" は draftNeedsOverwriteConfirmation を無条件に true にする既存下書き
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });
    saveMock.mockResolvedValue({ revision: 6 });

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    expect(buttons).toHaveLength(7);
    await userEvent.click(buttons[6]!); // 7日目（日）

    const confirmButton = await screen.findByRole("button", { name: "置き換える" });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    const [, , input] = saveMock.mock.calls[0] as [unknown, string, { memo: string }];
    expect(input.memo).toBe(`主菜: ${dayMains[6]!}`);
  });

  it("shows an error when no household member is eligible for handoff", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    renderPage({ currentCompleteMemberIds: [] });

    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(
        screen.getByText("引き継ぎできる家族がいません。作り直してください。"),
      ).toBeInTheDocument();
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  // F-1: spec §4.3「日次と同じ安全性注記」。文言のハードコピーではなく共有定数で検証する。
  it("shows the shared safety disclaimer used by the daily/flyer menus", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(MENU_LABEL_DISCLAIMER)).toBeInTheDocument();
    });
  });

  // F-3: P-11 の主見出しが対象人数を表示すること
  it("shows the partial-household member count in the h1 when partialHousehold is true", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({
      ...samplePlan,
      partialHousehold: true,
      targetMemberIds: ["m1", "m2"],
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "2 人分の今週の献立" }),
      ).toBeInTheDocument();
    });
  });

  // F-4: I-1 で追加した invalidateQueries が実際に呼ばれること
  it("invalidates the planner draft query after a successful handoff", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue({ revision: 1 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderPage({ client });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: plannerKeys.draft("u1") });
    });
  });

  // F-4: DraftRevisionConflictError 時の1回リトライ
  it("retries the save once after a DraftRevisionConflictError, using the refreshed revision", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      targetMode: "household",
      mealType: "",
      mainIngredients: [],
      cuisineGenre: "",
      targetMemberIds: [],
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
      revision: 9,
    });
    saveMock
      .mockRejectedValueOnce(new DraftRevisionConflictError())
      .mockResolvedValueOnce({ revision: 10 });

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(2);
    });
    const secondCall = saveMock.mock.calls[1] as [unknown, string, unknown, number];
    expect(secondCall[3]).toBe(9);
  });
});
