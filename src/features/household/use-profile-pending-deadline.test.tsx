import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";
import { useProfilePendingDeadline } from "./use-profile-pending-deadline";

describe("useProfilePendingDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("L2: shows pending until C5-scale deadline, then times out", async () => {
    const { result, rerender } = renderHook(
      ({ isPending }: { isPending: boolean }) => useProfilePendingDeadline(isPending),
      { initialProps: { isPending: true } },
    );

    expect(result.current.showPending).toBe(true);
    expect(result.current.pendingTimedOut).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS - 1);
    });
    expect(result.current.showPending).toBe(true);
    expect(result.current.pendingTimedOut).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.showPending).toBe(false);
    expect(result.current.pendingTimedOut).toBe(true);

    // settle したら timeout を解除
    rerender({ isPending: false });
    expect(result.current.showPending).toBe(false);
    expect(result.current.pendingTimedOut).toBe(false);
  });
});
