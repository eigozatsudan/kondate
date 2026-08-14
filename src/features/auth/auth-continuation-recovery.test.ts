import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMMEDIATE_CLAIM_TIMEOUT_MS } from "./async-timeout";
import {
  EXCHANGE_IN_FLIGHT_TTL_MS,
  isAuthContinuationCallbackPreLeaseHeld,
  isAuthContinuationExchangeInFlight,
  isAuthContinuationExchangeInFlightOwner,
  releaseAuthContinuationCallbackPreLease,
  releaseAuthContinuationExchangeInFlight,
  startAuthContinuationCallbackPreLease,
  startAuthContinuationExchangeInFlightHeartbeat,
  startAuthContinuationRecovery,
  tryAcquireAuthContinuationExchangeInFlight,
} from "./auth-continuation-recovery";

describe("auth continuation recovery", () => {
  let originalIndexedDb: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new SerializedIndexedDb(),
    });
  });

  afterEach(() => {
    if (originalIndexedDb === undefined) {
      Reflect.deleteProperty(globalThis, "indexedDB");
    } else {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    }
  });

  it("allows only one tab to claim while a shared recovery lock is held", async () => {
    const storage = new MapStorage();
    let nowMs = Date.now();
    storage.setItem(
      "kondate.auth.flow.10000000-0000-4000-8000-000000000001",
      JSON.stringify({
        id: "10000000-0000-4000-8000-000000000001",
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/planner",
        sessionExchange: "supabase",
        startedAt: new Date(nowMs).toISOString(),
      }),
    );
    let releaseClaim: (() => void) | undefined;
    const gateway = {
      resumeFlow: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ kind: "deposited" }>((resolve) => {
              releaseClaim = () => {
                resolve({ kind: "deposited" });
              };
            }),
        )
        .mockResolvedValue({ kind: "deposited" }),
    };
    const intervalHandlers: Array<() => void> = [];
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandlers.push(handler as () => void);
      return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;
    const locks = new ImmediateLockManager();
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks,
    });

    try {
      const firstStop = startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        now: () => new Date(nowMs),
        setInterval: setIntervalMock,
      });
      const secondStop = startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        now: () => new Date(nowMs),
        setInterval: setIntervalMock,
      });

      expect(locks.requests).toHaveLength(2);
      for (const request of locks.requests) {
        expect(request.name).toBe("kondate.auth.claim-poll");
        expect(request.options.ifAvailable).toBe(true);
      }
      expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
      releaseClaim?.();
      // withTimeout(Promise.race) と lock コールバック完了まで microtask を十分回す
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }

      nowMs += 5_000;
      intervalHandlers[1]?.();
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
      expect(gateway.resumeFlow).toHaveBeenCalledTimes(2);
      firstStop();
      secondStop();
    } finally {
      if (originalLocks === undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
    }
  });

  it("does not start another claim after cleanup while a claim is pending", async () => {
    const storage = new MapStorage();
    const startedAt = new Date().toISOString();
    for (const flowId of [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ]) {
      storage.setItem(
        `kondate.auth.flow.${flowId}`,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "https://app.test",
          returnTo: "/planner",
          sessionExchange: "supabase",
          startedAt,
        }),
      );
    }
    let releaseClaim: (() => void) | undefined;
    const gateway = {
      resumeFlow: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ kind: "deposited" }>((resolve) => {
              releaseClaim = () => {
                resolve({ kind: "deposited" });
              };
            }),
        )
        .mockResolvedValue({ kind: "deposited" }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();
    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);

    stop();
    releaseClaim?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
  });

  it("R2: does not call onComplete/onResult after stop during in-flight resumeFlow", async () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const storage = flowStorage([flowId]);
    let resolveResume:
      ((result: { kind: "complete"; flowId: string; returnTo: string }) => void) | undefined;
    const gateway = {
      resumeFlow: vi.fn(
        () =>
          new Promise<{ kind: "complete"; flowId: string; returnTo: string }>((resolve) => {
            resolveResume = resolve;
          }),
      ),
    };
    const onComplete = vi.fn();
    const onResult = vi.fn();

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete,
      onResult,
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();
    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
    expect(resolveResume).toBeTypeOf("function");

    // in-flight 中に cleanup（effect stop / policy 遷移）
    stop();
    resolveResume?.({ kind: "complete", flowId, returnTo: "/planner" });
    await flushPromises();

    // R2: stop 後の complete 副作用を捨てる（exchange abort はしないが onComplete は抑止）
    expect(onComplete).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("does not start a claim when cleanup runs before an acquired lock callback", async () => {
    const storage = new MapStorage();
    storage.setItem(
      "kondate.auth.flow.10000000-0000-4000-8000-000000000001",
      JSON.stringify({
        id: "10000000-0000-4000-8000-000000000001",
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/planner",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    const gateway = { resumeFlow: vi.fn() };
    const locks = new DeferredLockManager();
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks,
    });

    try {
      const stop = startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        setInterval: (() => 1) as unknown as typeof window.setInterval,
      });
      stop();
      expect(locks.requests).toHaveLength(1);
      expect(locks.requests[0]?.name).toBe("kondate.auth.claim-poll");
      expect(locks.requests[0]?.options.ifAvailable).toBe(true);
      await locks.grant();
      expect(gateway.resumeFlow).not.toHaveBeenCalled();
    } finally {
      if (originalLocks === undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
    }
  });

  it("does not contend for a flow owned by the same-browser callback tab", async () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const startedAt = new Date().toISOString();
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt,
      }),
    );
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, startedAt);
    // ライブな callback recovery lease がある間は global が claim しない（AUTH-R2 排他）
    storage.setItem(
      `kondate.auth.supabase.claim-poll-target-lease.${flowId}.liveinstance01`,
      JSON.stringify({
        flowId,
        instanceId: "liveinstance01",
        refreshedAt: Date.now(),
        pending: false,
      }),
    );
    const gateway = { resumeFlow: vi.fn() };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });

    await flushPromises();
    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    stop();
  });

  it("AUTH-R2: global recovery claims orphan callback-owned flow when target leases expired", async () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const startedAt = new Date().toISOString();
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt,
      }),
    );
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, startedAt);
    // lease 無し = callback タブ死亡。global が orphan を claim できる。
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/onboarding",
      }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });

    await flushPromises();
    expect(gateway.resumeFlow).toHaveBeenCalledWith(flowId);
    stop();
  });

  it("C-R5: global recovery does not claim callback-owned flow while callback-prelease is held", async () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const startedAt = new Date().toISOString();
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt,
      }),
    );
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, startedAt);
    // completeCallback 即時 resume 中の pre-lease（target recovery 開始前）
    const stopPreLease = startAuthContinuationCallbackPreLease(flowId, storage);
    const gateway = { resumeFlow: vi.fn() };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });

    await flushPromises();
    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    stop();
    stopPreLease();
    releaseAuthContinuationCallbackPreLease(flowId, storage);
  });

  it("claims an explicitly targeted callback flow through the shared coordinator", async () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const storage = flowStorage([flowId]);
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, new Date().toISOString());
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/planner",
      }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      targetFlowId: flowId,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledOnce();
    expect(gateway.resumeFlow).toHaveBeenCalledWith(flowId);
    expect(storage.getItem("kondate.auth.supabase.claim-poll-last-at")).not.toBeNull();
    stop();
  });

  it("C12: restrictToFlowId claims a magic-origin flow without callback-owner", async () => {
    // residual は targetFlowId を付けない。owner 無しのマジック元でも untargeted 枝で claim する。
    const restrictedFlowId = "10000000-0000-4000-8000-0000000000c1";
    const otherFlowId = "10000000-0000-4000-8000-0000000000c2";
    // startedAt 順で other が先。絞り込みが無いと selectNext が other を取る。
    const storage = flowStorage([otherFlowId, restrictedFlowId]);
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId: restrictedFlowId,
        returnTo: "/planner",
      }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      restrictToFlowId: restrictedFlowId,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledOnce();
    expect(gateway.resumeFlow).toHaveBeenCalledWith(restrictedFlowId);
    stop();
  });

  it("shares one pending claim slot across two callback recoveries and normal recovery", async () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const storage = flowStorage([flowId]);
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, new Date().toISOString());
    let releaseClaim: (() => void) | undefined;
    const gateway = {
      resumeFlow: vi.fn(
        () =>
          new Promise<{ kind: "awaiting_completion" }>((resolve) => {
            releaseClaim = () => {
              resolve({ kind: "awaiting_completion" });
            };
          }),
      ),
    };
    const locks = new ImmediateLockManager();
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: locks,
    });

    try {
      const stops = [
        startAuthContinuationRecovery({
          gateway,
          storage,
          targetFlowId: flowId,
          onComplete: vi.fn(),
          setInterval: (() => 1) as unknown as typeof window.setInterval,
        }),
        startAuthContinuationRecovery({
          gateway,
          storage,
          targetFlowId: flowId,
          onComplete: vi.fn(),
          setInterval: (() => 2) as unknown as typeof window.setInterval,
        }),
        startAuthContinuationRecovery({
          gateway,
          storage,
          onComplete: vi.fn(),
          setInterval: (() => 3) as unknown as typeof window.setInterval,
        }),
      ];
      await flushPromises();

      expect(gateway.resumeFlow).toHaveBeenCalledOnce();
      releaseClaim?.();
      await flushPromises();
      stops.forEach((stop) => {
        stop();
      });
    } finally {
      if (originalLocks === undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
    }
  });

  it.each(["web-locks", "indexed-db"] as const)(
    "fairly reaches a target flow and a normal flow through %s",
    async (coordinator) => {
      const targetFlowId = "10000000-0000-4000-8000-000000000001";
      const normalFlowId = "10000000-0000-4000-8000-000000000002";
      let nowMs = Date.now();
      const storage = flowStorage([targetFlowId, normalFlowId], nowMs);
      storage.setItem(
        `kondate.auth.supabase.callback-owner.${targetFlowId}`,
        new Date(nowMs).toISOString(),
      );
      const gateway = {
        resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
      };
      const intervalHandlers: Array<() => void> = [];
      const setIntervalMock = ((handler: TimerHandler) => {
        intervalHandlers.push(handler as () => void);
        return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
      }) as unknown as typeof window.setInterval;
      const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
      if (coordinator === "web-locks") {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: new ImmediateLockManager(),
        });
      } else {
        Reflect.deleteProperty(navigator, "locks");
      }

      try {
        const stops = [
          startAuthContinuationRecovery({
            gateway,
            storage,
            targetFlowId,
            onComplete: vi.fn(),
            now: () => new Date(nowMs),
            setInterval: setIntervalMock,
          }),
          startAuthContinuationRecovery({
            gateway,
            storage,
            onComplete: vi.fn(),
            now: () => new Date(nowMs),
            setInterval: setIntervalMock,
          }),
        ];
        await flushPromises();

        for (let slot = 1; slot < 4; slot += 1) {
          nowMs += 5_000;
          intervalHandlers[0]?.();
          await flushPromises();
          intervalHandlers[1]?.();
          await flushPromises();
        }

        expect(gateway.resumeFlow).toHaveBeenCalledTimes(4);
        [targetFlowId, normalFlowId, targetFlowId, normalFlowId].forEach((flowId, index) => {
          expect(gateway.resumeFlow).toHaveBeenNthCalledWith(index + 1, flowId);
        });
        stops.forEach((stop) => {
          stop();
        });
      } finally {
        if (originalLocks === undefined) {
          Reflect.deleteProperty(navigator, "locks");
        } else {
          Object.defineProperty(navigator, "locks", originalLocks);
        }
      }
    },
  );

  it.each(["web-locks", "indexed-db"] as const)(
    "fairly reaches different target flows through %s",
    async (coordinator) => {
      const flowIds = [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ];
      let nowMs = Date.now();
      const storage = flowStorage(flowIds, nowMs);
      flowIds.forEach((flowId) => {
        storage.setItem(
          `kondate.auth.supabase.callback-owner.${flowId}`,
          new Date(nowMs).toISOString(),
        );
      });
      const gateway = {
        resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
      };
      const intervalHandlers: Array<() => void> = [];
      const setIntervalMock = ((handler: TimerHandler) => {
        intervalHandlers.push(handler as () => void);
        return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
      }) as unknown as typeof window.setInterval;
      const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
      if (coordinator === "web-locks") {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: new ImmediateLockManager(),
        });
      } else {
        Reflect.deleteProperty(navigator, "locks");
      }

      try {
        const stops = flowIds.map((targetFlowId) =>
          startAuthContinuationRecovery({
            gateway,
            storage,
            targetFlowId,
            onComplete: vi.fn(),
            now: () => new Date(nowMs),
            setInterval: setIntervalMock,
          }),
        );
        await flushPromises();

        for (let slot = 1; slot < 4; slot += 1) {
          nowMs += 5_000;
          intervalHandlers[0]?.();
          await flushPromises();
          intervalHandlers[1]?.();
          await flushPromises();
        }

        expect(gateway.resumeFlow).toHaveBeenCalledTimes(4);
        [flowIds[0], flowIds[1], flowIds[0], flowIds[1]].forEach((flowId, index) => {
          expect(gateway.resumeFlow).toHaveBeenNthCalledWith(index + 1, flowId);
        });
        stops.forEach((stop) => {
          stop();
        });
      } finally {
        if (originalLocks === undefined) {
          Reflect.deleteProperty(navigator, "locks");
        } else {
          Object.defineProperty(navigator, "locks", originalLocks);
        }
      }
    },
  );

  it("keeps other flows progressing while a target claim remains pending", async () => {
    const targetFlowId = "10000000-0000-4000-8000-000000000001";
    const normalFlowId = "10000000-0000-4000-8000-000000000002";
    let nowMs = Date.now();
    const storage = flowStorage([targetFlowId, normalFlowId], nowMs);
    storage.setItem(
      `kondate.auth.supabase.callback-owner.${targetFlowId}`,
      new Date(nowMs).toISOString(),
    );
    let releaseTarget: (() => void) | undefined;
    const gateway = {
      resumeFlow: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ kind: "awaiting_completion" }>((resolve) => {
              releaseTarget = () => {
                resolve({ kind: "awaiting_completion" });
              };
            }),
        )
        .mockResolvedValue({ kind: "awaiting_completion" }),
    };
    const intervalHandlers: Array<() => void> = [];
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandlers.push(handler as () => void);
      return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;

    const stops = [
      startAuthContinuationRecovery({
        gateway,
        storage,
        targetFlowId,
        onComplete: vi.fn(),
        now: () => new Date(nowMs),
        setInterval: setIntervalMock,
      }),
      startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        now: () => new Date(nowMs),
        setInterval: setIntervalMock,
      }),
    ];
    await flushPromises();

    nowMs += 5_000;
    intervalHandlers[0]?.();
    await flushPromises();
    intervalHandlers[1]?.();
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(2);
    expect(gateway.resumeFlow).toHaveBeenNthCalledWith(1, targetFlowId);
    expect(gateway.resumeFlow).toHaveBeenNthCalledWith(2, normalFlowId);
    releaseTarget?.();
    await flushPromises();
    stops.forEach((stop) => {
      stop();
    });
  });

  it("ignores a stale target lease without stopping a normal flow", async () => {
    const targetFlowId = "10000000-0000-4000-8000-000000000001";
    const normalFlowId = "10000000-0000-4000-8000-000000000002";
    let nowMs = Date.now();
    const storage = flowStorage([targetFlowId, normalFlowId], nowMs);
    storage.setItem(
      `kondate.auth.supabase.callback-owner.${targetFlowId}`,
      new Date(nowMs).toISOString(),
    );
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    const intervalHandlers: Array<() => void> = [];
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandlers.push(handler as () => void);
      return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;
    const targetStop = startAuthContinuationRecovery({
      gateway,
      storage,
      targetFlowId,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: setIntervalMock,
    });
    const normalStop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: setIntervalMock,
    });
    await flushPromises();

    nowMs += 20_000;
    intervalHandlers[1]?.();
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(2);
    expect(gateway.resumeFlow).toHaveBeenNthCalledWith(2, normalFlowId);
    targetStop();
    normalStop();
  });

  it("serializes concurrent recovery wakes", async () => {
    const storage = new MapStorage();
    storage.setItem(
      "kondate.auth.flow.10000000-0000-4000-8000-000000000001",
      JSON.stringify({
        id: "10000000-0000-4000-8000-000000000001",
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/planner",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    let resolveClaim: ((value: { kind: "deposited" }) => void) | undefined;
    const gateway = {
      resumeFlow: vi.fn(
        () =>
          new Promise<{ kind: "deposited" }>((resolve) => {
            resolveClaim = resolve;
          }),
      ),
    };
    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
    resolveClaim?.({ kind: "deposited" });
    stop();
  });

  it("polls at 5s so claim stays under the 20/60s IP limit (B-I1)", () => {
    const intervals: number[] = [];
    const setIntervalMock = ((handler: TimerHandler, ms?: number) => {
      intervals.push(ms ?? 0);
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;
    const stop = startAuthContinuationRecovery({
      gateway: { resumeFlow: vi.fn() },
      storage: new MapStorage(),
      onComplete: vi.fn(),
      setInterval: setIntervalMock,
    });
    expect(intervals).toEqual([5_000]);
    stop();
  });

  it("claims at most one fairly selected flow per shared 5s slot", async () => {
    const storage = new MapStorage();
    const flowIds = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ];
    let nowMs = Date.now();
    flowIds.forEach((flowId, index) => {
      storage.setItem(
        `kondate.auth.flow.${flowId}`,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "https://app.test",
          returnTo: "/planner",
          sessionExchange: "supabase",
          startedAt: new Date(nowMs - 1_000 + index).toISOString(),
        }),
      );
    });
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    let intervalHandler: (() => void) | undefined;
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandler = handler as () => void;
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: setIntervalMock,
    });
    await flushPromises();

    for (let slot = 1; slot < 12; slot += 1) {
      nowMs += 5_000;
      intervalHandler?.();
      await flushPromises();
    }

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(12);
    Array.from({ length: 12 }, (_, index) => index).forEach((index) => {
      expect(gateway.resumeFlow).toHaveBeenNthCalledWith(
        index + 1,
        flowIds[index % flowIds.length],
      );
    });
    stop();
  });

  it("serializes two instances through IndexedDB when Web Locks are unavailable", async () => {
    const storage = flowStorage([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ]);
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };

    const firstStop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    const secondStop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 2) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
    const indexedDb = globalThis.indexedDB as unknown as SerializedIndexedDb;
    expect(indexedDb.openCount).toBe(2);
    expect(indexedDb.upgradeCount).toBe(1);
    expect(indexedDb.createObjectStoreCount).toBe(1);
    expect(indexedDb.transactionCount).toBe(2);
    firstStop();
    secondStop();
  });

  it.each(["blocked", "error"] as const)(
    "closes an IndexedDB connection after %s is followed by late success",
    async (failure) => {
      const indexedDb = new LateSuccessIndexedDb(failure);
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: indexedDb,
      });

      const stop = startAuthContinuationRecovery({
        gateway: { resumeFlow: vi.fn() },
        storage: flowStorage(["10000000-0000-4000-8000-000000000001"]),
        onComplete: vi.fn(),
        setInterval: (() => 1) as unknown as typeof window.setInterval,
      });
      await flushPromises();

      expect(indexedDb.close).toHaveBeenCalledTimes(1);
      stop();
    },
  );

  it.each(["lock-request", "storage", "resume-flow"] as const)(
    "absorbs a %s rejection and retries on the next interval",
    async (failure) => {
      const flowId = "10000000-0000-4000-8000-000000000001";
      const storage =
        failure === "storage" ? new ThrowingOnceCoordinationStorage() : flowStorage([flowId]);
      if (failure === "storage") addFlow(storage, flowId);
      let nowMs = Date.now();
      const gateway = {
        resumeFlow:
          failure === "resume-flow"
            ? vi
                .fn()
                .mockRejectedValueOnce(new Error(`secret:${"A".repeat(43)}`))
                .mockResolvedValue({ kind: "awaiting_completion" })
            : vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
      };
      const locks =
        failure === "lock-request" ? new RejectingOnceLockManager() : new ImmediateLockManager();
      const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: locks,
      });
      let intervalHandler: (() => void) | undefined;
      const setIntervalMock = ((handler: TimerHandler) => {
        intervalHandler = handler as () => void;
        return 1 as unknown as ReturnType<typeof window.setInterval>;
      }) as unknown as typeof window.setInterval;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const stop = startAuthContinuationRecovery({
          gateway,
          storage,
          onComplete: vi.fn(),
          now: () => new Date(nowMs),
          setInterval: setIntervalMock,
        });
        await flushPromises();

        nowMs += 5_000;
        intervalHandler?.();
        await flushPromises();

        expect(gateway.resumeFlow).toHaveBeenCalledTimes(failure === "resume-flow" ? 2 : 1);
        expect(consoleError).not.toHaveBeenCalled();
        stop();
      } finally {
        consoleError.mockRestore();
        if (originalLocks === undefined) {
          Reflect.deleteProperty(navigator, "locks");
        } else {
          Object.defineProperty(navigator, "locks", originalLocks);
        }
      }
    },
  );

  it("falls back to localStorage claim when neither Web Locks nor IndexedDB is available", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Reflect.deleteProperty(navigator, "locks");
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };

    try {
      const stop = startAuthContinuationRecovery({
        gateway,
        storage: flowStorage(["10000000-0000-4000-8000-000000000001"]),
        onComplete: vi.fn(),
        setInterval: (() => 1) as unknown as typeof window.setInterval,
      });
      await flushPromises();

      expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
      expect(gateway.resumeFlow).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
      stop();
    } finally {
      if (originalLocks === undefined) {
        Reflect.deleteProperty(navigator, "locks");
      } else {
        Object.defineProperty(navigator, "locks", originalLocks);
      }
    }
  });

  it.each(["last-at", "cursor"])(
    "does not claim when the %s coordination write fails",
    async (failedKey) => {
      const storage = new ThrowingCoordinationStorage(failedKey);
      addFlow(storage, "10000000-0000-4000-8000-000000000001");
      const gateway = {
        resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
      };

      const stop = startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        setInterval: (() => 1) as unknown as typeof window.setInterval,
      });
      await flushPromises();

      expect(gateway.resumeFlow).not.toHaveBeenCalled();
      stop();
    },
  );

  it("does not claim a target flow when its lease write fails", async () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const storage = new ThrowingTargetLeaseStorage();
    addFlow(storage, flowId);
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, new Date().toISOString());
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      targetFlowId: flowId,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    stop();
  });

  it("U1-I3 normalizes a future last-poll timestamp without claiming in the same cycle", async () => {
    const nowMs = Date.now();
    const storage = flowStorage(["10000000-0000-4000-8000-000000000001"], nowMs);
    storage.setItem("kondate.auth.supabase.claim-poll-last-at", String(nowMs + 60_000));
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    // 未来 last は gap バイパスを防ぐため正規化のみ。同一周期で claim バーストしない。
    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    expect(storage.getItem("kondate.auth.supabase.claim-poll-last-at")).toBe(String(nowMs));
    stop();
  });

  it("C9: normalizes a future target-lease refreshedAt without treating callback-owned as orphan", async () => {
    // 旧 age<0 削除は lease 全滅 → orphan claim 窓。last-poll と同型で now 正規化して温存する。
    const nowMs = Date.now();
    const flowId = "10000000-0000-4000-8000-0000000000c9";
    const storage = flowStorage([flowId], nowMs);
    const startedAt = new Date(nowMs).toISOString();
    storage.setItem(`kondate.auth.supabase.callback-owner.${flowId}`, startedAt);
    const leaseKey = `kondate.auth.supabase.claim-poll-target-lease.${flowId}.liveinstance01`;
    storage.setItem(
      leaseKey,
      JSON.stringify({
        flowId,
        instanceId: "liveinstance01",
        refreshedAt: nowMs + 60_000,
        pending: false,
      }),
    );
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    // callback-owned + 有効 lease のため global は claim しない
    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    const raw = storage.getItem(leaseKey);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "null") as { refreshedAt: number };
    expect(parsed.refreshedAt).toBe(nowMs);
    stop();
  });

  it("C-R4: future target-lease normalize write failure does not remove lease or open orphan claim", async () => {
    // C9 正規化の setItem 失敗で remove すると callback-owned が orphan 扱い → dual-claim 窓。
    // 書込失敗時はキーを残し、メモリ上は now 正規化して active 扱いする（fail-closed）。
    const nowMs = Date.now();
    const flowId = "10000000-0000-4000-8000-0000000000c4";
    const storage = new ThrowingTargetLeaseNormalizeStorage(flowId);
    addFlow(storage, flowId, nowMs);
    storage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      new Date(nowMs).toISOString(),
    );
    const leaseKey = `kondate.auth.supabase.claim-poll-target-lease.${flowId}.liveinstance01`;
    // 初期書込は許可してから、正規化 write だけ失敗させる
    storage.allowLeaseWrites = true;
    storage.setItem(
      leaseKey,
      JSON.stringify({
        flowId,
        instanceId: "liveinstance01",
        refreshedAt: nowMs + 60_000,
        pending: false,
      }),
    );
    storage.allowLeaseWrites = false;

    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    // remove されていない（未来値のまま残る。次回読取で再正規化を試みる）
    expect(storage.getItem(leaseKey)).not.toBeNull();
    stop();
  });

  it("U1-I3 claims on the next cycle after normalizing a future last-poll timestamp", async () => {
    let nowMs = Date.now();
    const storage = flowStorage(["10000000-0000-4000-8000-000000000001"], nowMs);
    storage.setItem("kondate.auth.supabase.claim-poll-last-at", String(nowMs + 60_000));
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    let intervalCb: (() => void) | undefined;
    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: ((cb: () => void) => {
        intervalCb = cb;
        return 1;
      }) as unknown as typeof window.setInterval,
    });
    await flushPromises();
    expect(gateway.resumeFlow).not.toHaveBeenCalled();

    // 5s 床を超えた次周期で claim できる
    nowMs += 5_000;
    intervalCb?.();
    await flushPromises();
    expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
    stop();
  });

  it("recovers claimable flow after clock rollback without crossing callback ownership", async () => {
    let nowMs = Date.parse("2026-07-13T00:00:00.000Z");
    const futureMs = nowMs + 60_000;
    const ownerFlowId = "10000000-0000-4000-8000-000000000001";
    const claimableFlowId = "10000000-0000-4000-8000-000000000002";
    const storage = flowStorage([ownerFlowId, claimableFlowId], futureMs);
    storage.setItem(
      `kondate.auth.supabase.callback-owner.${ownerFlowId}`,
      new Date(futureMs).toISOString(),
    );
    // pending lease = callback が claim 中。claimable から除外し global は owner を跨がない。
    storage.setItem(
      `kondate.auth.supabase.claim-poll-target-lease.${ownerFlowId}.livecallback01`,
      JSON.stringify({
        flowId: ownerFlowId,
        instanceId: "livecallback01",
        refreshedAt: nowMs,
        pending: true,
      }),
    );
    storage.setItem("kondate.auth.supabase.claim-poll-last-at", String(futureMs));
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    let intervalCb: (() => void) | undefined;

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      now: () => new Date(nowMs),
      setInterval: ((cb: () => void) => {
        intervalCb = cb;
        return 1;
      }) as unknown as typeof window.setInterval,
    });
    await flushPromises();
    // 第1周期: 未来 last を正規化のみ
    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    expect(storage.getItem("kondate.auth.supabase.claim-poll-last-at")).toBe(String(nowMs));

    nowMs += 5_000;
    intervalCb?.();
    await flushPromises();

    expect(gateway.resumeFlow).toHaveBeenCalledOnce();
    expect(gateway.resumeFlow).toHaveBeenCalledWith(claimableFlowId);
    // owner の未来 timestamp は list 走査で現在時刻へ正規化される（ownership 自体は維持）
    expect(storage.getItem(`kondate.auth.supabase.callback-owner.${ownerFlowId}`)).toBe(
      new Date(nowMs).toISOString(),
    );
    stop();
  });

  it("shares fair flow selection across two IndexedDB-coordinated instances", async () => {
    let nowMs = Date.now();
    const flowIds = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ];
    const storage = flowStorage(flowIds, nowMs);
    const gateway = {
      resumeFlow: vi.fn().mockResolvedValue({ kind: "awaiting_completion" }),
    };
    const intervalHandlers: Array<() => void> = [];
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandlers.push(handler as () => void);
      return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval;

    const stops = [0, 1].map(() =>
      startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete: vi.fn(),
        now: () => new Date(nowMs),
        setInterval: setIntervalMock,
      }),
    );
    await flushPromises();
    for (let slot = 1; slot < 4; slot += 1) {
      nowMs += 5_000;
      intervalHandlers.forEach((handler) => {
        handler();
      });
      await flushPromises();
    }

    expect(gateway.resumeFlow).toHaveBeenCalledTimes(4);
    [flowIds[0], flowIds[1], flowIds[0], flowIds[1]].forEach((flowId, index) => {
      expect(gateway.resumeFlow).toHaveBeenNthCalledWith(index + 1, flowId);
    });
    stops.forEach((stop) => {
      stop();
    });
  });

  it("sanitizes a complete result before onComplete in the IndexedDB fallback", async () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const onComplete = vi.fn();
    const stop = startAuthContinuationRecovery({
      gateway: {
        resumeFlow: vi.fn().mockResolvedValue({
          kind: "complete",
          flowId,
          returnTo: "https://evil.test/phish",
        }),
      },
      storage: flowStorage([flowId]),
      onComplete,
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(onComplete).toHaveBeenCalledWith({
      kind: "complete",
      flowId,
      returnTo: "/planner",
    });
    stop();
  });

  it("C4: times out a hung resumeFlow so the recovery poll loop can continue", async () => {
    vi.useFakeTimers();
    try {
      const storage = new MapStorage();
      const flowId = "10000000-0000-4000-8000-000000000001";
      addFlow(storage, flowId);
      const gateway = {
        resumeFlow: vi.fn().mockReturnValue(new Promise(() => undefined)),
      };
      const onComplete = vi.fn();
      const onResult = vi.fn();
      const intervalHandlers: Array<() => void> = [];
      const setIntervalMock = ((handler: TimerHandler) => {
        intervalHandlers.push(handler as () => void);
        return intervalHandlers.length as unknown as ReturnType<typeof window.setInterval>;
      }) as unknown as typeof window.setInterval;

      const stop = startAuthContinuationRecovery({
        gateway,
        storage,
        onComplete,
        onResult,
        setInterval: setIntervalMock,
      });
      await flushPromises();
      expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);

      // hang 中は running=true のまま次 poll を拒否する
      intervalHandlers[0]?.();
      await flushPromises();
      expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);

      // withTimeout で running を解放。onResult/onComplete は出さない（awaiting 維持）
      await vi.advanceTimersByTimeAsync(IMMEDIATE_CLAIM_TIMEOUT_MS);
      await flushPromises();
      expect(onComplete).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();

      // 次周期（5s gap）で再 claim できる
      await vi.advanceTimersByTimeAsync(5_000);
      intervalHandlers[0]?.();
      await flushPromises();
      expect(gateway.resumeFlow).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auth continuation exchange in-flight lease (R2/R3)", () => {
  const flowId = "10000000-0000-4000-8000-000000000001";
  const exchangeKey = `kondate.auth.supabase.claim-poll-exchange.${flowId}`;
  /** 逐次テストは確認遅延と locks を切り、storage 契約だけを見る。 */
  const fastStorageOnly = { confirmDelayMs: 0, locks: null };

  it("R2: second tab fails acquire while first holds the lease", async () => {
    const storage = new MapStorage();
    const nowMs = 1_000;
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(true);
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-b",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(false);
    expect(isAuthContinuationExchangeInFlight(flowId, storage, nowMs)).toBe(true);
    const raw = storage.getItem(exchangeKey);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toMatchObject({ instanceId: "tab-a" });
  });

  it("R2: write-then-confirm loses when another writer overwrote before re-read", async () => {
    const storage = new MapStorage();
    const nowMs = 2_000;
    const originalSetItem = storage.setItem.bind(storage);
    let injectOnce = true;
    storage.setItem = (key: string, value: string) => {
      originalSetItem(key, value);
      // setItem 直後に他タブが上書き（TOCTOU 窓の再現）
      if (injectOnce && key === exchangeKey) {
        injectOnce = false;
        originalSetItem(
          key,
          JSON.stringify({ flowId, instanceId: "tab-other", refreshedAt: nowMs }),
        );
      }
    };

    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-me",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(false);
    // 勝者の lease を消さない
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-other",
    });
  });

  it("R2: dual null-read then alternating writes → only one winner after confirm delay", async () => {
    // 問題シナリオ再現: 双方が null を読んだあと write 前で同期し、交互 write しても
    // 確認遅延後の勝者は 1（旧 write→即 re-read のみだと双方 true になり得た）。
    const storage = new MapStorage();
    const nowMs = 3_000;
    const barrier = createAsyncBarrier(2);
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const [aWon, bWon] = await Promise.all([
      tryAcquireAuthContinuationExchangeInFlight(flowId, "tab-a", storage, nowMs, {
        confirmDelayMs: 20,
        sleep,
        locks: null,
        yieldBeforeWrite: () => barrier.wait(),
      }),
      tryAcquireAuthContinuationExchangeInFlight(flowId, "tab-b", storage, nowMs, {
        confirmDelayMs: 20,
        sleep,
        locks: null,
        yieldBeforeWrite: () => barrier.wait(),
      }),
    ]);

    expect(Number(aWon) + Number(bWon)).toBe(1);
    const winner = aWon ? "tab-a" : "tab-b";
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: winner,
    });
    expect(isAuthContinuationExchangeInFlightOwner(flowId, winner, storage, nowMs + 20)).toBe(true);
  });

  it("R2: confirm delay is what collapses dual-null first-confirm both-true", async () => {
    // 確認遅延 0 + yield 同期 write では、先着が afterDelay 再読まで完走して true、
    // 後着も自分 write 後に true → 双方 true（旧 R2 still-open の本体）。
    // 直前テスト（confirmDelayMs>0）が winner=1 に潰すことを対照で示す。
    const storage = new MapStorage();
    const nowMs = 3_500;
    const barrier = createAsyncBarrier(2);

    const [aWon, bWon] = await Promise.all([
      tryAcquireAuthContinuationExchangeInFlight(flowId, "tab-a", storage, nowMs, {
        confirmDelayMs: 0,
        locks: null,
        yieldBeforeWrite: () => barrier.wait(),
      }),
      tryAcquireAuthContinuationExchangeInFlight(flowId, "tab-b", storage, nowMs, {
        confirmDelayMs: 0,
        locks: null,
        yieldBeforeWrite: () => barrier.wait(),
      }),
    ]);

    expect(aWon).toBe(true);
    expect(bWon).toBe(true);
    // storage 上の最終 owner は last-writer 1 のみ（双方 true でも durable lease は 1）
    const finalOwner = JSON.parse(storage.getItem(exchangeKey) ?? "{}") as {
      instanceId?: string;
    };
    expect(finalOwner.instanceId === "tab-a" || finalOwner.instanceId === "tab-b").toBe(true);
  });

  it("R2: Web Locks ifAvailable denies second acquire while first holds the critical section", async () => {
    const storage = new MapStorage();
    const nowMs = 4_000;
    const locks = new ImmediateLockManager();
    let releaseSleep: (() => void) | undefined;
    const blockedSleep = () =>
      new Promise<void>((resolve) => {
        releaseSleep = resolve;
      });

    const first = tryAcquireAuthContinuationExchangeInFlight(flowId, "tab-a", storage, nowMs, {
      confirmDelayMs: 1,
      sleep: blockedSleep,
      locks: locks.asLocks(),
    });
    // tab-a が lock を取り sleep で臨界区間を保持するまで待つ
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(locks.requests).toHaveLength(1);
    expect(locks.requests[0]?.name).toBe(`kondate.auth.exchange.${flowId}`);
    expect(locks.requests[0]?.options.ifAvailable).toBe(true);

    const second = await tryAcquireAuthContinuationExchangeInFlight(
      flowId,
      "tab-b",
      storage,
      nowMs,
      {
        confirmDelayMs: 0,
        locks: locks.asLocks(),
      },
    );
    expect(second).toBe(false);
    expect(locks.requests).toHaveLength(2);

    releaseSleep?.();
    expect(await first).toBe(true);
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-a",
    });
  });

  it("R2: same instance re-acquire refreshes and stays owner", async () => {
    const storage = new MapStorage();
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        1_000,
        fastStorageOnly,
      ),
    ).toBe(true);
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        5_000,
        fastStorageOnly,
      ),
    ).toBe(true);
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-a",
      refreshedAt: 5_000,
    });
  });

  it("R2: release with instanceId does not clear another owner", async () => {
    const storage = new MapStorage();
    // release 内の所有確認は Date.now() 基準のため、lease も実時刻で立てる
    const nowMs = Date.now();
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(true);
    releaseAuthContinuationExchangeInFlight(flowId, storage, "tab-b");
    expect(isAuthContinuationExchangeInFlight(flowId, storage, nowMs)).toBe(true);
    releaseAuthContinuationExchangeInFlight(flowId, storage, "tab-a");
    expect(isAuthContinuationExchangeInFlight(flowId, storage, nowMs)).toBe(false);
  });

  it("R2: owner helper matches acquire winner only", async () => {
    const storage = new MapStorage();
    const nowMs = 6_000;
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(true);
    expect(isAuthContinuationExchangeInFlightOwner(flowId, "tab-a", storage, nowMs)).toBe(true);
    expect(isAuthContinuationExchangeInFlightOwner(flowId, "tab-b", storage, nowMs)).toBe(false);
  });

  it("R3: without heartbeat lease expires after TTL", async () => {
    const storage = new MapStorage();
    const start = 10_000;
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        start,
        fastStorageOnly,
      ),
    ).toBe(true);
    expect(
      isAuthContinuationExchangeInFlight(flowId, storage, start + EXCHANGE_IN_FLIGHT_TTL_MS),
    ).toBe(true);
    expect(
      isAuthContinuationExchangeInFlight(flowId, storage, start + EXCHANGE_IN_FLIGHT_TTL_MS + 1),
    ).toBe(false);
  });

  it("R3: heartbeat keeps exchange lease alive past the initial refreshedAt+TTL", async () => {
    const storage = new MapStorage();
    let nowMs = 0;
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(true);

    const intervalHandlers: Array<() => void> = [];
    const setIntervalMock = ((handler: TimerHandler) => {
      intervalHandlers.push(handler as () => void);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    const clearIntervalMock = vi.fn() as unknown as typeof clearInterval;

    const stop = startAuthContinuationExchangeInFlightHeartbeat(
      flowId,
      "tab-a",
      storage,
      () => nowMs,
      setIntervalMock,
      clearIntervalMock,
    );

    // 5s 間隔で心拍しながら TTL を超えて進める（初回 refreshedAt=0 のままなら 120s で失効）
    // heartbeat の tryAcquire は async（既所有は遅延なし）。各拍の完了を待つ。
    for (let step = 0; step < 30; step += 1) {
      nowMs += 5_000;
      intervalHandlers[0]?.();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    }
    // nowMs = 150_000 > EXCHANGE_IN_FLIGHT_TTL_MS
    expect(nowMs).toBeGreaterThan(EXCHANGE_IN_FLIGHT_TTL_MS);
    expect(isAuthContinuationExchangeInFlight(flowId, storage, nowMs)).toBe(true);
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-a",
      refreshedAt: nowMs,
    });

    stop();
    expect(clearIntervalMock).toHaveBeenCalled();
  });

  it("C3: pre-lease beats on freeze/pagehide even when document is hidden", () => {
    const storage = new MapStorage();
    let now = new Date(0);
    const setIntervalMock = ((handler: TimerHandler) => {
      void handler;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    const clearIntervalMock = vi.fn() as unknown as typeof clearInterval;

    const stop = startAuthContinuationCallbackPreLease(
      flowId,
      storage,
      () => now,
      setIntervalMock,
      clearIntervalMock,
    );
    expect(isAuthContinuationCallbackPreLeaseHeld(flowId, storage, 0)).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden" as DocumentVisibilityState,
    });
    now = new Date(60_000);
    document.dispatchEvent(new Event("freeze"));
    expect(isAuthContinuationCallbackPreLeaseHeld(flowId, storage, 60_000)).toBe(true);

    now = new Date(90_000);
    window.dispatchEvent(new Event("pagehide"));
    expect(isAuthContinuationCallbackPreLeaseHeld(flowId, storage, 90_000)).toBe(true);

    stop();
    expect(clearIntervalMock).toHaveBeenCalled();
  });

  it("C5: heartbeat beats on freeze/pagehide even when document is hidden", async () => {
    const storage = new MapStorage();
    let nowMs = 0;
    expect(
      await tryAcquireAuthContinuationExchangeInFlight(
        flowId,
        "tab-a",
        storage,
        nowMs,
        fastStorageOnly,
      ),
    ).toBe(true);

    const setIntervalMock = ((handler: TimerHandler) => {
      void handler;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    const clearIntervalMock = vi.fn() as unknown as typeof clearInterval;

    const stop = startAuthContinuationExchangeInFlightHeartbeat(
      flowId,
      "tab-a",
      storage,
      () => nowMs,
      setIntervalMock,
      clearIntervalMock,
    );

    // 旧実装は visibilityState===hidden で wake を捨てていた。C5 では hidden でも beat する。
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden" as DocumentVisibilityState,
    });
    nowMs = 60_000;
    document.dispatchEvent(new Event("freeze"));
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-a",
      refreshedAt: 60_000,
    });

    nowMs = 90_000;
    window.dispatchEvent(new Event("pagehide"));
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(JSON.parse(storage.getItem(exchangeKey) ?? "{}")).toMatchObject({
      instanceId: "tab-a",
      refreshedAt: 90_000,
    });

    stop();
  });
});

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/** 指定人数が wait に揃うまで止め、揃ったら全員を同時に進める（dual-null 再現用）。 */
function createAsyncBarrier(partySize: number): { wait: () => Promise<void> } {
  let remaining = partySize;
  let releaseAll: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  return {
    wait: async () => {
      remaining -= 1;
      if (remaining === 0) {
        releaseAll();
      }
      await gate;
    },
  };
}

