import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  redirectToLoginForExpiredSession,
  resetSessionExpiryRedirectForTests,
} from "./session-expiry";

const clearLocalAuthAndDraftsMock = vi.hoisted(() => vi.fn());

vi.mock("./auth-cleanup", () => ({
  clearLocalAuthAndDrafts: clearLocalAuthAndDraftsMock,
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({ id: "browser-client" }),
}));

describe("redirectToLoginForExpiredSession", () => {
  beforeEach(() => {
    resetSessionExpiryRedirectForTests();
    clearLocalAuthAndDraftsMock.mockReset();
    clearLocalAuthAndDraftsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSessionExpiryRedirectForTests();
  });

  it("clears local auth and hard-navigates to login with sessionExpired", async () => {
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({
      returnTo: "/generation",
      replaceLocation,
    });

    expect(clearLocalAuthAndDraftsMock).toHaveBeenCalledTimes(1);
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1&returnTo=%2Fgeneration");
  });

  it("does not attach returnTo for login or welcome paths", async () => {
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({
      returnTo: "/login",
      replaceLocation,
    });
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1");
  });

  it("is a no-op when a redirect is already in flight", async () => {
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });

    expect(clearLocalAuthAndDraftsMock).toHaveBeenCalledTimes(1);
    expect(replaceLocation).toHaveBeenCalledTimes(1);
  });

  it("still navigates when cleanup throws", async () => {
    clearLocalAuthAndDraftsMock.mockRejectedValueOnce(new Error("storage"));
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1&returnTo=%2Fplanner");
  });

  it("still navigates when cleanup never settles (A2)", async () => {
    vi.useFakeTimers();
    clearLocalAuthAndDraftsMock.mockReturnValue(new Promise(() => undefined));
    const replaceLocation = vi.fn();
    const pending = redirectToLoginForExpiredSession({
      returnTo: "/planner",
      replaceLocation,
      cleanupTimeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1&returnTo=%2Fplanner");
    vi.useRealTimers();
  });
});
