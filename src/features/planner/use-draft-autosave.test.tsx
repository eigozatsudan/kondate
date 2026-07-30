import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
import { DraftRevisionConflictError } from "./planner-api";
import { useDraftAutosave } from "./use-draft-autosave";

const base: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  ingredientPreference: null,
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
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
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
  renderHook(() =>
    useDraftAutosave({ value: base, enabled: true, baselineRevision: 1, resetToken: 0, save }),
  );

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
    useDraftAutosave({
      value: base,
      enabled: true,
      baselineRevision: 1,
      resetToken: 0,
      save,
      onConflict,
    }),
  );
  renderHook(() =>
    useDraftAutosave({
      value: base,
      enabled: true,
      baselineRevision: 1,
      resetToken: 0,
      save,
      onConflict,
    }),
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
    ({ value, baselineRevision }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken: 0, save }),
    { initialProps: { value: base, baselineRevision: 1 } },
  );

  rerender({ value: base, baselineRevision: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).not.toHaveBeenCalled();

  const edited = { ...base, memo: "再取得後の編集" };
  rerender({ value: edited, baselineRevision: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledWith(edited, 2);
});

it("hydrate 由来の id/revision が混ざった完了 idea 下書きでも flush できる", async () => {
  // sanitize 漏れや cache 直載せで row メタが state に混ざっても、入力整合だけ見て保存する
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const hydratedCompleteIdea = {
    ...base,
    mealType: "lunch" as const,
    mainIngredients: ["牛肉"],
    cuisineGenre: "any" as const,
    targetMode: "idea" as const,
    targetMemberIds: [] as string[],
    servings: 2,
    id: "71000000-0000-4000-8000-000000000099",
    userId: "72000000-0000-4000-8000-000000000099",
    revision: 9,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as PlannerDraftInput;
  const { result } = renderHook(() =>
    useDraftAutosave({
      value: hydratedCompleteIdea,
      enabled: true,
      baselineRevision: 1,
      resetToken: 0,
      save,
    }),
  );

  let row: PlannerDraft | undefined;
  await act(async () => {
    row = await result.current.flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(row?.revision).toBe(2);
  expect(result.current.state).toBe("saved");
});

it("idea 選択直後の servings=null は DB 不能のため保存せず error にもしない", async () => {
  // UI は mode 切替で idea+servings null の一時状態を作るが、generation_drafts CHECK と
  // plannerDraftInputSchema は idea 完了形だけを許す。autosave が 400 を吐いて「保存できませんでした」
  // にしないこと（人数確定後に初めて保存する）。
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const incompleteIdea = {
    ...base,
    mealType: "dinner" as const,
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese" as const,
    targetMode: "idea" as const,
    targetMemberIds: [] as string[],
    servings: null,
  };
  const completeIdea = { ...incompleteIdea, servings: 2 };
  const { rerender, result } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: base } },
  );

  rerender({ value: incompleteIdea });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).not.toHaveBeenCalled();
  expect(result.current.state).not.toBe("error");
  expect(result.current.state).not.toBe("saving");

  rerender({ value: completeIdea });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(completeIdea, 1);
  expect(result.current.state).toBe("saved");
});

it("flush は途中の idea 下書きを拒否し、完了形は保存する", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const incompleteIdea: PlannerDraftInput = {
    ...base,
    targetMode: "idea",
    targetMemberIds: [],
    servings: null,
  };
  const { rerender, result } = renderHook(
    ({ value }: { value: PlannerDraftInput }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: incompleteIdea } },
  );

  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow(/途中|incomplete|人数/u);
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.current.state).not.toBe("error");

  // idea 完成形は servings を数値にする
  const completeIdea: PlannerDraftInput = { ...incompleteIdea, servings: 3 };
  rerender({ value: completeIdea });
  let row: PlannerDraft | undefined;
  await act(async () => {
    row = await result.current.flush();
  });
  expect(save).toHaveBeenCalledWith(completeIdea, 1);
  expect(row?.revision).toBe(2);
});

it("flush は保留中 timer を置換し最新値の DB row を返す", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const latest = { ...base, memo: "野菜を多めに" };
  const { rerender, result } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 4, resetToken: 0, save }),
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
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
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

it("競合発生直後は flush も新規保存も拒否する", async () => {
  vi.useFakeTimers();
  const conflict = new DraftRevisionConflictError();
  const save = vi.fn().mockRejectedValue(conflict);
  const stale = { ...base, mealType: "dinner" as const, memo: "Aの入力" };
  const { rerender, result } = renderHook(
    ({ value, baselineRevision }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken: 0, save }),
    { initialProps: { value: base, baselineRevision: 1 } },
  );

  rerender({ value: stale, baselineRevision: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(result.current.state).toBe("error");

  await act(async () => {
    await expect(result.current.flush()).rejects.toBe(conflict);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(stale, 1);
  expect(result.current.revision).toBe(1);
});

it("競合後は baselineRevision だけ変わっても競合を解除せず保存を拒否する", async () => {
  vi.useFakeTimers();
  const conflict = new DraftRevisionConflictError();
  const stale = { ...base, mealType: "dinner" as const, memo: "Aの入力" };
  const save = vi.fn().mockRejectedValue(conflict);
  const { rerender, result } = renderHook(
    ({ value, baselineRevision }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken: 0, save }),
    { initialProps: { value: base, baselineRevision: 1 } },
  );

  rerender({ value: stale, baselineRevision: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(result.current.state).toBe("error");

  rerender({ value: stale, baselineRevision: 2 });

  expect(result.current.state).toBe("error");
  expect(result.current.revision).toBe(1);
  await act(async () => {
    await expect(result.current.flush()).rejects.toBe(conflict);
  });
  expect(save).toHaveBeenCalledTimes(1);
});

it("明示 reset は reset 前の保存継続を無効化し reset 後の編集だけを新 revision で保存する", async () => {
  vi.useFakeTimers();
  let rejectFirst: ((error: DraftRevisionConflictError) => void) | undefined;
  const conflict = new DraftRevisionConflictError();
  const first = { ...base, memo: "先行保存" };
  const queued = { ...base, memo: "reset 前の待機保存" };
  const latest = { ...base, mealType: "lunch" as const, memo: "最新の下書き" };
  const save = vi.fn((value: PlannerDraftInput, revision: number) => {
    if (save.mock.calls.length === 1) {
      return new Promise<PlannerDraft>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.resolve(saved(value, revision + 1));
  });
  const onConflict = vi.fn();
  const { rerender, result } = renderHook(
    ({ value, baselineRevision, resetToken }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken, save, onConflict }),
    { initialProps: { value: base, baselineRevision: 1, resetToken: 0 } },
  );

  rerender({ value: first, baselineRevision: 1, resetToken: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  rerender({ value: queued, baselineRevision: 1, resetToken: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  rerender({ value: latest, baselineRevision: 2, resetToken: 1 });
  expect(result.current.state).toBe("idle");
  expect(result.current.revision).toBe(2);

  await act(async () => {
    rejectFirst?.(conflict);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(onConflict).not.toHaveBeenCalled();
  expect(result.current.state).toBe("idle");
  expect(result.current.revision).toBe(2);

  const edited = { ...latest, budgetPreference: "economy" as const };
  rerender({ value: edited, baselineRevision: 2, resetToken: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, edited, 2);
  expect(result.current.state).toBe("saved");
  expect(result.current.revision).toBe(3);
});
