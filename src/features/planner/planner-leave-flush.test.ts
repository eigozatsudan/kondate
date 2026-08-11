import { afterEach, describe, expect, it, vi } from "vitest";
import {
  navigateAfterPlannerLeaveFlush,
  registerPlannerLeaveFlush,
  resetPlannerLeaveNavigateFlightForTests,
  runPlannerLeaveFlush,
  shouldInterceptPlannerLeaveClick,
} from "./planner-leave-flush";

afterEach(() => {
  registerPlannerLeaveFlush(null);
  resetPlannerLeaveNavigateFlightForTests();
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

  it("P6: single-flight で連打時は先行 to のみ navigate し handler は1回", async () => {
    let resolveFlush: ((value: "proceed" | "blocked") => void) | undefined;
    const flushPromise = new Promise<"proceed" | "blocked">((resolve) => {
      resolveFlush = resolve;
    });
    const handler = vi.fn(() => flushPromise);
    registerPlannerLeaveFlush(handler);
    const navigate = vi.fn();

    const first = navigateAfterPlannerLeaveFlush(navigate, "/menus/a");
    const second = navigateAfterPlannerLeaveFlush(navigate, "/menus/b");
    resolveFlush?.("proceed");
    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/menus/a");
  });
});
