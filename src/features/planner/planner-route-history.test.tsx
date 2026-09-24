import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { householdKeys } from "@/features/household/household-queries";
import { pantryKeys } from "@/features/pantry/pantry-api";
import { privacyKeys } from "@/features/privacy/privacy-queries";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { PageHeadingFocusContext } from "@/shared/ui/page-heading-focus";
import { plannerKeys } from "./planner-api";
import {
  registerPlannerLeaveFlush,
  resetPlannerLeaveNavigateFlightForTests,
} from "./planner-leave-flush";
import { plannerLastStepSessionKey } from "./planner-resume";

/**
 * UX フォローアップ B: 実物の MemoryRouter で履歴を積み、端末の戻る（navigate(-1) = POP）を再現する。
 * - B-1: 緊急献立などからの ?resume=start は最初の未回答の質問を開き、戻るでホームへ戻る
 * - B-2: 「続きから答える」は最後に開いていた質問へ戻る
 * - B-3: ホームから開いたウィザードは、戻るでホームへ戻る（ホームで戻るならプランナーの外へ）
 */

const userId = "73000000-0000-4000-8000-000000000001";
const memberId = "70000000-0000-4000-8000-000000000001";

vi.mock("@/features/household/household-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/household/household-api")>();
  const uid = "73000000-0000-4000-8000-000000000001";
  const mid = "70000000-0000-4000-8000-000000000001";
  return {
    ...original,
    listHouseholdMembers: vi.fn(() => [
      {
        id: mid,
        user_id: uid,
        display_name: "子ども",
        status: "complete" as const,
        age_band: "age_3_5" as const,
        portion_size: null,
        spice_level: null,
        ease_preferences: [],
        required_safety_constraints: [],
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
        unsupported_diet_kinds: [],
        sort_order: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    ]),
    listAllergenCatalog: vi.fn(() => []),
    listMemberAllergies: vi.fn(() => []),
  };
});
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return {
    ...original,
    listPantryItems: vi.fn(() => Promise.resolve([])),
  };
});

const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const savePlannerDraftMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: userId } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("./planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./planner-api")>();
  return {
    ...original,
    getPlannerDraft: getPlannerDraftMock,
    savePlannerDraft: savePlannerDraftMock,
  };
});

import { PlannerPage } from "./planner-route";

/** 必須の質問（食事〜作る相手）をすべて答えた下書き。最初の未回答は確認画面になる */
const completeDraft: PlannerDraft = {
  id: "71000000-0000-4000-8000-000000000009",
  userId,
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "household",
  targetMemberIds: [memberId],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  ingredientPreference: null,
  noveltyPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
  revision: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/** 食事だけ答えた下書き。最初の未回答は「2. メイン食材」 */
const mealOnlyDraft: PlannerDraft = {
  ...completeDraft,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
};

let navigateForTest: ReturnType<typeof useNavigate> | null = null;

function HistoryProbe() {
  const location = useLocation();
  navigateForTest = useNavigate();
  return <output data-testid="current-url">{`${location.pathname}${location.search}`}</output>;
}

function renderPlanner(
  draft: PlannerDraft | null,
  initialEntries: string[],
  requestPageHeadingFocus: () => void = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  getPlannerDraftMock.mockResolvedValue(draft);
  savePlannerDraftMock.mockImplementation(
    (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
      Promise.resolve({ ...(draft ?? completeDraft), ...next, revision: revision + 1 }),
  );
  queryClient.setQueryData(plannerKeys.draft(userId), draft);
  queryClient.setQueryData([...householdKeys.members(userId), "planner-safety"], {
    members: [
      {
        id: memberId,
        displayName: "子ども",
        ageBandLabel: "3〜5歳",
        allergyLabel: "アレルギーなし",
        safetyLabels: [],
        blockedReason: null,
      },
    ],
    eligibleMemberIds: [memberId],
  });
  queryClient.setQueryData(pantryKeys.list(userId), []);
  queryClient.setQueryData(privacyKeys.current(userId), {
    user_id: userId,
    notice_version: "2026-07-29.v1",
  });
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <PageHeadingFocusContext.Provider value={requestPageHeadingFocus}>
            <Routes>
              <Route path="/planner" element={<PlannerPage startGeneration={vi.fn()} />} />
              <Route path="*" element={<p>プランナーの外</p>} />
            </Routes>
            <HistoryProbe />
          </PageHeadingFocusContext.Provider>
        </AppToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function currentUrl(): string {
  return screen.getByTestId("current-url").textContent;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** 端末の戻る（popstate）と同じ POP 遷移 */
async function pressBack(): Promise<void> {
  await act(async () => {
    await navigateForTest?.(-1);
  });
  await settle();
}

/** 下の「献立」タブと同じ、同じ /planner への PUSH */
async function pressPlannerTab(): Promise<void> {
  await act(async () => {
    await navigateForTest?.("/planner");
  });
  await settle();
}

/** fake timers の下でも待たずに済むよう、描画を落ち着かせてから同期で探して押す */
async function click(name: string): Promise<void> {
  await settle();
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  navigateForTest = null;
});

afterEach(() => {
  registerPlannerLeaveFlush(null);
  resetPlannerLeaveNavigateFlightForTests();
});

describe("B-2: 続きから答える は最後に開いていた質問へ戻る", () => {
  it("reopens the optional question that was open, not the review screen", async () => {
    renderPlanner(completeDraft, ["/planner"]);
    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();

    // 確認画面から 1 つ戻って任意の質問（8. 献立の雰囲気）を見ている途中でタブを押す
    await click("戻る");
    expect(screen.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeInTheDocument();
    await pressPlannerTab();
    expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText("必須の質問はすべて答えています。答えかけの質問から続けられます。"),
    ).toBeInTheDocument();

    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeInTheDocument();
  });

  it("remembers only the step name per user across remounts", async () => {
    sessionStorage.setItem(plannerLastStepSessionKey(userId), "budget");
    renderPlanner(completeDraft, ["/planner"]);
    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "6. 予算" })).toBeInTheDocument();
    expect(sessionStorage.getItem(plannerLastStepSessionKey(userId))).toBe("budget");
  });

  it("falls back to the first unanswered question when the remembered step is ahead of it", async () => {
    sessionStorage.setItem(plannerLastStepSessionKey(userId), "budget");
    renderPlanner(mealOnlyDraft, ["/planner"]);
    expect(await screen.findByText("1 / 9 まで答えています")).toBeInTheDocument();
    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
  });

  it("falls back to the first unanswered question when the remembered value is invalid", async () => {
    sessionStorage.setItem(plannerLastStepSessionKey(userId), "not-a-step");
    renderPlanner(completeDraft, ["/planner"]);
    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
  });
});

