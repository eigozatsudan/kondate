import { beforeEach, describe, expect, it, vi } from "vitest";
import billingEntitlement from "../billing-entitlement.js";
import { loadEntitlement } from "../_shared/billing-entitlement.js";

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
    const body = await response.json();
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
      data: { ...freeProjection, plan: "plus", status: "active", plus_entitled: true, db_plus_entitled: true },
      error: null,
    });
    expect(await loadEntitlement(developerId)).toMatchObject({ status: "active", plusEntitled: true });
    const response = await billingEntitlement(request());
    expect(await response.json()).toMatchObject({
      data: { status: "active", plusEntitled: false, dbPlusEntitled: true, quotaPlan: "free" },
    });
  });
});
