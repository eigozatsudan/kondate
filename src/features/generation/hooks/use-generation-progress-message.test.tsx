import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stageMessageAt } from "../model/progress-stages";
import {
  GENERATION_PROGRESS_TICK_MS,
  useGenerationProgressMessage,
} from "./use-generation-progress-message";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

describe("useGenerationProgressMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stage 0 when inactive", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: false, anchorMs: null }),
    );
    expect(result.current).toEqual({
      stageIndex: 0,
      message: stageMessageAt(0),
    });
  });

  it("evaluates past anchor synchronously on first render without advancing timers (V-C2)", () => {
    const anchorMs = NOW - 35_000;
    const { result } = renderHook(() => useGenerationProgressMessage({ active: true, anchorMs }));
    expect(result.current.stageIndex).toBe(3);
    expect(result.current.message).toBe("組み合わせと段取りを整えています");
  });

  it("sticks null anchor and advances stages over wall time (V-C1)", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: true, anchorMs: null }),
    );
    expect(result.current.stageIndex).toBe(0);

    act(() => {
      vi.setSystemTime(NOW + 3_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(1);
    expect(result.current.message).toBe("献立の指示を組み立てています");

    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
    expect(result.current.message).toBe("AI に献立案を聞いています");
  });

  it("does not reset elapsed to zero on each tick when anchorMs is null", () => {
    const { result } = renderHook(() =>
      useGenerationProgressMessage({ active: true, anchorMs: null }),
    );
    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
    act(() => {
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBe(2);
  });

  it("never moves backward when anchor jumps forward (L1)", () => {
    const { result, rerender } = renderHook(
      ({ anchorMs }: { anchorMs: number | null }) =>
        useGenerationProgressMessage({ active: true, anchorMs }),
      { initialProps: { anchorMs: NOW - 40_000 } },
    );
    expect(result.current.stageIndex).toBe(3);

    rerender({ anchorMs: NOW });
    expect(result.current.stageIndex).toBe(3);
    expect(result.current.message).toBe("組み合わせと段取りを整えています");
  });

  it("keeps forward progress when switching from sticky null to startedAt=now", () => {
    const { result, rerender } = renderHook(
      ({ anchorMs }: { anchorMs: number | null }) =>
        useGenerationProgressMessage({ active: true, anchorMs }),
      { initialProps: { anchorMs: null as number | null } },
    );
    act(() => {
      vi.setSystemTime(NOW + 10_000);
      vi.advanceTimersByTime(GENERATION_PROGRESS_TICK_MS);
    });
    expect(result.current.stageIndex).toBeGreaterThanOrEqual(2);

    rerender({ anchorMs: Date.now() });
    expect(result.current.stageIndex).toBeGreaterThanOrEqual(2);
  });

  it("resets to stage 0 when becoming inactive", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useGenerationProgressMessage({ active, anchorMs: NOW - 40_000 }),
      { initialProps: { active: true } },
    );
    expect(result.current.stageIndex).toBe(3);

    rerender({ active: false });
    expect(result.current.stageIndex).toBe(0);
    expect(result.current.message).toBe(stageMessageAt(0));
  });
});
