import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

import { getUsageToday } from "./usage-today-api";

describe("getUsageToday", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
  });

  it("parses the standard envelope with releaseQuota limits", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          data: {
            plan: "free" as const,
            plusEntitled: false,
            success: { consumed: 1, limit: 3, remaining: 2 },
            attempts: { sent: 2, limit: 6, remaining: 4 },
            shortWindow: { sent: 1, limit: 4, remaining: 3, retryAt: null },
            globalAvailable: true,
            retryAt: null,
          },
        }),
      ),
    );
    await expect(getUsageToday({ fetchImpl })).resolves.toMatchObject({
      success: { remaining: 2, limit: 3 },
      attempts: { limit: 6 },
      shortWindow: { limit: 4 },
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/usage/today", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer access-token" },
    });
  });

  // F5: 旧 5/12・残数不整合・余剰 field・error envelope をクライアントで拒否
  it("rejects retired 5/12 limits in a success envelope", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          data: {
            plan: "free" as const,
            plusEntitled: false,
            success: { consumed: 1, limit: 5, remaining: 4 },
            attempts: { sent: 2, limit: 12, remaining: 10 },
            shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
            globalAvailable: true,
            retryAt: null,
          },
        }),
      ),
    );
    await expect(getUsageToday({ fetchImpl })).rejects.toThrow();
  });

  it("rejects unbalanced used + remaining that do not equal limit", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          data: {
            plan: "free" as const,
            plusEntitled: false,
            success: { consumed: 1, limit: 3, remaining: 0 },
            attempts: { sent: 2, limit: 6, remaining: 4 },
            shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
            globalAvailable: true,
            retryAt: null,
          },
        }),
      ),
    );
    await expect(getUsageToday({ fetchImpl })).rejects.toThrow();
  });

  it("rejects surplus fields on a success envelope", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          data: {
            plan: "free" as const,
            plusEntitled: false,
            success: { consumed: 1, limit: 3, remaining: 2 },
            attempts: { sent: 2, limit: 6, remaining: 4 },
            shortWindow: { sent: 1, limit: 4, remaining: 3, retryAt: null },
            globalAvailable: true,
            retryAt: null,
            leaked: "no",
          },
        }),
      ),
    );
    await expect(getUsageToday({ fetchImpl })).rejects.toThrow();
  });

  it("throws the error code from a closed error envelope without treating it as usage data", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: false,
          error: { code: "unauthorized", message: "認証が必要です" },
        }),
      ),
    );
    await expect(getUsageToday({ fetchImpl })).rejects.toThrow("unauthorized");
  });
});
