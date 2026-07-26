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
});
