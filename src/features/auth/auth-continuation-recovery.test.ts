import { describe, expect, it, vi } from "vitest";
import { startAuthContinuationRecovery } from "./auth-continuation-recovery";

describe("auth continuation recovery", () => {
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
        startedAt,
      }),
    );
    storage.setItem(`kondate.auth.callback-owner.${flowId}`, startedAt);
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
