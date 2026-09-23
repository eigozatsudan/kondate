import { describe, expect, it, vi } from "vitest";
import type { TasteLearningSetResult, TasteLearningState } from "./taste-learning-api";
import {
  mergeTasteLearningState,
  nextTasteLearningUnconfirmed,
  settleTasteLearningWrite,
  type TasteLearningSettleDeps,
} from "./taste-learning-settle";

/** set_taste_learning_enabled と同じ比較更新（CAS）を持つ偽サーバー。 */
function createServer(initial: TasteLearningState) {
  const state: TasteLearningState = { ...initial };
  return {
    state,
    read: (): TasteLearningState => ({ enabled: state.enabled, seq: state.seq }),
    cas: (enabled: boolean, expectedSeq: number): TasteLearningSetResult => {
      if (state.seq === expectedSeq) {
        state.enabled = enabled;
        state.seq += 1;
        return { enabled: state.enabled, seq: state.seq, applied: true };
      }
      return { enabled: state.enabled, seq: state.seq, applied: false };
    },
  };
}

type Server = ReturnType<typeof createServer>;

/**
 * 偽サーバーにつないだ依存。reads / writes に "fail" を並べると、その回だけ reject する
 * （timeout・通信断）。並べた分を使い切った後は常に成功する。
 */
function makeDeps(
  server: Server,
  plan: { reads?: ("ok" | "fail")[]; writes?: ("ok" | "fail")[] } = {},
) {
  const reads = [...(plan.reads ?? [])];
  const writes = [...(plan.writes ?? [])];
  const observed: TasteLearningState[] = [];
  const deps = {
    read: vi.fn(() =>
      reads.shift() === "fail"
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve(server.read()),
    ),
    write: vi.fn((enabled: boolean, expectedSeq: number) =>
      writes.shift() === "fail"
        ? Promise.reject(new Error("write failed"))
        : Promise.resolve(server.cas(enabled, expectedSeq)),
    ),
    wait: vi.fn(() => Promise.resolve()),
    observe: vi.fn((state: TasteLearningState) => {
      observed.push({ enabled: state.enabled, seq: state.seq });
    }),
  } satisfies TasteLearningSettleDeps;
  return { deps, observed };
}

describe("settleTasteLearningWrite", () => {
  it("settles without a fence when the stalled write had already committed", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    server.cas(true, 0); // 応答は失ったが commit 済み
    const { deps, observed } = makeDeps(server);

    const result = await settleTasteLearningWrite(0, 3, deps);

    expect(result).toEqual({ kind: "settled", state: { enabled: true, seq: 1 } });
    expect(deps.write).not.toHaveBeenCalled();
    expect(observed).toEqual([{ enabled: true, seq: 1 }]);
  });

  it("fences an uncommitted write so it is discarded when it arrives late", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server);

    const result = await settleTasteLearningWrite(0, 3, deps);

    // 柵は現在値（OFF）のまま、読んだ連番で書く
    expect(deps.write).toHaveBeenCalledWith(false, 0);
    expect(result).toEqual({ kind: "settled", state: { enabled: false, seq: 1 } });
    // 柵の答えそのもので確定し、次の試行へ進まない
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.wait).not.toHaveBeenCalled();
    // 滞留していた ON の書き込みが今ごろ届いても、連番が合わず捨てられる
    expect(server.cas(true, 0).applied).toBe(false);
    expect(server.state).toEqual({ enabled: false, seq: 1 });
  });

  it("settles on a fence answered applied:false when the stalled write lands between the read and the fence", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server);
    const readOnce = deps.read.getMockImplementation();
    deps.read.mockImplementationOnce(async () => {
      const current = await readOnce!();
      server.cas(true, 0); // 読んだ直後に滞留していた ON が commit する
      return current;
    });

    const result = await settleTasteLearningWrite(0, 3, deps);

    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "settled", state: { enabled: true, seq: 1 } });
    expect(server.state).toEqual({ enabled: true, seq: 1 });
  });

  it("settles on the fence answer even with a single attempt", async () => {
    // 再読み込みボタンは 1 回だけ試みる。柵が通ったのに unconfirmed を返してはならない
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server);

    const result = await settleTasteLearningWrite(0, 1, deps);

    expect(result).toEqual({ kind: "settled", state: { enabled: false, seq: 1 } });
  });

  it("keeps trying after a failed read instead of giving up", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server, { reads: ["fail"] });

    const result = await settleTasteLearningWrite(0, 3, deps);

    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "settled", state: { enabled: false, seq: 1 } });
    expect(server.cas(true, 0).applied).toBe(false);
  });

  it("re-reads before each retried fence and uses the fresh seq", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server, { writes: ["fail"] });
    deps.wait.mockImplementationOnce(() => {
      // 待っている間に別端末が ON にした
      server.cas(true, 0);
      return Promise.resolve();
    });

    const result = await settleTasteLearningWrite(0, 3, deps);

    // 2 回目の読み取りで連番が進んでいるのが見えたので、2 回目の柵は送らない
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "settled", state: { enabled: true, seq: 1 } });
  });

  it("returns unconfirmed after every attempt fails, waiting between attempts only", async () => {
    const server = createServer({ enabled: false, seq: 0 });
    const { deps } = makeDeps(server, { reads: ["ok", "fail", "ok"], writes: ["fail", "fail"] });

    const result = await settleTasteLearningWrite(0, 3, deps);

    expect(result).toEqual({ kind: "unconfirmed" });
    expect(deps.read).toHaveBeenCalledTimes(3);
    expect(deps.write).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledTimes(2);
    // 未確定のまま。滞留していた書き込みはまだ通りうる
    expect(server.state).toEqual({ enabled: false, seq: 0 });
  });

  it("does not treat a read at the same seq as settled even if it shows the requested value", async () => {
    // 画面の cache が古く、サーバーは元から要求値だった。連番が進んでいない以上、
    // 滞留中の書き込みはまだ通りうるので柵で閉じる
    const server = createServer({ enabled: true, seq: 0 });
    const { deps } = makeDeps(server);

    const result = await settleTasteLearningWrite(0, 3, deps);

    expect(deps.write).toHaveBeenCalledWith(true, 0);
    expect(result).toEqual({ kind: "settled", state: { enabled: true, seq: 1 } });
  });
});

