import { expect, it, vi } from "vitest";
import {
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
  startAuthContinuationCompletionWait,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import {
  isAuthContinuationCallbackOwned,
  markAuthContinuationCallbackOwner,
  readAuthFlow,
} from "./auth-flow";

it("expires callback ownership at the existing auth flow TTL", () => {
  const storage = new MapStorage();
  const flowId = "10000000-0000-4000-8000-000000000001";
  storage.setItem(
    `kondate.auth.flow.${flowId}`,
    JSON.stringify({
      id: flowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: "https://app.test",
      returnTo: "/onboarding",
      sessionExchange: "supabase",
      startedAt: "2026-07-13T00:00:00.000Z",
    }),
  );
  markAuthContinuationCallbackOwner(flowId, storage);

  expect(
    isAuthContinuationCallbackOwned(flowId, storage, new Date("2026-07-13T00:04:59.999Z"), 300_000),
  ).toBe(true);
  expect(
    isAuthContinuationCallbackOwned(flowId, storage, new Date("2026-07-13T00:05:00.001Z"), 300_000),
  ).toBe(false);
});

it("notifies another tab when the callback tab completes the bound flow", () => {
  const onComplete = vi.fn();
  const stop = startAuthContinuationCompletionListener({ onComplete });

  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "kondate.auth.supabase.continuation-complete",
      newValue: JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
    }),
  );

  expect(onComplete).toHaveBeenCalledWith({ flowId: "flow-1", returnTo: "/onboarding" });
  stop();
});

it("notifies the same tab when publish completes the bound flow", () => {
  window.localStorage.removeItem("kondate.auth.supabase.continuation-complete");
  const onComplete = vi.fn();
  const stop = startAuthContinuationCompletionListener({ onComplete });

  // storage イベントは書き込みタブでは発火しない。publish の CustomEvent で same-tab 通知する。
  publishAuthContinuationCompletion(
    { flowId: "flow-1", returnTo: "/onboarding" },
    window.localStorage,
  );

  expect(onComplete).toHaveBeenCalledWith({ flowId: "flow-1", returnTo: "/onboarding" });
  stop();
  window.localStorage.removeItem("kondate.auth.supabase.continuation-complete");
});

it("completes wait from same-tab publish after the waiter has started", () => {
  window.localStorage.removeItem("kondate.auth.supabase.continuation-complete");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  // 起動時 read では未完了。その後同一タブの late publish を拾えること（R1）。
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    onComplete,
    onExpire,
  });

  publishAuthContinuationCompletion(
    { flowId: "flow-1", returnTo: "/onboarding" },
    window.localStorage,
  );

  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith({ flowId: "flow-1", returnTo: "/onboarding" });
  vi.advanceTimersByTime(300_000);
  expect(onExpire).not.toHaveBeenCalled();
  stop();
  window.localStorage.removeItem("kondate.auth.supabase.continuation-complete");
  vi.useRealTimers();
});

it("expires an uncompleted handoff at the existing auth flow TTL and cleans up its listener", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    onComplete,
    onExpire,
  });

  vi.advanceTimersByTime(299_999);
  expect(onExpire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onExpire).toHaveBeenCalledOnce();

  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "kondate.auth.supabase.continuation-complete",
      newValue: JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
    }),
  );
  expect(onComplete).not.toHaveBeenCalled();
  stop();
  vi.useRealTimers();
});

it("R3: completion wait expires at serverExpiresAt when shorter than local TTL", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  // C6 hangWatchdog と同型: expiresAt=30s / ttl=300s なら 30s で onExpire
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    serverExpiresAt: "2026-07-13T00:00:30.000Z",
    onComplete,
    onExpire,
  });

  vi.advanceTimersByTime(29_999);
  expect(onExpire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onExpire).toHaveBeenCalledOnce();
  expect(onComplete).not.toHaveBeenCalled();
  stop();
  vi.useRealTimers();
});

