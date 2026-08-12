import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS,
  ACCESS_TOKEN_REFRESH_TIMEOUT_MS,
  AuthSessionExpiredError,
  AuthSessionProbeTimeoutError,
  AuthSessionRequiredError,
  isAuthSessionFailure,
  isAuthSessionProbeTimeout,
  requireAccessToken,
  resetAccessTokenPinGateForTests,
  setAccessTokenPinnedUserId,
} from "./session";

describe("requireAccessToken", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetAccessTokenPinGateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAccessTokenPinGateForTests();
  });

  it("returns the access token when the session is still fresh", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "fresh-token",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          },
          error: null,
        }),
        refreshSession: vi.fn(),
      },
    };

    await expect(requireAccessToken(client as never)).resolves.toBe("fresh-token");
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is within the skew window", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "stale-token",
              expires_at: Math.floor(Date.now() / 1000) + 10,
            },
          },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "refreshed-token",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          },
          error: null,
        }),
      },
    };

    await expect(requireAccessToken(client as never)).resolves.toBe("refreshed-token");
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("throws AuthSessionExpiredError when refresh fails", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "stale-token",
              expires_at: Math.floor(Date.now() / 1000) - 1,
            },
          },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { message: "Invalid Refresh Token" },
        }),
      },
    };

    await expect(requireAccessToken(client as never)).rejects.toBeInstanceOf(
      AuthSessionExpiredError,
    );
  });

  it("throws AuthSessionRequiredError when no local session exists", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        refreshSession: vi.fn(),
      },
    };

    await expect(requireAccessToken(client as never)).rejects.toBeInstanceOf(
      AuthSessionRequiredError,
    );
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("C9: throws AuthSessionProbeTimeoutError when refreshSession never settles (not expired)", async () => {
    vi.useFakeTimers();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "stale-token",
              expires_at: Math.floor(Date.now() / 1000) - 1,
            },
          },
          error: null,
        }),
        // never-settle: 半開き回線の再現
        refreshSession: vi.fn().mockReturnValue(new Promise(() => undefined)),
      },
    };

    const pending = requireAccessToken(client as never);
    const expectation = expect(pending).rejects.toBeInstanceOf(AuthSessionProbeTimeoutError);
    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_REFRESH_TIMEOUT_MS);
    await expectation;
    expect(isAuthSessionFailure(new AuthSessionProbeTimeoutError())).toBe(false);
  });

  it("C9/AP2: throws AuthSessionProbeTimeoutError when getSession never settles (not expired)", async () => {
    vi.useFakeTimers();
    const client = {
      auth: {
        getSession: vi.fn().mockReturnValue(new Promise(() => undefined)),
        refreshSession: vi.fn(),
      },
    };

    const pending = requireAccessToken(client as never);
    const expectation = expect(pending).rejects.toBeInstanceOf(AuthSessionProbeTimeoutError);
    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS);
    await expectation;
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
    expect(isAuthSessionFailure(new AuthSessionProbeTimeoutError())).toBe(false);
  });

  it("C10: refreshes when expires_at is missing so a stale token is not trusted", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "token-without-expiry",
              // expires_at 欠落
            },
          },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "refreshed-token",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          },
          error: null,
        }),
      },
    };

    await expect(requireAccessToken(client as never)).resolves.toBe("refreshed-token");
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("C1: refuses Bearer when React pin user differs from shared client session user", async () => {
    // pin=A のまま multi-tab clobber で client が B を保持する経路
    setAccessTokenPinnedUserId("user-a");
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "token-b",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: "user-b" },
            },
          },
          error: null,
        }),
        refreshSession: vi.fn(),
      },
    };

    await expect(requireAccessToken(client as never)).rejects.toBeInstanceOf(
      AuthSessionExpiredError,
    );
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("C1: issues Bearer when pin user matches client session user", async () => {
    setAccessTokenPinnedUserId("user-a");
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "token-a",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: "user-a" },
            },
          },
          error: null,
        }),
        refreshSession: vi.fn(),
      },
    };

    await expect(requireAccessToken(client as never)).resolves.toBe("token-a");
  });

  it("C1: refuses refreshed Bearer when refresh settles as a different user than pin", async () => {
    setAccessTokenPinnedUserId("user-a");
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "stale-a",
              expires_at: Math.floor(Date.now() / 1000) - 1,
              user: { id: "user-a" },
            },
          },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              access_token: "token-b",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: "user-b" },
            },
          },
          error: null,
        }),
      },
    };

    await expect(requireAccessToken(client as never)).rejects.toBeInstanceOf(
      AuthSessionExpiredError,
    );
  });
});

describe("isAuthSessionFailure", () => {
  it.each([
    [new AuthSessionRequiredError(), true],
    [new AuthSessionExpiredError(), true],
    [new AuthSessionProbeTimeoutError(), false],
    [new Error("auth_required"), true],
    [new Error("ログインが必要です"), true],
    [new Error("model_unavailable"), false],
    ["auth_required", false],
    [null, false],
  ] as const)("classifies %s as %s", (error, expected) => {
    expect(isAuthSessionFailure(error)).toBe(expected);
  });
});

describe("isAuthSessionProbeTimeout", () => {
  it("C12: detects probe timeout without treating it as session failure", () => {
    expect(isAuthSessionProbeTimeout(new AuthSessionProbeTimeoutError())).toBe(true);
    expect(isAuthSessionProbeTimeout(new Error("auth_session_probe_timeout"))).toBe(true);
    expect(isAuthSessionProbeTimeout(new AuthSessionExpiredError())).toBe(false);
    expect(isAuthSessionFailure(new AuthSessionProbeTimeoutError())).toBe(false);
  });
});