describe("mergeTasteLearningState", () => {
  it("keeps the cached state when the incoming one has a lower seq", () => {
    expect(mergeTasteLearningState({ enabled: true, seq: 2 }, { enabled: false, seq: 1 })).toEqual({
      enabled: true,
      seq: 2,
    });
  });

  it("takes the incoming state when the seq is equal or higher, or nothing is cached", () => {
    expect(mergeTasteLearningState({ enabled: true, seq: 2 }, { enabled: false, seq: 2 })).toEqual({
      enabled: false,
      seq: 2,
    });
    expect(mergeTasteLearningState({ enabled: true, seq: 2 }, { enabled: false, seq: 3 })).toEqual({
      enabled: false,
      seq: 3,
    });
    expect(mergeTasteLearningState(undefined, { enabled: false, seq: 0 })).toEqual({
      enabled: false,
      seq: 0,
    });
  });

  it("drops extra keys such as applied", () => {
    const withApplied: TasteLearningSetResult = { enabled: true, seq: 1, applied: true };
    expect(mergeTasteLearningState(undefined, withApplied)).toEqual({ enabled: true, seq: 1 });
  });
});

describe("nextTasteLearningUnconfirmed", () => {
  const record = { requestedEnabled: true, expectedSeq: 5 };

  it("sets the record when nothing is recorded and the cache has not moved past it", () => {
    expect(nextTasteLearningUnconfirmed(undefined, { enabled: false, seq: 5 }, record)).toEqual(
      record,
    );
    expect(nextTasteLearningUnconfirmed(null, undefined, record)).toEqual(record);
  });

  it("does not overwrite a record of a newer or equal seq from a concurrent write", () => {
    const newer = { requestedEnabled: false, expectedSeq: 6 };
    expect(nextTasteLearningUnconfirmed(newer, { enabled: false, seq: 6 }, record)).toBe(newer);
    const same = { requestedEnabled: false, expectedSeq: 5 };
    expect(nextTasteLearningUnconfirmed(same, { enabled: false, seq: 5 }, record)).toBe(same);
  });

  it("replaces an older record", () => {
    const older = { requestedEnabled: false, expectedSeq: 4 };
    expect(nextTasteLearningUnconfirmed(older, { enabled: false, seq: 5 }, record)).toEqual(record);
  });

  it("does not set a record the cache has already seen settled, keeping what is there", () => {
    expect(nextTasteLearningUnconfirmed(null, { enabled: true, seq: 6 }, record)).toBeNull();
    expect(nextTasteLearningUnconfirmed(undefined, { enabled: true, seq: 6 }, record)).toBeNull();
    const newer = { requestedEnabled: false, expectedSeq: 7 };
    expect(nextTasteLearningUnconfirmed(newer, { enabled: true, seq: 7 }, record)).toBe(newer);
  });
});
