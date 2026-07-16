import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { householdKeys } from "@/features/household/household-queries";
import { pantryKeys } from "@/features/pantry/pantry-api";
import { DraftRevisionConflictError, plannerKeys } from "./planner-api";

const userId = "72000000-0000-0000-0000-000000000001";
const memberId = "70000000-0000-0000-0000-000000000001";
const revisionOne: PlannerDraft = {
  id: "71000000-0000-0000-0000-000000000001",
  userId,
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMemberIds: [memberId],
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

const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const savePlannerDraftMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/auth-provider", () => ({
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
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PlannerPage startGeneration={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
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
  await act(async () => Promise.resolve());

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
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeDisabled();

  await act(async () => {
    deferredRefetch.resolve(revisionTwo);
    await deferredRefetch.promise;
    await Promise.resolve();
  });

  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "最新の下書きを読み込む" }));

  expect(screen.getByLabelText("自由メモ")).toHaveValue("revision 2");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeEnabled();

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

it("競合 refetch の失敗後に再試行しても明示読込までは retained 入力を保つ", async () => {
  const retryRefetch = createDeferred<PlannerDraft>();
  getPlannerDraftMock
    .mockRejectedValueOnce(new Error("refetch failed"))
    .mockReturnValueOnce(retryRefetch.promise);
  savePlannerDraftMock.mockRejectedValueOnce(new DraftRevisionConflictError());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.change(screen.getByLabelText("自由メモ"), { target: { value: "Aの入力" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  await act(async () => Promise.resolve());

  expect(screen.getByRole("alert")).toHaveTextContent("最新の下書きを取得できませんでした。");
  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  await act(async () => {
    retryRefetch.resolve(revisionTwo);
    await retryRefetch.promise;
    await Promise.resolve();
  });

  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeEnabled();
});

it("緊急献立へ移動する前に保存結果を同じQueryClientの下書きcacheへ反映する", async () => {
  getPlannerDraftMock.mockResolvedValue(revisionOne);
  savePlannerDraftMock.mockResolvedValue(revisionTwo);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  renderRetainedDraft(queryClient);
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  await act(async () => Promise.resolve());

  expect(savePlannerDraftMock).toHaveBeenCalledTimes(1);
  expect(queryClient.getQueryData(plannerKeys.draft(userId))).toEqual(revisionTwo);
});
