import { describe, expect, it, vi } from "vitest";
import { createDeadlineBoundedFetch, runWithRequestDeadline } from "./request-deadline.js";

/** abort されるまで解決しない fetch（signal の abort 理由で reject する） */
function hangingFetch() {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) return;
        if (signal.aborted) {
          reject(signal.reason as Error);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason as Error);
          },
          { once: true },
        );
      }),
  );
}

describe("createDeadlineBoundedFetch", () => {
  it("passes init through unchanged outside a request deadline scope", async () => {
    const base = vi.fn<typeof fetch>(() => Promise.resolve(new Response("ok")));
    const bounded = createDeadlineBoundedFetch(base, () => 0);
    const init: RequestInit = { method: "POST" };
    await bounded("https://example.test/rpc", init);
    expect(base).toHaveBeenCalledWith("https://example.test/rpc", init);
  });

  it("aborts a hanging request when the request deadline passes", async () => {
    const base = hangingFetch();
    const bounded = createDeadlineBoundedFetch(base, () => performance.now());
    const startedAt = performance.now();
    await expect(
      runWithRequestDeadline(startedAt + 30, () => bounded("https://example.test/rpc")),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("rejects without calling fetch when the deadline has already passed", async () => {
    const base = vi.fn<typeof fetch>(() => Promise.resolve(new Response("ok")));
    const bounded = createDeadlineBoundedFetch(base, () => 1_000);
    await expect(
      runWithRequestDeadline(500, () => bounded("https://example.test/rpc")),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(base).not.toHaveBeenCalled();
  });

  it("keeps the caller's own abort signal effective inside the scope", async () => {
    const base = hangingFetch();
    const bounded = createDeadlineBoundedFetch(base, () => 0);
    const controller = new AbortController();
    const pending = runWithRequestDeadline(60_000, () =>
      bounded("https://example.test/rpc", { signal: controller.signal }),
    );
    controller.abort(new DOMException("caller", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
