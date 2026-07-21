import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("./_shared/auth.js", () => ({
  requireUser: requireUserMock,
}));
vi.mock("./_shared/supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock }),
}));

import usageToday from "./usage-today.js";

describe("usage-today", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    rpcMock.mockReset();
    requireUserMock.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      accessToken: "token",
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 0, limit: 5, remaining: 5 },
        attempts: { sent: 0, limit: 12, remaining: 12 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
  });

  it("rejects non-GET methods", async () => {
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(405);
  });

  it("requires a bearer-authenticated user before repository access", async () => {
    requireUserMock.mockRejectedValue(new Error("unauthorized"));
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns the five-key usage shape without creating a generation row", async () => {
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { ok: true; data: unknown };
    expect(body).toEqual({
      ok: true,
      data: {
        success: { consumed: 0, limit: 5, remaining: 5 },
        attempts: { sent: 0, limit: 12, remaining: 12 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("get_ai_usage_today", {
      p_user_id: "10000000-0000-4000-8000-000000000001",
    });
  });
});
