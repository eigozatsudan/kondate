import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { entitlementDataSchema } from "../../../shared/contracts/billing.js";
import type { Entitlement } from "../_shared/billing-entitlement.js";

const requireUserMock = vi.hoisted(() => vi.fn());
const loadEntitlementMock = vi.hoisted(() => vi.fn());
const getServerEnvMock = vi.hoisted(() => vi.fn());

vi.mock("../_shared/auth.js", () => ({
  requireUser: requireUserMock,
}));
vi.mock("../_shared/env.js", () => ({
  getServerEnv: getServerEnvMock,
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

import billingEntitlement from "../billing-entitlement.js";

const entitlementOkEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    data: entitlementDataSchema,
  })
  .strict();

const plusEntitlement = {
  plan: "plus",
  status: "active",
  plusEntitled: true,
  pastDueGrace: false,
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: true,
} satisfies Entitlement;

function getRequest(): Request {
  return new Request("http://127.0.0.1/api/billing/entitlement", { method: "GET" });
}

describe("GET /api/billing/entitlement (B10)", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    loadEntitlementMock.mockReset();
    getServerEnvMock.mockReset();
    requireUserMock.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      accessToken: "token",
    });
    getServerEnvMock.mockReturnValue({ billingEnabled: true });
    loadEntitlementMock.mockResolvedValue(plusEntitlement);
  });

  it("does not put a broken current_period_end string on GET 200", async () => {
    // loadEntitlement / RPC が ISO でない string を返しても、wire は entitlementDataSchema に閉じる。
    loadEntitlementMock.mockResolvedValue({
      ...plusEntitlement,
      currentPeriodEnd: "not-a-date",
    });
    const response = await billingEntitlement(getRequest());
    expect(response.status).toBe(200);
    const envelope = entitlementOkEnvelopeSchema.parse(await response.json());
    expect(envelope.data.currentPeriodEnd).toBeNull();
    expect(envelope.data.plusEntitled).toBe(true);
  });

  it("does not put a broken trial_end string on GET 200", async () => {
    loadEntitlementMock.mockResolvedValue({
      ...plusEntitlement,
      trialEnd: "soon",
    });
    const response = await billingEntitlement(getRequest());
    expect(response.status).toBe(200);
    const envelope = entitlementOkEnvelopeSchema.parse(await response.json());
    expect(envelope.data.trialEnd).toBeNull();
    expect(envelope.data.plusEntitled).toBe(true);
  });

  it("returns ISO+Z dates that the client schema accepts", async () => {
    const response = await billingEntitlement(getRequest());
    expect(response.status).toBe(200);
    expect(entitlementOkEnvelopeSchema.parse(await response.json()).data).toEqual({
      plan: "plus",
      status: "active",
      plusEntitled: true,
      pastDueGrace: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      dbPlusEntitled: true,
      productSurfacesOpen: true,
      quotaPlan: "plus",
    });
  });
});
