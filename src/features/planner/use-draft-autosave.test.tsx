import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { DraftRevisionConflictError } from "./planner-api";
import { useDraftAutosave } from "./use-draft-autosave";

const base: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMemberIds: [],
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

function saved(value: PlannerDraftInput, revision: number): PlannerDraft {
  return {
    id: "71000000-0000-0000-0000-000000000001",
    userId: "72000000-0000-0000-0000-000000000001",
    ...value,
    revision,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

afterEach(() => vi.useRealTimers());

it("600ms debounce の保存を直列化し DB revision を 1→2→3 と引き継ぐ", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender, result } = renderHook(
    ({ value }) => useDraftAutosave({ value, enabled: true, initialRevision: 1, save }),
    { initialProps: { value: base } },
  );

  rerender({ value: { ...base, mealType: "dinner" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  rerender({ value: { ...base, mealType: "dinner", memo: "野菜多め" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(result.current.revision).toBe(3);
});

it("サーバー下書きの hydration だけでは600ms後も保存しない", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  renderHook(() => useDraftAutosave({ value: base, enabled: true, initialRevision: 1, save }));

  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save).not.toHaveBeenCalled();
});

it("同じ下書きを2タブで hydration しても write も競合も発生しない", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const onConflict = vi.fn();
  renderHook(() =>
    useDraftAutosave({ value: base, enabled: true, initialRevision: 1, save, onConflict }),
  );
  renderHook(() =>
    useDraftAutosave({ value: base, enabled: true, initialRevision: 1, save, onConflict }),
  );

  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save).not.toHaveBeenCalled();
  expect(onConflict).not.toHaveBeenCalled();
});

it("サーバー baseline の再取得は保存せず、その後のユーザー編集だけを新 revision で保存する", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender } = renderHook(
    ({ value, initialRevision }) =>
      useDraftAutosave({ value, enabled: true, initialRevision, save }),
    { initialProps: { value: base, initialRevision: 1 } },
  );

  rerender({ value: base, initialRevision: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).not.toHaveBeenCalled();

  const edited = { ...base, memo: "再取得後の編集" };
  rerender({ value: edited, initialRevision: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledWith(edited, 2);
});

it("flush は保留中 timer を置換し最新値の DB row を返す", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const latest = { ...base, memo: "野菜を多めに" };
  const { rerender, result } = renderHook(
    ({ value }) => useDraftAutosave({ value, enabled: true, initialRevision: 4, save }),
    { initialProps: { value: base } },
  );
  rerender({ value: latest });

  let row: PlannerDraft | undefined;
  await act(async () => {
    row = await result.current.flush();
  });
  await act(async () => vi.runOnlyPendingTimersAsync());

  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(latest, 4);
  expect(row).toMatchObject({ memo: "野菜を多めに", revision: 5 });
});

it("先行保存中に600ms未満で unmount しても最新編集を同じ保存キューへ引き渡す", async () => {
  vi.useFakeTimers();
  let resolveFirst: ((draft: PlannerDraft) => void) | undefined;
  const save = vi.fn((value: PlannerDraftInput, revision: number) => {
    if (save.mock.calls.length === 1) {
      return new Promise<PlannerDraft>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve(saved(value, revision + 1));
  });
  const { rerender, unmount } = renderHook(
    ({ value }) => useDraftAutosave({ value, enabled: true, initialRevision: 1, save }),
    { initialProps: { value: base } },
  );

  const first = { ...base, memo: "先行保存" };
  rerender({ value: first });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  const edited = { ...base, memo: "離脱直前の編集" };
  rerender({ value: edited });
  await act(async () => vi.advanceTimersByTimeAsync(599));
  unmount();
  expect(save).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirst?.(saved(first, 2));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(1, first, 1);
  expect(save).toHaveBeenNthCalledWith(2, edited, 2);
});

it("競合後は refetch revision に古い表示値を再束縛せず flush も拒否する", async () => {
  vi.useFakeTimers();
  const conflict = new DraftRevisionConflictError();
  const save = vi.fn().mockRejectedValue(conflict);
  const stale = { ...base, mealType: "dinner" as const, memo: "Aの入力" };
  const { rerender, result } = renderHook(
    ({ value, initialRevision }) =>
      useDraftAutosave({ value, enabled: true, initialRevision, save }),
    { initialProps: { value: base, initialRevision: 1 } },
  );

  rerender({ value: stale, initialRevision: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(result.current.state).toBe("error");

  rerender({ value: stale, initialRevision: 2 });
  const editedStale = { ...stale, budgetPreference: "economy" as const };
  rerender({ value: editedStale, initialRevision: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  await expect(result.current.flush()).rejects.toBe(conflict);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(stale, 1);
  expect(result.current.revision).toBe(1);
});
