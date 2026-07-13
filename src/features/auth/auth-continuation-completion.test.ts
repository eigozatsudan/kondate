import { expect, it, vi } from "vitest";
import {
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
  startAuthContinuationCompletionWait,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import { isAuthContinuationCallbackOwned, markAuthContinuationCallbackOwner } from "./auth-flow";

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
});
