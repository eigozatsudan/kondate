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

/** review 到達済み（meal / 主材料 / ジャンル / audience 完了）。memo 変更だけで persistable。 */
const reviewDraft: PlannerDraftInput = {
  ...base,
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "household",
  targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
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
  // 食事等は audience 未選択の persistable として既に hydrate 済み（実 UI の meal→cuisine 後）。
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const persistableMeal: PlannerDraftInput = {
    ...base,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
  };
  const incompleteIdea = {
    ...persistableMeal,
    targetMode: "idea" as const,
    targetMemberIds: [] as string[],
    servings: null,
  };
  const completeIdea = { ...incompleteIdea, servings: 2 };
  const { rerender, result } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: persistableMeal } },
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

it("resetToken と同時に baseline を現 revision へ上げると次の保存が conflict にならない", async () => {
  // planner-route の入力リセットは setBaselineRevision(autosave.revision)+setResetToken
  // をセットで行う。古い baseline のまま resetToken だけ上げると revision が巻き戻る。
  // P1: reset 時は空下書きを強制保存するため revision が 1 進む。
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender, result } = renderHook(
    ({
      value,
      baselineRevision,
      resetToken,
    }: {
      value: PlannerDraftInput;
      baselineRevision: number;
      resetToken: number;
    }) => useDraftAutosave({ value, enabled: true, baselineRevision, resetToken, save }),
    { initialProps: { value: base, baselineRevision: 5, resetToken: 0 } },
  );

  const edited = { ...base, mealType: "dinner" as const };
  rerender({ value: edited, baselineRevision: 5, resetToken: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenLastCalledWith(edited, 5);
  expect(result.current.revision).toBe(6);

  // リセット: 空下書き + 現 revision を baseline に渡す → 空をサーバへ強制保存 (P1)
  // route も setBaselineRevision(autosave.revision) のあと baseline を自動では上げない。
  const empty = { ...base };
  rerender({ value: empty, baselineRevision: 6, resetToken: 1 });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(save).toHaveBeenLastCalledWith(empty, 6);
  expect(result.current.revision).toBe(7);

  // baseline を 7 に上げると resetBaseline が最新 value を「保存済み」扱いにし debounce が no-op になる。
  // 実 route 同様 baseline prop は 6 のまま、内部 revisionRef が 7 の状態で次編集する。
  const afterReset = { ...base, mealType: "lunch" as const };
  rerender({ value: afterReset, baselineRevision: 6, resetToken: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenLastCalledWith(afterReset, 7);
  expect(result.current.revision).toBe(8);
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
    await Promise.resolve();
  });

  // P3 unmount flush と P4 in-flight 追記が両方走り得るため 2〜3 回。
  // 1 回目は先行内容、最終は離脱直前の編集が expected≥2 で届くことだけ固定する。
  expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(save.mock.calls.length).toBeLessThanOrEqual(3);
  expect(save).toHaveBeenNthCalledWith(1, first, 1);
  const lastCall = save.mock.calls.at(-1);
  expect(lastCall?.[0]).toEqual(edited);
  expect(lastCall?.[1]).toBeGreaterThanOrEqual(2);
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

  // P1: reset で現行 value を強制 enqueue するため state は idle ではなく saving になる
  rerender({ value: latest, baselineRevision: 2, resetToken: 1 });
  expect(result.current.state).toBe("saving");
  expect(result.current.revision).toBe(2);

  await act(async () => {
    rejectFirst?.(conflict);
    await Promise.resolve();
    await Promise.resolve();
  });
  // 先行は supersede。reset 強制保存 (latest @ rev 2) が走る
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(onConflict).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, latest, 2);
  expect(result.current.revision).toBe(3);

  // baseline prop を 3 に上げると resetBaseline が edited を保存済み扱いにする。
  // route 同様 prop は 2 のまま、内部 revisionRef=3 で次編集する。
  const edited = { ...latest, budgetPreference: "economy" as const };
  rerender({ value: edited, baselineRevision: 2, resetToken: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save).toHaveBeenCalledTimes(3);
  expect(save).toHaveBeenNthCalledWith(3, edited, 3);
  expect(result.current.state).toBe("saved");
  expect(result.current.revision).toBe(4);
});

it("P1: resetToken で空下書きを強制保存しサーバと揃える", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender, result } = renderHook(
    ({ value, baselineRevision, resetToken }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken, save }),
    { initialProps: { value: base, baselineRevision: 1, resetToken: 0 } },
  );

  const filled = { ...base, mealType: "dinner" as const, memo: "消す内容" };
  rerender({ value: filled, baselineRevision: 1, resetToken: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.revision).toBe(2);

  const empty = { ...base };
  rerender({ value: empty, baselineRevision: 2, resetToken: 1 });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, empty, 2);
  expect(result.current.revision).toBe(3);
  expect(result.current.state).toBe("saved");
});

