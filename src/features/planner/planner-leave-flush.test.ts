import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPlannerLeaveFlush, runPlannerLeaveFlush } from "./planner-leave-flush";

afterEach(() => {
  registerPlannerLeaveFlush(null);
});

describe("planner-leave-flush (P2)", () => {
  it("proceeds when no handler is registered", async () => {
    await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  });

  it("delegates to the registered handler", async () => {
    const handler = vi.fn().mockResolvedValue("blocked");
    registerPlannerLeaveFlush(handler);
    await expect(runPlannerLeaveFlush()).resolves.toBe("blocked");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("clears handler on null registration so later leave is unblocked", async () => {
    registerPlannerLeaveFlush(() => Promise.resolve("blocked"));
    registerPlannerLeaveFlush(null);
    await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
  });
});
