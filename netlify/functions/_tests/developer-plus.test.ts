import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { entitlementDataSchema } from "../../../shared/contracts/billing.js";
import billingEntitlement from "../billing-entitlement.js";
import {
  BillingEntitlementUnavailableError,
  loadEntitlement,
} from "../_shared/billing-entitlement.js";

const { getUser, rpc, getServerEnv } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  getServerEnv: vi.fn(),
}));
vi.mock("../_shared/supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ auth: { getUser }, rpc }),
}));
vi.mock("../_shared/env.js", () => ({ getServerEnv }));

const developerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const freeProjection = {
  plan: "free",
  status: "none",
  plus_entitled: false,
  past_due_grace: false,
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
  db_plus_entitled: false,
};

function request(authenticated = true) {
  return new Request("http://127.0.0.1/api/billing/entitlement", {
    headers: authenticated ? { authorization: "Bearer test-token" } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getServerEnv.mockReturnValue({ billingEnabled: false, developerPlusUserIds: [developerId] });
  getUser.mockResolvedValue({ data: { user: { id: developerId } }, error: null });
  rpc.mockResolvedValue({ data: freeProjection, error: null });
});

describe("developer Plus authenticated entitlement", () => {
  it.each([false, true])("grants only the configured identity (billing=%s)", async (enabled) => {
    getServerEnv.mockReturnValue({ billingEnabled: enabled, developerPlusUserIds: [developerId] });
    const response = await billingEntitlement(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: {
        developerPlus: true,
        plusEntitled: true,
        quotaPlan: "plus",
        status: "none",
        dbPlusEntitled: false,
        productSurfacesOpen: enabled,
      },
    });
    expect(rpc).toHaveBeenCalledWith("get_billing_entitlement_for_user", {
      p_user_id: developerId,
    });
  });

  it("ignores forged metadata from a nonmember", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: otherId,
          user_metadata: { developerPlus: true, role: "developer", userId: developerId },
        },
      },
      error: null,
    });
    const response = await billingEntitlement(request());
    expect(response.status).toBe(200);
    const body = z
      .object({ ok: z.literal(true), data: entitlementDataSchema })
      .parse(await response.json());
    expect(body.data).toMatchObject({ plusEntitled: false, quotaPlan: "free" });
    expect(body.data.developerPlus).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(developerId);
  });

  it("rejects unauthenticated requests before entitlement lookup", async () => {
    expect((await billingEntitlement(request(false))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps database failures closed even for a developer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await billingEntitlement(request())).status).toBe(503);
  });

  it("preserves Stripe projection without granting unconfigured identities", async () => {
    getServerEnv.mockReturnValue({ billingEnabled: false, developerPlusUserIds: [] });
    rpc.mockResolvedValue({
      data: {
        ...freeProjection,
        plan: "plus",
        status: "active",
        plus_entitled: true,
        db_plus_entitled: true,
      },
      error: null,
    });
    expect(await loadEntitlement(developerId)).toMatchObject({
      status: "active",
      plusEntitled: true,
    });
    const response = await billingEntitlement(request());
    expect(await response.json()).toMatchObject({
      data: { status: "active", plusEntitled: false, dbPlusEntitled: true, quotaPlan: "free" },
    });
  });
});

describe("entitlement RPC cancel_at (UX 残り R2 項目 6)", () => {
  it("maps cancel_at from the RPC projection", async () => {
    getServerEnv.mockReturnValue({ billingEnabled: true, developerPlusUserIds: [] });
    rpc.mockResolvedValue({
      data: {
        ...freeProjection,
        plan: "plus",
        status: "active",
        plus_entitled: true,
        db_plus_entitled: true,
        current_period_end: "2026-08-01T00:00:00.000Z",
        cancel_at: "2026-07-25T00:00:00.000Z",
      },
      error: null,
    });
    expect(await loadEntitlement(otherId)).toMatchObject({
      cancelAt: "2026-07-25T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
    const response = await billingEntitlement(request());
    expect(await response.json()).toMatchObject({
      data: { cancelAt: "2026-07-25T00:00:00.000Z", cancelAtPeriodEnd: false },
    });
  });

  it("treats a projection without cancel_at (no row / older RPC) as not scheduled", async () => {
    expect(await loadEntitlement(otherId)).toMatchObject({ cancelAt: null });
  });

  // R2 修正 M-3: 行はあるが予約の無い形（"cancel_at": null）も受け付け、wire には cancelAt を出さない
  it("accepts an explicit null cancel_at and keeps it off the wire", async () => {
    getServerEnv.mockReturnValue({ billingEnabled: true, developerPlusUserIds: [] });
    rpc.mockResolvedValue({
      data: {
        ...freeProjection,
        plan: "plus",
        status: "active",
        plus_entitled: true,
        db_plus_entitled: true,
        current_period_end: "2026-08-01T00:00:00.000Z",
        kill_source_status: null,
        cancel_at: null,
      },
      error: null,
    });
    expect(await loadEntitlement(otherId)).toMatchObject({ cancelAt: null });
    const response = await billingEntitlement(request());
    const body = z.object({ data: z.record(z.string(), z.unknown()) }).parse(await response.json());
    expect(body.data).not.toHaveProperty("cancelAt");
  });

  // R2 修正 I-1: RPC の解析は strict で、未知キーは 503 になる。R2 以前の Function にとって
  // cancel_at は未知キーなので、DB は予約の無い行で cancel_at キーを出してはいけない
  // （pgTAP "unscheduled row keeps the pre-R2 RPC key set" と対）。ここでは strict であることを固定する
  it("rejects an RPC projection with an unknown key (strict parse)", async () => {
    rpc.mockResolvedValue({
      data: { ...freeProjection, kill_source_status: null, unknown_future_key: null },
      error: null,
    });
    await expect(loadEntitlement(otherId)).rejects.toBeInstanceOf(
      BillingEntitlementUnavailableError,
    );
  });
});