it("P1: flush は reset 強制保存の完了を await し失敗を隠さない", async () => {
  vi.useFakeTimers();
  let rejectForce: ((error: Error) => void) | undefined;
  const save = vi.fn(() => {
    if (save.mock.calls.length === 1) {
      return Promise.resolve(saved({ ...base, mealType: "dinner" }, 2));
    }
    return new Promise<PlannerDraft>((_resolve, reject) => {
      rejectForce = reject;
    });
  });
  const onSaved = vi.fn();
  const { rerender, result } = renderHook(
    ({ value, baselineRevision, resetToken }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision,
        resetToken,
        save,
        onSaved,
      }),
    { initialProps: { value: base, baselineRevision: 1, resetToken: 0 } },
  );

  rerender({
    value: { ...base, mealType: "dinner" as const },
    baselineRevision: 1,
    resetToken: 0,
  });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  const empty = { ...base };
  rerender({ value: empty, baselineRevision: 2, resetToken: 1 });
  // reset effect が force enqueue を開始するまで待つ
  await act(async () => {
    await Promise.resolve();
  });
  expect(save).toHaveBeenCalledTimes(2);

  let flushError: unknown;
  let flushDone = false;
  await act(async () => {
    const flushPromise = result.current.flush().then(
      () => {
        flushDone = true;
      },
      (error: unknown) => {
        flushError = error;
        flushDone = true;
      },
    );
    rejectForce?.(new Error("network"));
    await flushPromise;
  });

  expect(flushDone).toBe(true);
  expect(flushError).toBeInstanceOf(Error);
  expect((flushError as Error).message).toBe("network");
  expect(result.current.state).toBe("error");
  // 失敗時は onSaved しない（空 cache を成功扱いにしない）
  expect(onSaved).toHaveBeenCalledTimes(1);
});

it("P3: non-persistable へ遷移したあと audience 中立形を追記し旧 mode をサーバに残さない", async () => {
  vi.useFakeTimers();
  let resolveFirst: ((draft: PlannerDraft) => void) | undefined;
  const household = {
    ...base,
    mealType: "dinner" as const,
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese" as const,
    targetMode: "household" as const,
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
  };
  const incompleteIdea = {
    ...household,
    targetMode: "idea" as const,
    targetMemberIds: [] as string[],
    servings: null,
  };
  const neutralized = {
    ...incompleteIdea,
    targetMode: null,
    targetMemberIds: [] as string[],
    servings: null,
  };
  const save = vi.fn((value: PlannerDraftInput, revision: number) => {
    if (save.mock.calls.length === 1) {
      return new Promise<PlannerDraft>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve(saved(value, revision + 1));
  });
  const onSaved = vi.fn();
  const { rerender, result } = renderHook(
    ({ value }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision: 1,
        resetToken: 0,
        save,
        onSaved,
      }),
    { initialProps: { value: base } },
  );

  rerender({ value: household });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  // in-flight 中に idea + servings=null（non-persistable）へ切替
  rerender({ value: incompleteIdea });

  // 1 本目 household commit 後、同一 op が audience 中立形を追記（P3）
  await act(async () => {
    resolveFirst?.(saved(household, 2));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(1, household, 1);
  expect(save).toHaveBeenNthCalledWith(2, neutralized, 2);
  // 中立形だけを成功扱いにし、旧 household を cache に残さない
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
    targetMode: null,
    revision: 3,
  });
  expect(result.current.state).toBe("saved");
  expect(result.current.revision).toBe(3);

  // flush は中立 baseline と incomplete UI を fingerprint 一致とみなし追加 RPC なしで済む場合もあるが、
  // 少なくとも Incomplete で失敗して旧 mode 成功扱いにはしない
  await act(async () => {
    const flushed = await result.current.flush();
    expect(flushed.targetMode).toBeNull();
  });
});