describe("B-3: ホームから開いたウィザードは端末の戻るでホームへ戻る", () => {
  it("returns to the planner home and asks for heading focus", async () => {
    const requestFocus = vi.fn();
    renderPlanner(completeDraft, ["/history", "/planner"], requestFocus);
    await click("続きから答える");
    expect(currentUrl()).toBe("/planner?resume=home");
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();

    await pressBack();
    expect(currentUrl()).toBe("/planner");
    expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
    expect(requestFocus).toHaveBeenCalledTimes(1);

    // ホームで戻るなら従来どおりプランナーの外へ
    await pressBack();
    expect(currentUrl()).toBe("/history");
    expect(screen.getByText("プランナーの外")).toBeInTheDocument();
  });

  it("also pushes the entry for 今日の献立をつくる and 最初から", async () => {
    renderPlanner(null, ["/history", "/planner"]);
    await click("今日の献立をつくる");
    expect(currentUrl()).toBe("/planner?resume=home");
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    await pressBack();
    expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
  });

  it("opens 最初から at the first question and goes back to the home", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPlanner(completeDraft, ["/history", "/planner"]);
    await click("最初から");
    expect(currentUrl()).toBe("/planner?resume=home");
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    await pressBack();
    expect(currentUrl()).toBe("/planner");
    expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
  });

  it("keeps an unsaved answer when back closes the wizard, and autosave still saves it", async () => {
    vi.useFakeTimers();
    try {
      renderPlanner(completeDraft, ["/history", "/planner"]);
      await click("続きから答える");
      const summary = screen.getByText("追加条件");
      const details = summary.closest("details");
      if (details !== null && !details.hasAttribute("open")) fireEvent.click(summary);
      fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "戻る前の入力" } });

      await pressBack();
      expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(savePlannerDraftMock).toHaveBeenCalledWith(
        {},
        userId,
        expect.objectContaining({ memo: "戻る前の入力" }),
        1,
      );

      await click("続きから答える");
      const reopenedSummary = screen.getByText("追加条件");
      const reopenedDetails = reopenedSummary.closest("details");
      if (reopenedDetails !== null && !reopenedDetails.hasAttribute("open")) {
        fireEvent.click(reopenedSummary);
      }
      expect(screen.getByLabelText("自由メモ")).toHaveValue("戻る前の入力");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the home and normalizes the URL when a fresh visit lands on the wizard marker", async () => {
    renderPlanner(completeDraft, ["/generation", "/planner?resume=home"]);
    expect(
      await screen.findByRole("heading", { name: "今日の献立", level: 1 }),
    ).toBeInTheDocument();
    expect(currentUrl()).toBe("/planner");
    await pressBack();
    expect(currentUrl()).toBe("/generation");
  });

  it("keeps ?resume=review from the privacy round trip as is", async () => {
    renderPlanner(completeDraft, ["/privacy", "/planner?resume=review"]);
    expect(await screen.findByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/planner?resume=review");
    await pressBack();
    expect(currentUrl()).toBe("/privacy");
  });
});

describe("B-1: ?resume=start は最初の未回答の質問を直接開き、戻るでホームへ", () => {
  it("opens the first unanswered question without the home and returns to the home on back", async () => {
    renderPlanner(mealOnlyDraft, ["/emergency-menus", "/planner?resume=start"]);
    expect(await screen.findByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/planner?resume=home");

    await pressBack();
    expect(currentUrl()).toBe("/planner");
    expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();

    await pressBack();
    expect(currentUrl()).toBe("/emergency-menus");
  });

  it("opens the meal question when there is no draft yet", async () => {
    renderPlanner(null, ["/emergency-menus", "/planner?resume=start"]);
    expect(await screen.findByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    expect(currentUrl()).toBe("/planner?resume=home");
  });
});
