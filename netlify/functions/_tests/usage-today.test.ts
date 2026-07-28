import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserWithEmailMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const identityKey = "a".repeat(64);
const getServerEnvMock = vi.hoisted(() =>
  vi.fn(() => ({
    openRouter: { globalDailyLimit: 20 },
    quotaIdentityHmacKey: Buffer.alloc(32, 1),
  })),
);

vi.mock("../_shared/auth.js", () => ({
  requireUserWithEmail: requireUserWithEmailMock,
}));
vi.mock("../_shared/supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock }),
}));
vi.mock("../_shared/env.js", () => ({
  getServerEnv: getServerEnvMock,
}));
vi.mock("../_shared/quota-identity.js", () => ({
  computeQuotaIdentityKey: () => identityKey,
  normalizeQuotaEmail: (email: string) => email.trim().toLowerCase(),
}));

import usageToday from "../usage-today.js";

describe("usage-today", () => {
  beforeEach(() => {
    requireUserWithEmailMock.mockReset();
    rpcMock.mockReset();
    getServerEnvMock.mockReset();
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
    });
    requireUserWithEmailMock.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      accessToken: "token",
      email: "owner@example.com",
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 0, limit: 3, remaining: 3 },
        attempts: { sent: 0, limit: 6, remaining: 6 },
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
    requireUserWithEmailMock.mockRejectedValue(new Error("unauthorized"));
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
        success: { consumed: 0, limit: 3, remaining: 3 },
        attempts: { sent: 0, limit: 6, remaining: 6 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("get_ai_usage_today", {
      p_user_id: "10000000-0000-4000-8000-000000000001",
      p_identity_key: identityKey,
      p_global_limit: 20,
    });
  });

  it("forwards GLOBAL_DAILY_AI_LIMIT to the usage RPC for globalAvailable", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 30 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
    });
    await usageToday(new Request("http://127.0.0.1/api/usage/today", { method: "GET" }));
    expect(rpcMock).toHaveBeenCalledWith("get_ai_usage_today", {
      p_user_id: "10000000-0000-4000-8000-000000000001",
      p_identity_key: identityKey,
      p_global_limit: 30,
    });
  });

  // F2: upgrade 後の raw 超過を cap した投影は usageTodayDataSchema を通り 200 になる
  it("returns 200 when RPC projects over-limit raw counters to the new ceilings", async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 3, limit: 3, remaining: 0 },
        attempts: { sent: 6, limit: 6, remaining: 0 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: "2026-07-11T15:00:00.000Z",
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: { success: { consumed: number }; attempts: { sent: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.success.consumed).toBe(3);
    expect(body.data.attempts.sent).toBe(6);
  });

  // raw 4/7 をそのまま返すと schema が balance/max を破り generic 500 になる（投影必須の契約）
  it("returns 500 when RPC leaks raw over-limit counters without projection", async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 4, limit: 3, remaining: 0 },
        attempts: { sent: 7, limit: 6, remaining: 0 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: "2026-07-11T15:00:00.000Z",
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(500);
  });

  // F5: 旧 5/12 上限を RPC が返しても schema で 500（fail-closed）
  it("returns 500 when RPC still uses the retired 5/12 limits", async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 1, limit: 5, remaining: 4 },
        attempts: { sent: 2, limit: 12, remaining: 10 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(500);
  });

  it("returns 500 when used + remaining do not balance the limit", async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 1, limit: 3, remaining: 1 },
        attempts: { sent: 2, limit: 6, remaining: 4 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(500);
  });
});
