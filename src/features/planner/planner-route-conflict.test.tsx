import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { householdKeys } from "@/features/household/household-queries";
import { pantryKeys } from "@/features/pantry/pantry-api";
import { privacyKeys } from "@/features/privacy/privacy-queries";
import { DraftRevisionConflictError, plannerKeys } from "./planner-api";

const userId = "72000000-0000-4000-8000-000000000001";
const memberId = "70000000-0000-4000-8000-000000000001";
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
    notice_version: "2026-07-11.v1",
  });
  return render(
    <MemoryRouter initialEntries={["/planner"]}>
      <QueryClientProvider client={queryClient}>
        <PlannerPage startGeneration={vi.fn()} />
        <CurrentPath />
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
 * review step 内の任意条件から編集するため、details を開いておく。
 */
async function openReviewOptionalDetails(): Promise<void> {
  await act(async () => Promise.resolve());
  fireEvent.click(screen.getByText("追加条件"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => vi.useRealTimers());

it("retained cache の refetch 完了だけでは入力を置換せず明示操作後だけ最新行へ切り替える", async () => {
  const deferredRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock.mockReturnValue(deferredRefetch.promise);
  savePlannerDraftMock
    .mockRejectedValueOnce(new DraftRevisionConflictError())
    .mockImplementation((next: PlannerDraftInput, revision: number) =>
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
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();

  await act(async () => {
    deferredRefetch.resolve(revisionTwo);
    await deferredRefetch.promise;
    await Promise.resolve();
  });

  // Plan 2 §5: refetch 完了だけではローカル入力を置換しない。明示操作後だけ最新行へ切替える。
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
  await act(async () => Promise.resolve());
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  const resolveButton = screen.getByRole("button", { name: "最新の下書きを読み込む" });
  expect(resolveButton).toBeEnabled();

  fireEvent.click(resolveButton);
  await act(async () => Promise.resolve());

  expect(screen.getByLabelText("自由メモ")).toHaveValue("revision 2");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "最新の下書きを読み込む" })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("自由メモ"), {
    target: { value: "revision 2 から編集" },
  });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(savePlannerDraftMock).toHaveBeenLastCalledWith(
    {},
    userId,
    expect.objectContaining({ memo: "revision 2 から編集" }),
    2,
  );
});

it("競合 refetch の失敗後は再取得できないことを alert で示し、入力を保持したまま再試行できる", async () => {
  const retryRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock
    .mockRejectedValueOnce(new Error("refetch failed"))
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

  expect(screen.getByRole("alert")).toHaveTextContent("最新の下書きを取得できませんでした。");
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
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

it("緊急献立への移動前の保存失敗では遷移せず生成と同じ保存エラーを表示する", async () => {
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
  expect(screen.getByRole("alert")).toHaveTextContent(
    "献立条件を保存できなかったため、生成を開始しませんでした。",
  );
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeEnabled();
});
