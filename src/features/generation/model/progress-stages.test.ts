import { describe, expect, it } from "vitest";
import {
  GENERATION_PROGRESS_STAGES,
  resolveProcessingAnchorMs,
  selectGenerationProgressMessage,
  selectGenerationProgressStageIndex,
  stageMessageAt,
} from "./progress-stages";

describe("GENERATION_PROGRESS_STAGES", () => {
  it("locks five stages in ascending afterMs order with exact copy", () => {
    expect(GENERATION_PROGRESS_STAGES).toEqual([
      { afterMs: 0, message: "条件を確認しています" },
      { afterMs: 3_000, message: "献立の指示を組み立てています" },
      { afterMs: 8_000, message: "AI に献立案を聞いています" },
      { afterMs: 30_000, message: "組み合わせと段取りを整えています" },
      { afterMs: 45_000, message: "仕上げの確認をしています" },
    ]);
  });
});

describe("stageMessageAt", () => {
  it("returns stage 0 copy for out-of-range indexes without throwing", () => {
    expect(stageMessageAt(0)).toBe("条件を確認しています");
    expect(stageMessageAt(4)).toBe("仕上げの確認をしています");
    expect(stageMessageAt(99)).toBe("条件を確認しています");
    expect(stageMessageAt(-1)).toBe("条件を確認しています");
  });
});

describe("selectGenerationProgressStageIndex", () => {
  it.each([
    [0, 0],
    [2_999, 0],
    [3_000, 1],
    [7_999, 1],
    [8_000, 2],
    [29_999, 2],
    [30_000, 3],
    [44_999, 3],
    [45_000, 4],
    [120_000, 4],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ] as const)("elapsed %s → index %s", (elapsed, index) => {
    expect(selectGenerationProgressStageIndex(elapsed)).toBe(index);
  });
});

describe("selectGenerationProgressMessage", () => {
  it("returns the message for the selected index", () => {
    expect(selectGenerationProgressMessage(10_000)).toBe("AI に献立案を聞いています");
    expect(selectGenerationProgressMessage(35_000)).toBe("組み合わせと段取りを整えています");
  });
});

describe("resolveProcessingAnchorMs", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");

  it("returns parsed epoch for a valid past startedAt", () => {
    const started = "2026-07-31T11:59:25.000Z";
    expect(resolveProcessingAnchorMs(started, now)).toBe(Date.parse(started));
  });

  it("returns null for invalid startedAt", () => {
    expect(resolveProcessingAnchorMs("not-a-date", now)).toBeNull();
  });

  it("returns null when startedAt is more than 5s in the future", () => {
    expect(resolveProcessingAnchorMs("2026-07-31T12:00:10.000Z", now)).toBeNull();
  });

  it("accepts startedAt within 5s future skew", () => {
    const started = "2026-07-31T12:00:04.000Z";
    expect(resolveProcessingAnchorMs(started, now)).toBe(Date.parse(started));
  });
});
