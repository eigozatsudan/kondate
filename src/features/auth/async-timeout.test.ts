import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./async-timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise value when it settles before the limit", async () => {
    const pending = withTimeout(Promise.resolve("ok"), 5_000);
    await expect(pending).resolves.toBe("ok");
  });

  it("rejects when the promise never settles within the limit", async () => {
    const pending = withTimeout(new Promise<string>(() => undefined), 1_000);
    const expectation = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });

  it("propagates rejection from the original promise", async () => {
    const pending = withTimeout(Promise.reject(new Error("boom")), 5_000);
    await expect(pending).rejects.toThrow("boom");
  });
});
