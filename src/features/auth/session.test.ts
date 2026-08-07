import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS,
  ACCESS_TOKEN_REFRESH_TIMEOUT_MS,
  AuthSessionExpiredError,
  AuthSessionRequiredError,
  isAuthSessionFailure,
  requireAccessToken,
} from "./session";

describe("requireAccessToken", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("throws AuthSessionExpiredError when refreshSession never settles (A1)", async () => {
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
    const expectation = expect(pending).rejects.toBeInstanceOf(AuthSessionExpiredError);
    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_REFRESH_TIMEOUT_MS);
    await expectation;
  });

  it("AP2: throws AuthSessionExpiredError when getSession never settles", async () => {
    vi.useFakeTimers();
    const client = {
      auth: {
        getSession: vi.fn().mockReturnValue(new Promise(() => undefined)),
        refreshSession: vi.fn(),
      },
    };

    const pending = requireAccessToken(client as never);
    const expectation = expect(pending).rejects.toBeInstanceOf(AuthSessionExpiredError);
    await vi.advanceTimersByTimeAsync(ACCESS_TOKEN_GET_SESSION_TIMEOUT_MS);
    await expectation;
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
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
});

describe("isAuthSessionFailure", () => {
  it.each([
    [new AuthSessionRequiredError(), true],
    [new AuthSessionExpiredError(), true],
    [new Error("auth_required"), true],
    [new Error("ログインが必要です"), true],
    [new Error("model_unavailable"), false],
    ["auth_required", false],
    [null, false],
  ] as const)("classifies %s as %s", (error, expected) => {
    expect(isAuthSessionFailure(error)).toBe(expected);
  });
});