function addFlow(storage: Storage, flowId: string, nowMs = Date.now()): void {
  storage.setItem(
    `kondate.auth.flow.${flowId}`,
    JSON.stringify({
      id: flowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: "https://app.test",
      returnTo: "/planner",
      sessionExchange: "supabase",
      startedAt: new Date(nowMs).toISOString(),
    }),
  );
}

function flowStorage(flowIds: string[], nowMs = Date.now()): MapStorage {
  const storage = new MapStorage();
  flowIds.forEach((flowId, index) => {
    addFlow(storage, flowId, nowMs - 1_000 + index);
  });
  return storage;
}

/** テスト用 Web Locks モック（LockManager の 3 引数 overload を満たす） */
class ImmediateLockManager {
  #held = false;
  readonly requests: Array<{ name: string; options: LockOptions }> = [];

  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> {
    const options =
      typeof optionsOrCallback === "function" ? ({} as LockOptions) : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : (maybeCallback as LockGrantedCallback<T>);
    this.requests.push({ name, options });
    if (this.#held) return await callback(null);
    this.#held = true;
    try {
      return await callback({} as Lock);
    } finally {
      this.#held = false;
    }
  }

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({ held: [], pending: [] });
  }

  asLocks(): LockManager {
    return this;
  }
}

class DeferredLockManager {
  #callback: ((lock: Lock | null) => void | PromiseLike<void>) | undefined;
  #resolveRequest: () => void = () => undefined;
  readonly requests: Array<{ name: string; options: LockOptions }> = [];
  readonly #request = new Promise<void>((resolve) => {
    this.#resolveRequest = resolve;
  });

  request(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<void>,
    maybeCallback?: LockGrantedCallback<void>,
  ): Promise<void> {
    const options =
      typeof optionsOrCallback === "function" ? ({} as LockOptions) : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : (maybeCallback as LockGrantedCallback<void>);
    this.requests.push({ name, options });
    this.#callback = callback;
    return this.#request;
  }

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({ held: [], pending: [] });
  }

  asLocks(): LockManager {
    return this;
  }

  async grant(): Promise<void> {
    await this.#callback?.({} as Lock);
    this.#resolveRequest();
  }
}

class MapStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length() {
    return this.#values.size;
  }
  clear() {
    this.#values.clear();
  }
  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#values.delete(key);
  }
  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

class ThrowingCoordinationStorage extends MapStorage {
  constructor(private readonly failedKey: string) {
    super();
  }

  override setItem(key: string, value: string): void {
    if (key.includes(`claim-poll-${this.failedKey}`)) throw new Error("storage unavailable");
    super.setItem(key, value);
  }
}

/** C-R4: target-lease 正規化 write だけ失敗させ、remove されないことを検証する */
class ThrowingTargetLeaseNormalizeStorage extends MapStorage {
  allowLeaseWrites = true;

  constructor(private readonly flowId: string) {
    super();
  }

  override setItem(key: string, value: string): void {
    if (
      !this.allowLeaseWrites &&
      key.startsWith(`kondate.auth.supabase.claim-poll-target-lease.${this.flowId}.`)
    ) {
      throw new Error("quota exceeded");
    }
    super.setItem(key, value);
  }
}

class ThrowingOnceCoordinationStorage extends MapStorage {
  #shouldThrow = true;

  override getItem(key: string): string | null {
    if (this.#shouldThrow && key === "kondate.auth.supabase.claim-poll-last-at") {
      this.#shouldThrow = false;
      throw new Error(`secret:${"A".repeat(43)}`);
    }
    return super.getItem(key);
  }
}

