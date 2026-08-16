import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { householdKeys } from "@/features/household/household-queries";
import { pantryKeys } from "@/features/pantry/pantry-api";
import { privacyKeys } from "@/features/privacy/privacy-queries";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { DraftRevisionConflictError, plannerKeys } from "./planner-api";
import {
  PLANNER_LEAVE_FLUSH_TIMEOUT_MS,
  registerPlannerLeaveFlush,
  resetPlannerLeaveNavigateFlightForTests,
  runPlannerLeaveFlush,
} from "./planner-leave-flush";

const userId = "72000000-0000-4000-8000-000000000001";
const memberId = "70000000-0000-4000-8000-000000000001";

// P11/P12: safety・pantry の staleTime:0 で mount 再取得が走るため API をモックする
vi.mock("@/features/household/household-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/household/household-api")>();
  const uid = "72000000-0000-4000-8000-000000000001";
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
const revisionOne: PlannerDraft = {
  id: "71000000-0000-4000-8000-000000000001",
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
  avoidIngredients: [],
  memo: "revision 1",
  pantrySelections: [],
  revision: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
const revisionTwo: PlannerDraft = {
  ...revisionOne,
  mealType: "lunch",
  mainIngredients: ["鮭"],
  memo: "revision 2",
  revision: 2,
  updatedAt: "2026-07-01T01:00:00.000Z",
};
const revisionThree: PlannerDraft = {
  ...revisionTwo,
  memo: "revision 3",
  revision: 3,
  updatedAt: "2026-07-01T02:00:00.000Z",
};

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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function renderRetainedDraft(queryClient: QueryClient) {
  queryClient.setQueryData(plannerKeys.draft(userId), revisionOne);
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
  // audience step の incomplete「次へ」等が useAppToast を使うため Provider 必須（P5 再整列）
  return render(
    <MemoryRouter initialEntries={["/planner"]}>
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <PlannerPage startGeneration={vi.fn()} />
          <CurrentPath />
        </AppToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

/**
 * revisionOne は4質問+household回答が完成しているため、resumeは review step に
 * 直接入る（firstIncompletePlannerStep）。conflict系テストは「自由メモ」を
 * review step 内の任意条件から編集するため、閉じているときだけ開く。
 * （追加条件はデフォルト展開。再クリックで閉じないよう open を確認する）
 */
async function openReviewOptionalDetails(): Promise<void> {
  await act(async () => Promise.resolve());
  const summary = screen.getByText("追加条件");
  const details = summary.closest("details");
  if (details !== null && !details.hasAttribute("open")) {
    fireEvent.click(summary);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  registerPlannerLeaveFlush(null);
  resetPlannerLeaveNavigateFlightForTests();
  vi.useRealTimers();
});

it("retained cache の refetch 完了だけでは入力を置換せず明示操作後だけ最新行へ切り替える", async () => {
  // P4: isSaving は autosave saving を載せない。競合 UI は onConflict→hasDraftConflict で止める。
  // onConflict の refetch が hang すると解決ボタンが固着するため live 行を即返す。
  getPlannerDraftMock.mockResolvedValue(revisionTwo);
  savePlannerDraftMock
    .mockRejectedValueOnce(new DraftRevisionConflictError())
    // savePlannerDraft(client, userId, input, revision) の実シグネチャに合わせる
    .mockImplementation(
      (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
        Promise.resolve({ ...revisionTwo, ...next, revision: revision + 1 }),
    );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await openReviewOptionalDetails();

  fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "Aの入力" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(savePlannerDraftMock).toHaveBeenCalledWith(
    {},
    userId,
    expect.objectContaining({ memo: "Aの入力" }),
    1,
  );
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  // conflict → live 確認 → onConflict。microtask で hasDraftConflict が立つまで待つ
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();

  // Plan 2 §5: refetch 完了だけではローカル入力を置換しない。明示操作後だけ最新行へ切替える。
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
  await act(async () => Promise.resolve());
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  const resolveButton = screen.getByRole("button", { name: "最新の下書きを読み込む" });
  expect(resolveButton).toBeEnabled();

  fireEvent.click(resolveButton);
  // P1: resetToken 強制保存の microtask 完了まで待つ（revision 2 → 3）
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByLabelText("自由メモ")).toHaveValue("revision 2");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "最新の下書きを読み込む" })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("自由メモ"), {
    target: { value: "revision 2 から編集" },
  });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  // resolveDraftConflict は resetToken を上げるため P1 が最新行を expected=2 で強制保存し revision が 3 へ進む。
  // その後のユーザー編集は expected=3 で送る（旧期待 2 は P1 以前）。
  expect(savePlannerDraftMock).toHaveBeenLastCalledWith(
    {},
    userId,
    expect.objectContaining({ memo: "revision 2 から編集" }),
    3,
  );
});

