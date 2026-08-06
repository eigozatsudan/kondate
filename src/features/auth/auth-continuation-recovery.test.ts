import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMMEDIATE_CLAIM_TIMEOUT_MS } from "./async-timeout";
import {
  releaseAuthContinuationCallbackPreLease,
  startAuthContinuationCallbackPreLease,
  startAuthContinuationRecovery,
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

  it("fails closed when neither Web Locks nor IndexedDB is available", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");
    const gateway = { resumeFlow: vi.fn() };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage: flowStorage(["10000000-0000-4000-8000-000000000001"]),
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });
    await flushPromises();

    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    stop();
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

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
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

class ImmediateLockManager {
  #held = false;
  readonly requests: Array<{ name: string; options: LockOptions }> = [];

  async request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ): Promise<T> {
    this.requests.push({ name, options });
    if (this.#held) return await callback(null);
    this.#held = true;
    try {
      return await callback({} as Lock);
    } finally {
      this.#held = false;
    }
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
    options: LockOptions,
    callback: (lock: Lock | null) => void | PromiseLike<void>,
  ): Promise<void> {
    this.requests.push({ name, options });
    this.#callback = callback;
    return this.#request;
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
    options: LockOptions,
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ): Promise<T> {
    if (this.#shouldReject) {
      this.#shouldReject = false;
      throw new Error(`secret:${"A".repeat(43)}`);
    }
    return await super.request(name, options, callback);
  }
}