class ThrowingTargetLeaseStorage extends MapStorage {
  override setItem(key: string, value: string): void {
    if (key.includes("claim-poll-target-lease")) throw new Error("storage unavailable");
    super.setItem(key, value);
  }
}

class SerializedIndexedDb {
  #tail = Promise.resolve();
  #hasStore = false;
  openCount = 0;
  upgradeCount = 0;
  createObjectStoreCount = 0;
  transactionCount = 0;

  open(name: string, version?: number): IDBOpenDBRequest {
    expect(name).toBe("kondate-auth-claim-poll");
    expect(version).toBe(1);
    this.openCount += 1;
    const request = {
      onblocked: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
    };
    const database = {
      objectStoreNames: {
        contains: (storeName: string) => {
          expect(storeName).toBe("coordination");
          return this.#hasStore;
        },
      },
      createObjectStore: (storeName: string) => {
        expect(storeName).toBe("coordination");
        this.#hasStore = true;
        this.createObjectStoreCount += 1;
        return {} as IDBObjectStore;
      },
      close: vi.fn(),
      transaction: (storeName: string, mode?: IDBTransactionMode) => {
        expect(storeName).toBe("coordination");
        expect(mode).toBe("readwrite");
        return this.#transaction();
      },
    };
    Object.defineProperty(request, "result", { value: database });
    queueMicrotask(() => {
      if (!this.#hasStore) {
        this.upgradeCount += 1;
        request.onupgradeneeded?.(new Event("upgradeneeded"));
      }
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  #transaction(): IDBTransaction {
    this.transactionCount += 1;
    let release = (): void => undefined;
    const predecessor = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = {
      onabort: null as ((event: Event) => void) | null,
      oncomplete: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    };
    const getRequest = {
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
    };
    const finish = (): void => {
      transaction.oncomplete?.(new Event("complete"));
      release();
    };
    Object.assign(transaction, {
      abort: () => {
        transaction.onabort?.(new Event("abort"));
        release();
      },
      objectStore: (storeName: string) => {
        expect(storeName).toBe("coordination");
        return {
          get: (key: IDBValidKey) => {
            expect(key).toBe("reservation");
            void predecessor.then(() => {
              getRequest.onsuccess?.(new Event("success"));
            });
            return getRequest;
          },
          put: (_value: unknown, key?: IDBValidKey) => {
            expect(key).toBe("reservation");
            queueMicrotask(finish);
            return {} as IDBRequest;
          },
        };
      },
    });
    return transaction as unknown as IDBTransaction;
  }
}

class LateSuccessIndexedDb {
  readonly close = vi.fn();

  constructor(private readonly failure: "blocked" | "error") {}

  open(): IDBOpenDBRequest {
    const request = {
      error: new Error("open failed"),
      onblocked: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
    };
    Object.defineProperty(request, "result", {
      value: {
        close: this.close,
        objectStoreNames: { contains: () => true },
      },
    });
    queueMicrotask(() => {
      if (this.failure === "blocked") {
        request.onblocked?.(new Event("blocked"));
      } else {
        request.onerror?.(new Event("error"));
      }
      queueMicrotask(() => request.onsuccess?.(new Event("success")));
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

class RejectingOnceLockManager extends ImmediateLockManager {
  #shouldReject = true;

  override async request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    maybeCallback?: LockGrantedCallback<T>,
  ): Promise<T> {
    if (this.#shouldReject) {
      this.#shouldReject = false;
      throw new Error(`secret:${"A".repeat(43)}`);
    }
    return await super.request(name, optionsOrCallback, maybeCallback);
  }
}