it("P5: 競合解決で incomplete な最新下書きを読むと firstIncomplete step へ再整列する", async () => {
  const incompleteLatest: PlannerDraft = {
    ...revisionTwo,
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    memo: "incomplete latest",
  };
  const deferredRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock.mockReturnValue(deferredRefetch.promise);
  savePlannerDraftMock
    .mockRejectedValueOnce(new DraftRevisionConflictError())
    .mockImplementation(
      (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
        Promise.resolve({ ...incompleteLatest, ...next, revision: revision + 1 }),
    );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await openReviewOptionalDetails();

  // review 上にいることを確認
  expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "Aの入力" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  await act(async () => {
    deferredRefetch.resolve(incompleteLatest);
    await deferredRefetch.promise;
    await Promise.resolve();
  });

  fireEvent.click(screen.getByRole("button", { name: "最新の下書きを読み込む" }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // incomplete audience → audience step（review に incomplete を残さない）
  expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "5. 確認" })).not.toBeInTheDocument();
});

it("競合 refetch の失敗後は再取得できないことを alert で示し、入力を保持したまま再試行できる", async () => {
  const retryRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock
    // onConflict の loadLatestConflictDraft
    .mockRejectedValueOnce(new Error("refetch failed"))
    // 競合 chrome の再試行
    .mockReturnValueOnce(retryRefetch.promise);
  savePlannerDraftMock.mockRejectedValueOnce(new DraftRevisionConflictError());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await openReviewOptionalDetails();

  fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "Aの入力" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  await act(async () => Promise.resolve());

  // 保存失敗と競合 refetch 失敗の alert が同時に出得るため、文言で特定する
  expect(screen.getByText("最新の下書きを取得できませんでした。")).toBeInTheDocument();
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeDisabled();

  // 競合 chrome の「再試行」は autosave の再試行と併存し得る。競合文言の近くを使う。
  const conflictRetry = screen
    .getByText("最新の下書きを取得できませんでした。")
    .parentElement?.querySelector("button");
  expect(conflictRetry).toBeTruthy();
  fireEvent.click(conflictRetry as HTMLButtonElement);
  await act(async () => Promise.resolve());
  expect(getPlannerDraftMock).toHaveBeenCalledTimes(2);

  await act(async () => {
    retryRefetch.resolve(revisionTwo);
    await retryRefetch.promise;
    await Promise.resolve();
  });
  // 再試行成功後も明示解決までは入力を保持する。
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeEnabled();
});

it("献立を作る操作前に保存結果を同じQueryClientの下書きcacheへ反映する", async () => {
  getPlannerDraftMock.mockResolvedValue(revisionOne);
  savePlannerDraftMock.mockResolvedValue(revisionTwo);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "献立を作る" }));
  await act(async () => Promise.resolve());

  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
});

it("保存中に開始した古い下書き再取得が完了しても保存結果を逆行させない", async () => {
  const deferredSave = createDeferred<PlannerDraft>();
  const deferredRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock.mockReturnValue(deferredRefetch.promise);
  savePlannerDraftMock.mockReturnValue(deferredSave.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "献立を作る" }));
  await act(async () => Promise.resolve());
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  const lateRefetch = queryClient.fetchQuery({
    queryKey: plannerKeys.draft(userId),
    queryFn: () => deferredRefetch.promise,
    staleTime: 0,
  });
  await act(async () => Promise.resolve());

  await act(async () => {
    deferredSave.resolve(revisionTwo);
    await deferredSave.promise;
  });
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);

  await act(async () => {
    deferredRefetch.resolve(revisionOne);
    await deferredRefetch.promise;
    await lateRefetch.catch(() => undefined);
  });

  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
});

it("保存応答より新しいcacheがある場合は上書きも生成開始もせず競合として扱う", async () => {
  const deferredSave = createDeferred<PlannerDraft>();
  getPlannerDraftMock.mockResolvedValue(revisionThree);
  savePlannerDraftMock.mockReturnValue(deferredSave.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "献立を作る" }));
  await act(async () => Promise.resolve());
  queryClient.setQueryData(plannerKeys.draft(userId), revisionThree);

  await act(async () => {
    deferredSave.resolve(revisionTwo);
    await deferredSave.promise;
    await Promise.resolve();
  });

  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionThree);
  expect(screen.getByTestId("current-path")).toHaveTextContent("/planner");
  expect(
    screen.getByRole("heading", { name: "下書きが別の画面で更新されました" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/現在の入力を保持しています/u)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
});

