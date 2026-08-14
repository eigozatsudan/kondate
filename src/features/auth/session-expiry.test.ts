import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/shared/types/database";
import {
  redirectToLoginForExpiredSession,
  resetSessionExpiryRedirectForTests,
} from "./session-expiry";

const clearExpiredSessionAuthAndDraftsMock = vi.hoisted(() =>
  vi.fn<(client: SupabaseClient<Database>) => Promise<void>>(),
);

vi.mock("./auth-cleanup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-cleanup")>();
  return {
    ...actual,
    clearExpiredSessionAuthAndDrafts: clearExpiredSessionAuthAndDraftsMock,
  };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({ id: "browser-client" }),
}));

describe("redirectToLoginForExpiredSession", () => {
  beforeEach(() => {
    resetSessionExpiryRedirectForTests();
    clearExpiredSessionAuthAndDraftsMock.mockReset();
    clearExpiredSessionAuthAndDraftsMock.mockResolvedValue(undefined);
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

    expect(clearExpiredSessionAuthAndDraftsMock).toHaveBeenCalledTimes(1);
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

  it("C7: does not attach returnTo for auth callback paths", async () => {
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({
      returnTo: "/auth/callback?flow=10000000-0000-4000-8000-000000000001",
      replaceLocation,
    });
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1");
  });

  it("is a no-op while a redirect is already in flight (concurrent)", async () => {
    let resolveCleanup: (() => void) | undefined;
    clearExpiredSessionAuthAndDraftsMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCleanup = resolve;
      }),
    );
    const replaceLocation = vi.fn();
    const first = redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    const second = redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    resolveCleanup?.();
    await first;
    await second;

    expect(clearExpiredSessionAuthAndDraftsMock).toHaveBeenCalledTimes(1);
    expect(replaceLocation).toHaveBeenCalledTimes(1);
  });

  it("C9: allows a subsequent redirect after the previous one finishes", async () => {
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    await redirectToLoginForExpiredSession({ returnTo: "/generation", replaceLocation });

    expect(clearExpiredSessionAuthAndDraftsMock).toHaveBeenCalledTimes(2);
    expect(replaceLocation).toHaveBeenNthCalledWith(
      1,
      "/login?sessionExpired=1&returnTo=%2Fplanner",
    );
    expect(replaceLocation).toHaveBeenNthCalledWith(
      2,
      "/login?sessionExpired=1&returnTo=%2Fgeneration",
    );
  });

  it("C9: releases in-flight guard when replaceLocation throws", async () => {
    const replaceLocation = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("webview blocked navigation");
      })
      .mockImplementation(() => undefined);
    await expect(
      redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation }),
    ).rejects.toThrow("webview blocked navigation");
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    expect(replaceLocation).toHaveBeenCalledTimes(2);
  });

  it("still navigates when cleanup throws", async () => {
    clearExpiredSessionAuthAndDraftsMock.mockRejectedValueOnce(new Error("storage"));
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({ returnTo: "/planner", replaceLocation });
    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1&returnTo=%2Fplanner");
  });

  it("still navigates when cleanup never settles (A2)", async () => {
    vi.useFakeTimers();
    clearExpiredSessionAuthAndDraftsMock.mockReturnValue(new Promise(() => undefined));
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

  it("C5: expiry redirect keeps sibling flow, clears pending and session persist", async () => {
    const { clearExpiredSessionAuthAndDrafts } =
      await vi.importActual<typeof import("./auth-cleanup")>("./auth-cleanup");
    clearExpiredSessionAuthAndDraftsMock.mockImplementation(clearExpiredSessionAuthAndDrafts);

    const flowId = "10000000-0000-4000-8000-0000000000c5";
    const flowKey = `kondate.auth.flow.${flowId}`;
    const pendingKey = `kondate.auth.supabase.pending-deposit.${flowId}`;
    window.localStorage.setItem(
      flowKey,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "http://127.0.0.1:5173",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem(
      pendingKey,
      JSON.stringify({
        state: "B".repeat(43),
        code: "authorization-code-plain",
        expiresAtMs: Date.now() + 60_000,
      }),
    );
    window.localStorage.setItem(
      "kondate.auth.supabase",
      JSON.stringify({ access_token: "stale", refresh_token: "r" }),
    );

    const signOut = vi.fn().mockResolvedValue({ error: null });
    const replaceLocation = vi.fn();
    await redirectToLoginForExpiredSession({
      returnTo: "/planner",
      replaceLocation,
      client: { auth: { signOut } } as unknown as SupabaseClient<Database>,
    });

    expect(replaceLocation).toHaveBeenCalledWith("/login?sessionExpired=1&returnTo=%2Fplanner");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(window.localStorage.getItem(flowKey)).not.toBeNull();
    expect(window.localStorage.getItem(pendingKey)).toBeNull();
    expect(window.localStorage.getItem("kondate.auth.supabase")).toBeNull();
  });
});
