import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlannerDraft, PlannerDraftInput } from "@shared/contracts/planner";
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

  await act(async () => vi.advanceTimersByTimeAsync(600));
  rerender({ value: { ...base, mealType: "dinner" } });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  expect(result.current.revision).toBe(3);
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