it("緊急献立は保存完了を待ってから /emergency-menus へ一度だけ遷移する", async () => {
  const deferredSave = createDeferred<PlannerDraft>();
  getPlannerDraftMock.mockResolvedValue(revisionOne);
  savePlannerDraftMock.mockReturnValue(deferredSave.promise);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  const emergencyButton = screen.getByRole("button", { name: "AIを使わない緊急献立を見る" });
  fireEvent.click(emergencyButton);
  fireEvent.click(emergencyButton);
  await act(async () => Promise.resolve());

  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("current-path")).toHaveTextContent("/planner");
  expect(emergencyButton).toBeDisabled();
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();

  await act(async () => {
    deferredSave.resolve(revisionTwo);
    await deferredSave.promise;
    await Promise.resolve();
  });

  expect(screen.getByTestId("current-path")).toHaveTextContent("/emergency-menus");
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
});

it("緊急献立への移動前の保存失敗では遷移せず緊急専用の保存エラーを表示する", async () => {
  getPlannerDraftMock.mockResolvedValue(revisionOne);
  savePlannerDraftMock.mockRejectedValueOnce(new Error("save failed"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  await act(async () => Promise.resolve());

  expect(screen.getByTestId("current-path")).toHaveTextContent("/planner");
  // C-I14: 生成失敗文言と区別し、緊急献立を開けなかったことを伝える（全文一致）
  expect(
    screen.getByText(
      "条件を保存できなかったため、緊急献立を開けませんでした。通信を確認して再度お試しください。",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/生成を開始しませんでした/u)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeEnabled();
});

it("生成後 soft-delete で live 下書きが無い revision conflict は undelete せず競合 chrome を出す", async () => {
  // 成功生成後は draft が soft-delete され revision が進む。stale cache の旧 revision で
  // save すると conflict になる。live 行が null でも rev=0 undelete すると、他タブの
  // 未送信/旧条件が live 正本として復活する（P6）。競合 chrome へ寄せる。
  getPlannerDraftMock.mockResolvedValue(null);
  savePlannerDraftMock.mockRejectedValueOnce(new DraftRevisionConflictError());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());

  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(savePlannerDraftMock.mock.calls[0]?.[3]).toBe(1);
  expect(screen.getByTestId("current-path")).toHaveTextContent("/planner");
  expect(
    screen.getByRole("heading", { name: "下書きが別の画面で更新されました" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/緊急献立を開けませんでした/u)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeEnabled();
});

it("P4: live 下書きが null の競合解決は rev=0 force save / undelete しない", async () => {
  // 生成成功後は RLS で getPlannerDraft が null。解決 CTA は empty を表示するだけ。
  // resetToken / baseline=0 すると save_generation_draft が deleted 行を undelete する。
  getPlannerDraftMock.mockResolvedValue(null);
  savePlannerDraftMock
    .mockRejectedValueOnce(new DraftRevisionConflictError())
    .mockImplementation(
      (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) =>
        Promise.resolve({ ...revisionOne, ...next, revision: revision + 1 }),
    );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await openReviewOptionalDetails();

  fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "Aの入力" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(
    screen.getByRole("heading", { name: "下書きが別の画面で更新されました" }),
  ).toBeInTheDocument();
  const resolveButton = screen.getByRole("button", { name: "最新の下書きを読み込む" });
  expect(resolveButton).toBeEnabled();

  fireEvent.click(resolveButton);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "下書きが別の画面で更新されました" }),
  ).not.toBeInTheDocument();
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(savePlannerDraftMock.mock.calls.every((call) => call[3] !== 0)).toBe(true);
});

it("P2: timeout 後の再 leave は進行中 flush に join し自タブ連番を競合にしない", async () => {
  // flushDraft に排他が無いと、timeout 後の再 leave が N+2 を cache に書いたあと
  // 先行 N+1 の revision 比較が自タブ連番を競合と誤認する。
  let resolveFirst: ((draft: PlannerDraft) => void) | undefined;
  savePlannerDraftMock.mockImplementation(
    (_client: unknown, _userId: string, next: PlannerDraftInput, revision: number) => {
      if (resolveFirst === undefined) {
        return new Promise<PlannerDraft>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ...revisionOne,
        ...next,
        revision: revision + 1,
        updatedAt: "2026-07-01T03:00:00.000Z",
      });
    },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  const firstLeave = runPlannerLeaveFlush();
  await act(async () => Promise.resolve());
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
  });
  await expect(firstLeave).resolves.toBe("blocked");

  const secondLeave = runPlannerLeaveFlush();
  await act(async () => Promise.resolve());
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirst?.({
      ...revisionOne,
      revision: 2,
      updatedAt: "2026-07-01T03:00:00.000Z",
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(secondLeave).resolves.toBe("proceed");
  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("heading", { name: "下書きが別の画面で更新されました" }),
  ).not.toBeInTheDocument();
});
