import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "../../../shared/contracts/billing.js";
import type { Entitlement } from "../_shared/billing-entitlement.js";
import type { ServerEnv } from "../_shared/env.js";
import { HttpError } from "../_shared/http.js";
import {
  isBillingPortalAllowed,
  runBillingPortal,
  type BillingPortalDeps,
} from "../billing-portal.js";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "cus_portal_1";
const PORTAL_URL = "https://billing.stripe.com/p/session/test";

function baseEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    VITE_SUPABASE_URL: "http://127.0.0.1:8000",
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
    SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
    AUTH_CONTINUATION_TTL_SECONDS: 300,
    AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    SUPABASE_PUBLISHABLE_KEY: "pub",
    OPENROUTER_API_KEY: "k",
    OPENROUTER_MODELS: "mock/a:free",
    OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
    isLocal: true,
    aiQuotaDisabled: false,
    supabase: {
      url: "http://kong:8000",
      publishableKey: "pub",
      serviceRoleKey: "service-role-key-at-least-twenty-characters",
    },
    openRouter: {
      apiKey: "k",
      baseUrl: "http://openrouter-mock:8787/api/v1",
      models: ["mock/a:free"],
      userDailyLimit: 3,
      userDailyAttemptLimit: 6,
      userShortWindowLimit: 4,
      userShortWindowSeconds: 600,
      globalDailyLimit: 20,
      timeoutMs: 24_000,
      functionTotalBudgetMs: 55_000,
      staleAfterSeconds: 180,
    },
    generationIntegrity: { requestHmacKey: new Uint8Array(32) },
    quotaIdentityHmacKey: new Uint8Array(32).fill(3),
    billingEnabled: true,
    stripe: {
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      pricePlusMonthly: "price_m",
      pricePlusYearly: "price_y",
      apiVersion: STRIPE_API_VERSION,
    },
    ...overrides,
  } as ServerEnv;
}

const freeNone: Entitlement = {
  plan: "free",
  status: "none",
  plusEntitled: false,
  pastDueGrace: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: false,
};

const plusActive: Entitlement = {
  ...freeNone,
  plan: "plus",
  status: "active",
  plusEntitled: true,
  currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  dbPlusEntitled: true,
};

describe("isBillingPortalAllowed (B9)", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("allows dbPlusEntitled and live incomplete/past_due", () => {
    expect(isBillingPortalAllowed(plusActive, now)).toBe(true);
    expect(
      isBillingPortalAllowed({ ...freeNone, status: "incomplete", dbPlusEntitled: false }, now),
    ).toBe(true);
    expect(
      isBillingPortalAllowed(
        { ...freeNone, status: "past_due", pastDueGrace: false, dbPlusEntitled: false },
        now,
      ),
    ).toBe(true);
  });

  it("allows canceled only while current period remains", () => {
    expect(
      isBillingPortalAllowed(
        {
          ...freeNone,
          status: "canceled",
          currentPeriodEnd: "2026-08-15T00:00:00.000Z",
          dbPlusEntitled: false,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isBillingPortalAllowed(
        {
          ...freeNone,
          status: "canceled",
          currentPeriodEnd: "2026-07-01T00:00:00.000Z",
          dbPlusEntitled: false,
        },
        now,
      ),
    ).toBe(false);
  });

  it("rejects free terminal with only historical customer map", () => {
    expect(isBillingPortalAllowed(freeNone, now)).toBe(false);
  });
});

describe("runBillingPortal", () => {
  const authenticate = vi.fn();
  const loadEntitlement = vi.fn();
  const rpc = vi.fn();
  const portalCreate = vi.fn();

  function deps(overrides: Partial<BillingPortalDeps> = {}): BillingPortalDeps {
    return {
      env: baseEnv(),
      authenticate,
      loadEntitlement,
      stripe: {
        billingPortal: {
          sessions: { create: portalCreate },
        },
      },
      admin: { rpc },
      requestId: "req-portal-1",
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  function request(): Request {
    return new Request("http://127.0.0.1/api/billing/portal", { method: "POST" });
  }

  beforeEach(() => {
    authenticate.mockReset();
    loadEntitlement.mockReset();
    rpc.mockReset();
    portalCreate.mockReset();
    authenticate.mockResolvedValue({ userId: USER_ID, email: "user@example.com" });
    loadEntitlement.mockResolvedValue(plusActive);
    rpc.mockResolvedValue({ data: { stripe_customer_id: CUSTOMER_ID }, error: null });
    portalCreate.mockResolvedValue({ url: PORTAL_URL });
  });

  it("returns 503 when billing is disabled", async () => {
    const response = await runBillingPortal(
      request(),
      deps({ env: baseEnv({ billingEnabled: false }) }),
    );
    expect(response.status).toBe(503);
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when free terminal even if customer map exists (B9)", async () => {
    loadEntitlement.mockResolvedValue(freeNone);
    const response = await runBillingPortal(request(), deps());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_portal_unavailable" },
    });
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it("returns portal url when entitled and customer mapped", async () => {
    const response = await runBillingPortal(request(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { url: PORTAL_URL },
    });
    expect(portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER_ID, locale: "ja" }),
    );
  });

  it("returns 401 when authentication fails", async () => {
    authenticate.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const response = await runBillingPortal(request(), deps());
    expect(response.status).toBe(401);
  });
});
