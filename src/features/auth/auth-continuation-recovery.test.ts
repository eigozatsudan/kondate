import { describe, expect, it, vi } from "vitest";
import { startAuthContinuationRecovery } from "./auth-continuation-recovery";

describe("auth continuation recovery", () => {
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

      expect(gateway.resumeFlow).toHaveBeenCalledTimes(1);
      releaseClaim?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      nowMs += 5_000;
      intervalHandlers[1]?.();
      await Promise.resolve();
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

  it("does not contend for a flow owned by the same-browser callback tab", () => {
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
    const gateway = { resumeFlow: vi.fn() };

    const stop = startAuthContinuationRecovery({
      gateway,
      storage,
      onComplete: vi.fn(),
      setInterval: (() => 1) as unknown as typeof window.setInterval,
    });

    expect(gateway.resumeFlow).not.toHaveBeenCalled();
    stop();
  });

  it("serializes concurrent recovery wakes", () => {
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
});

class ImmediateLockManager {
  #held = false;

  async request<T>(
    _name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => T | PromiseLike<T>,
  ): Promise<T> {
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
  readonly #request = new Promise<void>((resolve) => {
    this.#resolveRequest = resolve;
  });

  request(
    _name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => void | PromiseLike<void>,
  ): Promise<void> {
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
