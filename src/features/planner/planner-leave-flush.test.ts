import { afterEach, describe, expect, it, vi } from "vitest";
import {
  navigateAfterPlannerLeaveFlush,
  registerPlannerLeaveFlush,
  runPlannerLeaveFlush,
  shouldInterceptPlannerLeaveClick,
} from "./planner-leave-flush";

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

describe("planner-leave-flush SPA intercept (P1)", () => {
  it("intercepts plain left-click only", () => {
    expect(
      shouldInterceptPlannerLeaveClick({
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      shouldInterceptPlannerLeaveClick({
        defaultPrevented: false,
        button: 0,
        metaKey: true,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      shouldInterceptPlannerLeaveClick({
        defaultPrevented: true,
        button: 0,
        metaKey: false,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("navigates only after proceed", async () => {
    const navigate = vi.fn();
    registerPlannerLeaveFlush(() => Promise.resolve("proceed"));
    await navigateAfterPlannerLeaveFlush(navigate, "/pantry");
    expect(navigate).toHaveBeenCalledWith("/pantry");
  });

  it("does not navigate when blocked", async () => {
    const navigate = vi.fn();
    registerPlannerLeaveFlush(() => Promise.resolve("blocked"));
    await navigateAfterPlannerLeaveFlush(navigate, "/pantry");
    expect(navigate).not.toHaveBeenCalled();
  });
});
