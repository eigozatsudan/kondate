import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
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
 * UX フォローアップ B: 実物の data router（createMemoryRouter + PlannerRoutePage の useBlocker）で
 * 履歴を並べ、端末の戻る（router.navigate(-1) = POP）を再現する。
 * - ウィザード用の履歴エントリは積まない。ウィザードが開いている間の戻るは blocker で止め、
 *   ウィザードを閉じてホームを出す。ホームでの戻るは止めない（外へ出るときは leave flush）。
 * - ?resume= はマウント時に一度だけ読み、URL を /planner へ置き換えて消す（開く step は state）
 * - B-1: ?resume=start は最初の未回答の質問を直接開き、戻るでホーム、もう一度でもとの画面へ
 * - B-2: 「続きから答える」は最後に開いていた質問へ戻る
 * - 献立タブ（AppShell の Link）は、同じ URL（/planner）への遷移を react-router が既定で replace
 *   する。ここでは同じ replace で再現する
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

import { PlannerRoutePage } from "./planner-route";

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

type TestRouter = ReturnType<typeof createMemoryRouter>;

function renderPlanner(
  draft: PlannerDraft | null,
  initialEntries: string[],
  requestPageHeadingFocus: () => void = vi.fn(),
): TestRouter {
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
  const router = createMemoryRouter(
    [
      { path: "/planner", element: <PlannerRoutePage /> },
      { path: "*", element: <p>プランナーの外</p> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <PageHeadingFocusContext.Provider value={requestPageHeadingFocus}>
          {/* アプリ（main.tsx）と同じく StrictMode で包む（effect の二重実行でも同じ結果になること） */}
          <StrictMode>
            <RouterProvider router={router} />
          </StrictMode>
        </PageHeadingFocusContext.Provider>
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

function currentUrl(router: TestRouter): string {
  return `${router.state.location.pathname}${router.state.location.search}`;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** 端末の戻る（popstate）と同じ POP 遷移 */
async function pressBack(router: TestRouter): Promise<void> {
  await act(async () => {
    await router.navigate(-1);
  });
  await settle();
}

/** 下の「献立」タブ。/planner に居るときは AppShell が replace で遷移する */
async function pressPlannerTab(router: TestRouter): Promise<void> {
  await act(async () => {
    await router.navigate("/planner", { replace: true });
  });
  await settle();
}

/** fake timers の下でも待たずに済むよう、描画を落ち着かせてから同期で探して押す */
async function click(name: string): Promise<void> {
  await settle();
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
}

function expectHome(): void {
  expect(screen.getByRole("heading", { name: "今日の献立", level: 1 })).toBeInTheDocument();
}

async function expectLeftPlannerTo(router: TestRouter, url: string): Promise<void> {
  await waitFor(() => {
    expect(currentUrl(router)).toBe(url);
  });
  expect(await screen.findByText("プランナーの外")).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  registerPlannerLeaveFlush(null);
  resetPlannerLeaveNavigateFlightForTests();
});

describe("B-2: 続きから答える は最後に開いていた質問へ戻る", () => {
  it("reopens the optional question that was open, not the review screen", async () => {
    const router = renderPlanner(completeDraft, ["/planner"]);
    await click("続きから答える");
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();

    // 確認画面から 1 つ戻って任意の質問（8. 献立の雰囲気）を見ている途中でタブを押す
    await click("戻る");
    expect(screen.getByRole("heading", { name: "8. 献立の雰囲気" })).toBeInTheDocument();
    await pressPlannerTab(router);
    expectHome();
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

describe("B-3: ウィザードが開いている間の戻るはホームへ、ホームでの戻るはプランナーの外へ", () => {
  it("closes the wizard on back without adding history entries, then leaves on the next back", async () => {
    const requestFocus = vi.fn();
    const router = renderPlanner(completeDraft, ["/history", "/planner"], requestFocus);
    await click("続きから答える");
    expect(currentUrl(router)).toBe("/planner");
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();

    await pressBack(router);
    expect(currentUrl(router)).toBe("/planner");
    expectHome();
    expect(requestFocus).toHaveBeenCalledTimes(1);

    // ホームで戻るなら従来どおりプランナーの外へ（空振りしない）
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });

  it("does the same for 今日の献立をつくる", async () => {
    const router = renderPlanner(null, ["/history", "/planner"]);
    await click("今日の献立をつくる");
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    await pressBack(router);
    expectHome();
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });

  it("does the same for 最初から", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = renderPlanner(completeDraft, ["/history", "/planner"]);
    await click("最初から");
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    await pressBack(router);
    expectHome();
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });

  it("does not reopen the wizard on back after the planner tab returned to the home", async () => {
    const router = renderPlanner(completeDraft, ["/history", "/planner"]);
    await click("続きから答える");
    await pressPlannerTab(router);
    expectHome();
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });

  it("does not add entries when the resume button is pressed twice", async () => {
    const router = renderPlanner(completeDraft, ["/history", "/planner"]);
    await settle();
    const resume = screen.getByRole("button", { name: "続きから答える" });
    fireEvent.click(resume);
    fireEvent.click(resume);
    await settle();
    await pressBack(router);
    expectHome();
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });

  it("keeps an unsaved answer when back closes the wizard, and autosave still saves it", async () => {
    vi.useFakeTimers();
    try {
      const router = renderPlanner(completeDraft, ["/history", "/planner"]);
      await click("続きから答える");
      const summary = screen.getByText("追加条件");
      const details = summary.closest("details");
      if (details !== null && !details.hasAttribute("open")) fireEvent.click(summary);
      fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "戻る前の入力" } });

      await pressBack(router);
      expectHome();
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

  // privacy の「確認して進む」は returnTo（/planner?resume=review）へ replace で戻り、生成の
  // 「条件を直してやり直す」も /generation を /planner?resume=review へ置き換える。どちらも直前の
  // entry はウィザードを開いたホーム（/planner）なので、実際の履歴は [外, /planner, ?resume=review]。
  it.each([
    ["privacy の確認から returnTo へ戻ったあと", "/history"],
    ["生成の「条件を直してやり直す」のあと", "/menus/menu-1"],
  ])("consumes ?resume=review on mount and leaves in two backs (%s)", async (_label, outside) => {
    const router = renderPlanner(completeDraft, [outside, "/planner", "/planner?resume=review"]);
    expect(await screen.findByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
    // 開いたままでも URL には ?resume= を残さない
    await waitFor(() => {
      expect(currentUrl(router)).toBe("/planner");
    });
    expect(screen.getByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
    // 戻る 1 回目: 直前の /planner（同じ pathname）へ移り、ウィザードを閉じてホーム
    await pressBack(router);
    expectHome();
    expect(currentUrl(router)).toBe("/planner");
    // 戻る 2 回目: 空振りせずプランナーの外へ（592ab27a と同じ回数）
    await pressBack(router);
    await expectLeftPlannerTo(router, outside);
  });

  it("returns to the home with the planner tab after ?resume= was consumed, then leaves", async () => {
    const router = renderPlanner(completeDraft, ["/history", "/planner?resume=review"]);
    expect(await screen.findByRole("heading", { name: "9. 確認" })).toBeInTheDocument();
    await waitFor(() => {
      expect(currentUrl(router)).toBe("/planner");
    });
    await pressPlannerTab(router);
    expectHome();
    await pressBack(router);
    await expectLeftPlannerTo(router, "/history");
  });
});

describe("B-1: ?resume=start は最初の未回答の質問を直接開き、戻るでホームへ", () => {
  it("opens the first unanswered question, returns to the home, then to the emergency page", async () => {
    const router = renderPlanner(mealOnlyDraft, ["/emergency-menus", "/planner?resume=start"]);
    expect(await screen.findByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    await waitFor(() => {
      expect(currentUrl(router)).toBe("/planner");
    });
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();

    await pressBack(router);
    expectHome();
    expect(currentUrl(router)).toBe("/planner");

    await pressBack(router);
    await expectLeftPlannerTo(router, "/emergency-menus");
  });

  it("returns to the emergency page in two backs after the CTA was tapped twice", async () => {
    // 描画の遅い端末での二度タップ: 古い Link が 2 回 push し、?resume=start の entry が 2 つ積まれる
    const router = renderPlanner(mealOnlyDraft, [
      "/emergency-menus",
      "/planner?resume=start",
      "/planner?resume=start",
    ]);
    expect(await screen.findByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    await waitFor(() => {
      expect(currentUrl(router)).toBe("/planner");
    });

    // 戻る 1 回目: 残っていた ?resume=start の entry に着く。開き直さずホームにして /planner へ置き換える
    await pressBack(router);
    await waitFor(() => {
      expect(currentUrl(router)).toBe("/planner");
    });
    expectHome();
    expect(screen.queryByRole("heading", { name: "2. メイン食材" })).not.toBeInTheDocument();

    await pressBack(router);
    await expectLeftPlannerTo(router, "/emergency-menus");
  });

  it("opens the meal question when there is no draft yet", async () => {
    renderPlanner(null, ["/emergency-menus", "/planner?resume=start"]);
    expect(await screen.findByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
  });
});