it("C4/RR1: completion wait accounts for clockSkewMs so secret is not burned early", () => {
  vi.useFakeTimers();
  // クライアント時計が 60s 進んでいる想定（skew +60s）。サーバ期限は wall で既に過ぎている。
  vi.setSystemTime(new Date("2026-07-13T00:01:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  // skew 非適用なら remaining=0 で即 onExpire。補正後は server 期限まで待つ（hangWatchdog C4 同型）。
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    serverExpiresAt: "2026-07-13T00:00:30.000Z",
    clockSkewMs: 60_000,
    onComplete,
    onExpire,
  });

  expect(onExpire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(29_999);
  expect(onExpire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onExpire).toHaveBeenCalledOnce();
  expect(onComplete).not.toHaveBeenCalled();
  stop();
  vi.useRealTimers();
});

it("cancels expiry after completion arrives before the existing flow TTL", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    onComplete,
    onExpire,
  });

  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "kondate.auth.supabase.continuation-complete",
      newValue: JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
    }),
  );
  vi.advanceTimersByTime(300_000);

  expect(onComplete).toHaveBeenCalledOnce();
  expect(onExpire).not.toHaveBeenCalled();
  stop();
  vi.useRealTimers();
});

it.each(["invalid", "2026-07-12T23:55:00.000Z"])(
  "expires immediately for an invalid or elapsed flow start: %s",
  (startedAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    const onExpire = vi.fn();
    const stop = startAuthContinuationCompletionWait({
      flowId: "flow-1",
      startedAt,
      ttlMs: 300_000,
      onComplete: vi.fn(),
      onExpire,
    });

    vi.advanceTimersByTime(0);

    expect(onExpire).toHaveBeenCalledOnce();
    stop();
    vi.useRealTimers();
  },
);

it("cleans up both timer and listener when the waiting view unmounts", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const onComplete = vi.fn();
  const onExpire = vi.fn();
  const stop = startAuthContinuationCompletionWait({
    flowId: "flow-1",
    startedAt: "2026-07-13T00:00:00.000Z",
    ttlMs: 300_000,
    onComplete,
    onExpire,
  });

  stop();
  vi.advanceTimersByTime(300_000);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "kondate.auth.supabase.continuation-complete",
      newValue: JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
    }),
  );

  expect(onComplete).not.toHaveBeenCalled();
  expect(onExpire).not.toHaveBeenCalled();
  vi.useRealTimers();
});

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

it("publishes only a safe same-origin return path", () => {
  publishAuthContinuationCompletion(
    { flowId: "flow-1", returnTo: "https://attacker.example/" },
    window.localStorage,
  );

  expect(
    JSON.parse(
      window.localStorage.getItem("kondate.auth.supabase.continuation-complete") ?? "null",
    ),
  ).toEqual({ flowId: "flow-1", returnTo: "/planner" });
  expect(readAuthContinuationCompletion("flow-1")).toEqual({
    flowId: "flow-1",
    returnTo: "/planner",
  });
  window.localStorage.removeItem("kondate.auth.supabase.continuation-complete");
});

it("C10: keeps flow secret when completion setItem fails before clear", () => {
  const storage = new MapStorage();
  const flowId = "10000000-0000-4000-8000-000000000001";
  storage.setItem(
    `kondate.auth.flow.${flowId}`,
    JSON.stringify({
      id: flowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: "https://app.test",
      returnTo: "/onboarding",
      sessionExchange: "supabase",
      startedAt: "2026-07-13T00:00:00.000Z",
    }),
  );
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key === "kondate.auth.supabase.continuation-complete") {
      throw new Error("quota exceeded");
    }
    originalSetItem(key, value);
  };

  expect(() => {
    publishAuthContinuationCompletion({ flowId, returnTo: "/onboarding" }, storage);
  }).toThrow("quota exceeded");
  // setItem 失敗時は clear しないので secret が残る
  expect(readAuthFlow(flowId, storage)?.secret).toBe("A".repeat(43));
});
