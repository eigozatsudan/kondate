import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserWithEmailMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const loadEntitlementMock = vi.hoisted(() => vi.fn());
const identityKey = "a".repeat(64);
const getServerEnvMock = vi.hoisted(() =>
  vi.fn(() => ({
    openRouter: { globalDailyLimit: 20 },
    quotaIdentityHmacKey: Buffer.alloc(32, 1),
    // ServerEnv.aiQuotaDisabled と同じキーを初期戻りに含め、mockReturnValue の型を揃える
    aiQuotaDisabled: false,
    billingEnabled: false,
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
vi.mock("../_shared/billing-entitlement.js", async () => {
  const actual = await vi.importActual<typeof import("../_shared/billing-entitlement.js")>(
    "../_shared/billing-entitlement.js",
  );
  return {
    ...actual,
    loadEntitlement: loadEntitlementMock,
  };
});

import { BillingEntitlementUnavailableError } from "../_shared/billing-entitlement.js";
import usageToday from "../usage-today.js";

const freeEntitlement = {
  plan: "free" as const,
  status: "none" as const,
  plusEntitled: false,
  pastDueGrace: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: false,
};

/** RPC は plan フィールドを返さない（Function が merge）。quality.available も Function 合成 */
const freeQualityProjected = {
  day: { consumed: 0, limit: 3 as const, remaining: 3 },
  month: { consumed: 0, limit: 20 as const, remaining: 20 },
  available: false,
};

const rpcUsagePayload = {
  success: { consumed: 0, limit: 3, remaining: 3 },
  attempts: { sent: 0, limit: 6, remaining: 6 },
  shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
  quality: {
    day: { consumed: 0, limit: 3, remaining: 3 },
    month: { consumed: 0, limit: 20, remaining: 20 },
  },
  flyerWeekly: {
    successConsumed: 0,
    successLimit: 2,
    successRemaining: 2,
    triesConsumed: 0,
    triesLimit: 6,
    triesRemaining: 6,
    weekStartJst: "2026-07-27",
  },
  globalAvailable: true,
  retryAt: null,
};

describe("usage-today", () => {
  beforeEach(() => {
    requireUserWithEmailMock.mockReset();
    rpcMock.mockReset();
    loadEntitlementMock.mockReset();
    getServerEnvMock.mockReset();
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: false,
    });
    loadEntitlementMock.mockResolvedValue(freeEntitlement);
    requireUserWithEmailMock.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      accessToken: "token",
      email: "owner@example.com",
    });
    rpcMock.mockResolvedValue({
      data: rpcUsagePayload,
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

  it("merges plan and plusEntitled from entitlement onto RPC usage payload before parse", async () => {
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { ok: true; data: unknown };
    expect(body).toEqual({
      ok: true,
      data: {
        plan: "free",
        plusEntitled: false,
        success: { consumed: 0, limit: 3, remaining: 3 },
        attempts: { sent: 0, limit: 6, remaining: 6 },
        shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
        quality: freeQualityProjected,
        flyerWeekly: rpcUsagePayload.flyerWeekly,
        globalAvailable: true,
        retryAt: null,
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("get_ai_usage_today", {
      p_user_id: "10000000-0000-4000-8000-000000000001",
      p_identity_key: identityKey,
      p_user_limit: 3,
      p_attempt_limit: 6,
      p_short_window_limit: 4,
      p_global_limit: 20,
    });
  });

  it("returns the free-plan usage shape without creating a generation row", async () => {
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: true; data: { plan: string } };
    expect(body.data.plan).toBe("free");
  });

  it("AI_QUOTA_DISABLED rebuild still includes plan and plusEntitled", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: true,
      billingEnabled: false,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 2, limit: 3, remaining: 1 },
        attempts: { sent: 4, limit: 6, remaining: 2 },
        shortWindow: {
          sent: 4,
          limit: 4,
          remaining: 0,
          retryAt: "2026-07-28T12:00:00.000Z",
        },
        globalAvailable: false,
        retryAt: "2026-07-29T00:00:00.000Z",
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: true; data: unknown };
    expect(body.data).toMatchObject({
      plan: "free",
      plusEntitled: false,
      success: { consumed: 0, limit: 3, remaining: 3 },
      attempts: { sent: 0, limit: 6, remaining: 6 },
      shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
      quality: freeQualityProjected,
      flyerWeekly: {
        successConsumed: 0,
        successLimit: 2,
        successRemaining: 2,
        triesConsumed: 0,
        triesLimit: 6,
        triesRemaining: 6,
      },
      globalAvailable: false,
      retryAt: "2026-07-29T00:00:00.000Z",
    });
    expect(
      (body.data as { flyerWeekly: { weekStartJst: string } }).flyerWeekly.weekStartJst,
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("forwards GLOBAL_DAILY_AI_LIMIT to the usage RPC for globalAvailable", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 30 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: false,
    });
    await usageToday(new Request("http://127.0.0.1/api/usage/today", { method: "GET" }));
    expect(rpcMock).toHaveBeenCalledWith("get_ai_usage_today", {
      p_user_id: "10000000-0000-4000-8000-000000000001",
      p_identity_key: identityKey,
      p_user_limit: 3,
      p_attempt_limit: 6,
      p_short_window_limit: 4,
      p_global_limit: 30,
    });
  });

  it("returns 503 when loadEntitlement fails", async () => {
    loadEntitlementMock.mockRejectedValue(new BillingEntitlementUnavailableError());
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("billing_entitlement_unavailable");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // G8: remaining 欠落時は limit 固定フル残ではなく limit-consumed で balance を保つ
  it("G8: missing quality remaining derives from consumed not full dayLimit alone", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: true,
    });
    loadEntitlementMock.mockResolvedValue({
      ...freeEntitlement,
      plan: "plus" as const,
      plusEntitled: true,
      status: "active" as const,
      dbPlusEntitled: true,
    });
    rpcMock.mockResolvedValue({
      data: {
        // Plus 日次 limit は 10/20（success/attempts）。quality は 3/20 固定
        success: { consumed: 1, limit: 10, remaining: 9 },
        attempts: { sent: 1, limit: 20, remaining: 19 },
        shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
        quality: {
          day: { consumed: 2, limit: 3 },
          month: { consumed: 5, limit: 20 },
        },
        flyerWeekly: rpcUsagePayload.flyerWeekly,
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: {
        quality: {
          day: { consumed: number; remaining: number; limit: number };
          month: { consumed: number; remaining: number; limit: number };
          available: boolean;
        };
      };
    };
    expect(body.data.quality.day).toEqual({ consumed: 2, limit: 3, remaining: 1 });
    expect(body.data.quality.month).toEqual({ consumed: 5, limit: 20, remaining: 15 });
    expect(body.data.quality.available).toBe(true);
  });

  // G-R3: flyer remaining 欠落はフル残ではなく balance / 使い切り（G8 quality 同型）
  it("G-R3: missing flyerWeekly object projects exhausted counters not full remaining", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: true,
    });
    loadEntitlementMock.mockResolvedValue({
      ...freeEntitlement,
      plan: "plus" as const,
      plusEntitled: true,
      status: "active" as const,
      dbPlusEntitled: true,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 1, limit: 10, remaining: 9 },
        attempts: { sent: 1, limit: 20, remaining: 19 },
        shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
        quality: {
          day: { consumed: 0, limit: 3, remaining: 3 },
          month: { consumed: 0, limit: 20, remaining: 20 },
        },
        // flyerWeekly キー無し → フル残ではなく使い切り
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: {
        flyerWeekly: {
          successConsumed: number;
          successLimit: number;
          successRemaining: number;
          triesConsumed: number;
          triesLimit: number;
          triesRemaining: number;
        };
      };
    };
    expect(body.data.flyerWeekly).toMatchObject({
      successConsumed: 2,
      successLimit: 2,
      successRemaining: 0,
      triesConsumed: 6,
      triesLimit: 6,
      triesRemaining: 0,
    });
  });

  it("G-R3: missing flyer successRemaining derives from consumed not full limit", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: true,
    });
    loadEntitlementMock.mockResolvedValue({
      ...freeEntitlement,
      plan: "plus" as const,
      plusEntitled: true,
      status: "active" as const,
      dbPlusEntitled: true,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 1, limit: 10, remaining: 9 },
        attempts: { sent: 1, limit: 20, remaining: 19 },
        shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
        quality: {
          day: { consumed: 0, limit: 3, remaining: 3 },
          month: { consumed: 0, limit: 20, remaining: 20 },
        },
        flyerWeekly: {
          successConsumed: 1,
          // successRemaining 欠落 → limit - consumed
          triesConsumed: 2,
          triesRemaining: 4,
          weekStartJst: "2026-07-27",
        },
        globalAvailable: true,
        retryAt: null,
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: {
        flyerWeekly: {
          successConsumed: number;
          successRemaining: number;
          triesConsumed: number;
          triesRemaining: number;
        };
      };
    };
    expect(body.data.flyerWeekly.successConsumed).toBe(1);
    expect(body.data.flyerWeekly.successRemaining).toBe(1);
    expect(body.data.flyerWeekly.triesConsumed).toBe(2);
    expect(body.data.flyerWeekly.triesRemaining).toBe(4);
  });

  it("G8: missing quality object projects exhausted and available false", async () => {
    getServerEnvMock.mockReturnValue({
      openRouter: { globalDailyLimit: 20 },
      quotaIdentityHmacKey: Buffer.alloc(32, 1),
      aiQuotaDisabled: false,
      billingEnabled: true,
    });
    loadEntitlementMock.mockResolvedValue({
      ...freeEntitlement,
      plan: "plus" as const,
      plusEntitled: true,
      status: "active" as const,
      dbPlusEntitled: true,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: { consumed: 1, limit: 10, remaining: 9 },
        attempts: { sent: 1, limit: 20, remaining: 19 },
        shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
        flyerWeekly: rpcUsagePayload.flyerWeekly,
        globalAvailable: true,
        retryAt: null,
        // quality キー無し
      },
      error: null,
    });
    const response = await usageToday(
      new Request("http://127.0.0.1/api/usage/today", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: {
        quality: {
          day: { consumed: number; remaining: number; limit: number };
          month: { consumed: number; remaining: number; limit: number };
          available: boolean;
        };
      };
    };
    expect(body.data.quality).toEqual({
      day: { consumed: 3, limit: 3, remaining: 0 },
      month: { consumed: 20, limit: 20, remaining: 0 },
      available: false,
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
      data: { success: { consumed: number }; attempts: { sent: number }; plan: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.success.consumed).toBe(3);
    expect(body.data.attempts.sent).toBe(6);
    expect(body.data.plan).toBe("free");
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