it("P1: 中立保存後に meal を変えると incomplete でも中立形を追記する", async () => {
  // household 完成形を hydrate したあと idea（servings=null）へ切ると audience 中立形を書く。
  // そのあと meal だけ変えても lastPersisted に畳むと dirty にならずサーバに残らない。
  vi.useFakeTimers();
  const household: PlannerDraftInput = {
    ...base,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
    targetMode: "household",
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
  };
  const incompleteIdea: PlannerDraftInput = {
    ...household,
    targetMode: "idea",
    targetMemberIds: [],
    servings: null,
  };
  const neutralizedDinner: PlannerDraftInput = {
    ...incompleteIdea,
    targetMode: null,
    targetMemberIds: [],
    servings: null,
  };
  const lunchIdea: PlannerDraftInput = { ...incompleteIdea, mealType: "lunch" };
  const neutralizedLunch: PlannerDraftInput = { ...neutralizedDinner, mealType: "lunch" };
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender, result } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: household } },
  );

  rerender({ value: incompleteIdea });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenNthCalledWith(1, neutralizedDinner, 1);

  rerender({ value: lunchIdea });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, neutralizedLunch, 2);
  expect(result.current.revision).toBe(3);

  await act(async () => {
    const flushed = await result.current.flush();
    expect(flushed.mealType).toBe("lunch");
    expect(flushed.targetMode).toBeNull();
  });
  expect(save).toHaveBeenCalledTimes(2);
});

it("P2: in-flight save が supersede 後も revision を引き継ぎ、後続 empty が conflict しない", async () => {
  vi.useFakeTimers();
  let resolveFirst: ((draft: PlannerDraft) => void) | undefined;
  const first = { ...base, memo: "in-flight 旧内容" };
  const empty = { ...base };
  const save = vi.fn((value: PlannerDraftInput, revision: number) => {
    if (save.mock.calls.length === 1) {
      return new Promise<PlannerDraft>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve(saved(value, revision + 1));
  });
  const { rerender, result } = renderHook(
    ({ value, baselineRevision, resetToken }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision, resetToken, save }),
    { initialProps: { value: base, baselineRevision: 1, resetToken: 0 } },
  );

  rerender({ value: first, baselineRevision: 1, resetToken: 0 });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  // reset: 空 + generation bump。強制 empty がキューへ
  rerender({ value: empty, baselineRevision: 1, resetToken: 1 });
  expect(result.current.revision).toBe(1);

  // in-flight がサーバに旧内容を書いて完了（local は supersede）
  await act(async () => {
    resolveFirst?.(saved(first, 2));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // revision を 2 に学習したうえで empty が expected=2 で保存される
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, empty, 2);
  expect(result.current.revision).toBe(3);
});

it("P3: autosave error 後に dirty なら unmount で再 flush する", async () => {
  vi.useFakeTimers();
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(saved({ ...base, memo: "再試行" }, 2));
  const edited = { ...base, memo: "再試行" };
  const { rerender, unmount } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: base } },
  );

  rerender({ value: edited });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  unmount();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(2, edited, 1);
});

it("P4: in-flight 中の strip 後は同一キューで最新 members を追記保存する", async () => {
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
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: base } },
  );

  const staleMembers = {
    ...base,
    mealType: "dinner" as const,
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese" as const,
    targetMode: "household" as const,
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
  };
  const stripped = {
    ...staleMembers,
    targetMemberIds: [] as string[],
    targetMode: null,
  };

  rerender({ value: staleMembers });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  // in-flight 中に strip（debounce 追加なしでも同一 op が追記する）
  rerender({ value: stripped });

  await act(async () => {
    resolveFirst?.(saved(staleMembers, 2));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenNthCalledWith(1, staleMembers, 1);
  expect(save).toHaveBeenNthCalledWith(2, stripped, 2);
});

