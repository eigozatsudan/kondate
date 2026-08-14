import { afterEach, describe, expect, it, vi } from "vitest";
import {
  navigateAfterPlannerLeaveFlush,
  PLANNER_LEAVE_FLUSH_TIMEOUT_MS,
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

  it("L12: never-settle handler times out as blocked and clears single-flight", async () => {
    vi.useFakeTimers();
    try {
      registerPlannerLeaveFlush(() => new Promise(() => undefined));
      const pending = runPlannerLeaveFlush();
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBe("blocked");
      registerPlannerLeaveFlush(() => Promise.resolve("proceed"));
      await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P3: timeout は開始時の onTimeout に閉じ、remount 後の新 instance を呼ばない", async () => {
    vi.useFakeTimers();
    try {
      const startedOnTimeout = vi.fn();
      const remountedOnTimeout = vi.fn();
      registerPlannerLeaveFlush(() => new Promise(() => undefined), {
        onTimeout: startedOnTimeout,
      });
      const pending = runPlannerLeaveFlush();
      // hang 中の userId remount: 旧 cleanup が null、新面が別 onTimeout を載せる
      registerPlannerLeaveFlush(null);
      registerPlannerLeaveFlush(() => Promise.resolve("proceed"), {
        onTimeout: remountedOnTimeout,
      });
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBe("blocked");
      expect(startedOnTimeout).toHaveBeenCalledTimes(1);
      expect(remountedOnTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L12: timeout は onTimeout を同期実行し、遅延 handler の proceed は使わない", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      let resolveHandler: ((value: "proceed") => void) | undefined;
      registerPlannerLeaveFlush(
        () =>
          new Promise<"proceed">((resolve) => {
            resolveHandler = resolve;
          }),
        { onTimeout },
      );
      const pending = runPlannerLeaveFlush();
      await vi.advanceTimersByTimeAsync(PLANNER_LEAVE_FLUSH_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBe("blocked");
      expect(onTimeout).toHaveBeenCalledTimes(1);
      resolveHandler?.("proceed");
      await Promise.resolve();
      registerPlannerLeaveFlush(() => Promise.resolve("proceed"));
      await expect(runPlannerLeaveFlush()).resolves.toBe("proceed");
    } finally {
      vi.useRealTimers();
    }
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

  it("P2: runPlannerLeaveFlush が shell∩navigateAfter 共有 single-flight（後続は blocked・handler 1回）", async () => {
    let resolveFlush: ((value: "proceed" | "blocked") => void) | undefined;
    const flushPromise = new Promise<"proceed" | "blocked">((resolve) => {
      resolveFlush = resolve;
    });
    const handler = vi.fn(() => flushPromise);
    registerPlannerLeaveFlush(handler);
    const navigateShell = vi.fn();
    const navigateHome = vi.fn();

    // shell 経路: runPlannerLeaveFlush を直接
    const shellLeave = (async () => {
      const result = await runPlannerLeaveFlush();
      if (result === "proceed") navigateShell("/pantry");
    })();
    // home 経路: navigateAfter 経由（同一 module mutex）
    const homeLeave = navigateAfterPlannerLeaveFlush(navigateHome, "/menus/a");

    resolveFlush?.("proceed");
    await Promise.all([shellLeave, homeLeave]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(navigateShell).toHaveBeenCalledTimes(1);
    expect(navigateShell).toHaveBeenCalledWith("/pantry");
    // 後続 flight は blocked → home は navigate しない
    expect(navigateHome).not.toHaveBeenCalled();
  });

  it("P2: 逆順（navigateAfter 先行）でも handler 1回・後続 shell は blocked", async () => {
    let resolveFlush: ((value: "proceed" | "blocked") => void) | undefined;
    const flushPromise = new Promise<"proceed" | "blocked">((resolve) => {
      resolveFlush = resolve;
    });
    const handler = vi.fn(() => flushPromise);
    registerPlannerLeaveFlush(handler);
    const navigateShell = vi.fn();
    const navigateHome = vi.fn();

    const homeLeave = navigateAfterPlannerLeaveFlush(navigateHome, "/menus/a");
    const shellLeave = (async () => {
      const result = await runPlannerLeaveFlush();
      if (result === "proceed") navigateShell("/pantry");
    })();

    resolveFlush?.("proceed");
    await Promise.all([homeLeave, shellLeave]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(navigateHome).toHaveBeenCalledTimes(1);
    expect(navigateHome).toHaveBeenCalledWith("/menus/a");
    expect(navigateShell).not.toHaveBeenCalled();
  });
});