it("キュー待ち中に value が更新されていれば最新を保存する (P7)", async () => {
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
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: base } },
  );

  const staleMembers = {
    ...base,
    mealType: "dinner" as const,
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese" as const,
    targetMode: "household" as const,
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
  };
  const stripped = {
    ...staleMembers,
    targetMemberIds: [] as string[],
    targetMode: null,
  };

  // 先行保存を開始
  rerender({ value: staleMembers });
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(save).toHaveBeenCalledTimes(1);

  // キュー待ち中に strip（eligibility）相当の更新
  rerender({ value: stripped });
  // 追加の debounce 保存を起こす（2 件目 op）。1 件目 op 自体も P4 ループで strip 後を追記し得る。
  await act(async () => vi.advanceTimersByTimeAsync(600));

  await act(async () => {
    resolveFirst?.(saved(staleMembers, 2));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => vi.runOnlyPendingTimersAsync());

  // 最終的に strip 後の最新がサーバへ書かれていること
  expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
  const lastValue = save.mock.calls.at(-1)?.[0] as PlannerDraftInput;
  expect(lastValue.targetMemberIds).toEqual([]);
  expect(lastValue.targetMode).toBeNull();
});

it("P2: persistable dirty の pagehide は debounce 前に keepalive 経路へ最新 revision を渡す", async () => {
  // useBlocker は document unload を見ない。600ms 前の reload / タブ閉じで
  // 通常 enqueue は keepalive 無しのため中断され、サーバ旧 revision が正本に戻る。
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const saveOnUnload = vi.fn();
  const edited = { ...reviewDraft, memo: "野菜多め" };
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision: 3,
        resetToken: 0,
        save,
        saveOnUnload,
      }),
    { initialProps: { value: reviewDraft } },
  );

  rerender({ value: edited });
  await act(async () => vi.advanceTimersByTimeAsync(599));
  expect(save).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  expect(saveOnUnload).toHaveBeenCalledTimes(1);
  expect(saveOnUnload).toHaveBeenCalledWith(edited, 3);
  expect(save).not.toHaveBeenCalled();
});

it("P2: beforeunload でも persistable dirty を 1 回だけ keepalive 経路へ渡す", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const saveOnUnload = vi.fn();
  const edited = { ...reviewDraft, memo: "タブ閉じ直前" };
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision: 4,
        resetToken: 0,
        save,
        saveOnUnload,
      }),
    { initialProps: { value: reviewDraft } },
  );

  rerender({ value: edited });
  await act(async () => vi.advanceTimersByTimeAsync(100));

  act(() => {
    window.dispatchEvent(new Event("beforeunload"));
    window.dispatchEvent(new Event("pagehide"));
  });

  expect(saveOnUnload).toHaveBeenCalledTimes(1);
  expect(saveOnUnload).toHaveBeenCalledWith(edited, 4);
});

it("P3: household 完成形から incomplete idea への unload は中立形を keepalive する", async () => {
  // debounce 前の reload / タブ閉じでも、flush と同じ audience 中立形を送る。
  // persistable 判定だけで return するとサーバに旧 household が残る。
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const saveOnUnload = vi.fn();
  const incompleteIdea: PlannerDraftInput = {
    ...reviewDraft,
    targetMode: "idea",
    targetMemberIds: [],
    servings: null,
  };
  const neutralized: PlannerDraftInput = {
    ...incompleteIdea,
    targetMode: null,
    targetMemberIds: [],
    servings: null,
  };
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision: 3,
        resetToken: 0,
        save,
        saveOnUnload,
      }),
    { initialProps: { value: reviewDraft } },
  );

  rerender({ value: incompleteIdea });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(save).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  expect(saveOnUnload).toHaveBeenCalledTimes(1);
  expect(saveOnUnload).toHaveBeenCalledWith(neutralized, 3);
  expect(save).not.toHaveBeenCalled();
});

it("P2: persistable でない途中下書きは document unload で keepalive しない", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const saveOnUnload = vi.fn();
  const incompleteIdea: PlannerDraftInput = {
    ...reviewDraft,
    targetMode: "idea",
    targetMemberIds: [],
    servings: null,
  };
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({
        value,
        enabled: true,
        baselineRevision: 1,
        resetToken: 0,
        save,
        saveOnUnload,
      }),
    { initialProps: { value: base } },
  );

  rerender({ value: incompleteIdea });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  expect(saveOnUnload).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("P2: dirty でない pagehide は keepalive しない", () => {
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const saveOnUnload = vi.fn();
  renderHook(() =>
    useDraftAutosave({
      value: reviewDraft,
      enabled: true,
      baselineRevision: 3,
      resetToken: 0,
      save,
      saveOnUnload,
    }),
  );

  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });

  expect(saveOnUnload).not.toHaveBeenCalled();
});
