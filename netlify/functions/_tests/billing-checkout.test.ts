import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUS_LP_UPGRADE_COMING_SOON,
  STRIPE_API_VERSION,
} from "../../../shared/contracts/billing.js";
import { runBillingCheckout, type BillingCheckoutDeps } from "../_shared/billing-checkout.js";
import type { Entitlement } from "../_shared/billing-entitlement.js";
import type { ServerEnv } from "../_shared/env.js";
import { HttpError } from "../_shared/http.js";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const EMAIL = "user@example.com";
const LOCK_TOKEN = "lock-token-uuid-1";
const SESSION_ID = "cs_test_123";
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_123";

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

const freeEntitlement: Entitlement = {
  plan: "free",
  status: "none",
  plusEntitled: false,
  pastDueGrace: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: false,
};

describe("runBillingCheckout", () => {
  const authenticate = vi.fn();
  const loadEntitlement = vi.fn();
  const rpc = vi.fn();
  const sessionsCreate = vi.fn();
  const sessionsExpire = vi.fn();
  const customersCreate = vi.fn();
  const subscriptionsList = vi.fn();
  const logSink = vi.fn();

  function deps(
    envOverrides: Partial<ServerEnv> = {},
    options: { upgradeComingSoon?: boolean } = {},
  ): BillingCheckoutDeps {
    return {
      env: baseEnv(envOverrides),
      authenticate,
      loadEntitlement,
      stripe: {
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate, expire: sessionsExpire } },
        subscriptions: { list: subscriptionsList },
      },
      admin: { rpc } as BillingCheckoutDeps["admin"],
      log: logSink,
      requestId: "req-co-1",
      createLockToken: () => LOCK_TOKEN,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
      // 既定 false: COMING_SOON 契約定数が true でも Checkout 経路本体を単体検証する
      upgradeComingSoon: options.upgradeComingSoon ?? false,
    };
  }

  function request(body: unknown = { interval: "month" }): Request {
    return new Request("http://127.0.0.1/api/billing/checkout", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    authenticate.mockReset();
    loadEntitlement.mockReset();
    rpc.mockReset();
    sessionsCreate.mockReset();
    sessionsExpire.mockReset();
    customersCreate.mockReset();
    subscriptionsList.mockReset();
    logSink.mockReset();
    authenticate.mockResolvedValue({ userId: USER_ID, email: EMAIL });
    loadEntitlement.mockResolvedValue(freeEntitlement);
    customersCreate.mockResolvedValue({ id: "cus_new" });
    subscriptionsList.mockResolvedValue({ data: [] });
    sessionsCreate.mockResolvedValue({ id: SESSION_ID, url: SESSION_URL });
    sessionsExpire.mockResolvedValue({ id: SESSION_ID });
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "bind_billing_checkout_session") {
        return {
          data: {
            ok: true,
            lock_token: LOCK_TOKEN,
            stripe_checkout_session_id: SESSION_ID,
          },
          error: null,
        };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });
  });

  it("returns 503 billing_disabled when BILLING_ENABLED=false", async () => {
    const response = await runBillingCheckout(request(), deps({ billingEnabled: false }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_disabled" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 503 billing_disabled when upgrade COMING_SOON is true (B4)", async () => {
    const response = await runBillingCheckout(
      request(),
      deps({}, { upgradeComingSoon: true }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_disabled" },
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects checkout by shared PLUS_LP_UPGRADE_COMING_SOON when override omitted (B4)", async () => {
    // 本番ハンドラ相当: deps に upgradeComingSoon を渡さない
    const productionLike: BillingCheckoutDeps = {
      env: baseEnv(),
      authenticate,
      loadEntitlement,
      stripe: {
        customers: { create: customersCreate },
        checkout: { sessions: { create: sessionsCreate, expire: sessionsExpire } },
        subscriptions: { list: subscriptionsList },
      },
      admin: { rpc } as BillingCheckoutDeps["admin"],
      log: logSink,
      requestId: "req-co-b4",
      createLockToken: () => LOCK_TOKEN,
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    };
    // 契約定数が true のあいだだけサーバ権威で拒否されることを固定
    expect(PLUS_LP_UPGRADE_COMING_SOON).toBe(true);
    const response = await runBillingCheckout(request(), productionLike);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_disabled" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 billing_checkout_in_progress when lock row exists and not expired", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return {
          data: { ok: false, failure_code: "billing_checkout_in_progress" },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_in_progress" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 billing_already_entitled when dbPlusEntitled", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_already_entitled" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 billing_checkout_incomplete when status is incomplete (B8)", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      status: "incomplete",
      dbPlusEntitled: false,
      plusEntitled: false,
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_incomplete" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("acquire → sessions.create → bind → returns url (happy path)", async () => {
    const response = await runBillingCheckout(request({ interval: "year" }), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { url: SESSION_URL },
    });

    const acquire = rpc.mock.calls.find(([n]) => n === "acquire_billing_checkout_lock");
    expect(acquire).toBeDefined();
    expect(acquire![1]).toMatchObject({
      p_user_id: USER_ID,
      p_lock_token: LOCK_TOKEN,
    });
    // acquire 時は session id を渡さない
    expect(acquire![1]).not.toHaveProperty("p_stripe_checkout_session_id");

    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const createArgs = sessionsCreate.mock.calls[0]![0] as {
      mode: string;
      customer: string;
      client_reference_id: string;
      line_items: Array<{ price: string; quantity: number }>;
      locale: string;
      allow_promotion_codes: boolean;
      payment_method_collection: string;
      success_url: string;
      cancel_url: string;
      subscription_data: {
        trial_period_days?: number;
        metadata: { supabase_user_id: string; plan_code: string };
      };
    };
    expect(createArgs).toMatchObject({
      mode: "subscription",
      customer: "cus_existing",
      client_reference_id: USER_ID,
      line_items: [{ price: "price_y", quantity: 1 }],
      locale: "ja",
      allow_promotion_codes: false,
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: 7,
        metadata: { supabase_user_id: USER_ID, plan_code: "plus" },
      },
    });
    // R-B6: success は設定のまま、cancel のみ /plus に寄せる
    expect(createArgs.success_url).toBe("http://127.0.0.1:5173/settings?billing=success");
    expect(createArgs.cancel_url).toBe("http://127.0.0.1:5173/plus?billing=cancel");

    const bind = rpc.mock.calls.find(([n]) => n === "bind_billing_checkout_session");
    expect(bind![1]).toMatchObject({
      p_user_id: USER_ID,
      p_lock_token: LOCK_TOKEN,
      p_stripe_checkout_session_id: SESSION_ID,
    });

    // acquire → create → bind の順
    const names = rpc.mock.calls.map(([n]) => n as string);
    expect(names.indexOf("acquire_billing_checkout_lock")).toBeLessThan(
      names.indexOf("bind_billing_checkout_session"),
    );
  });

  it("releases lock by token when sessions.create fails", async () => {
    sessionsCreate.mockRejectedValue(new Error("stripe down"));
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_lock_token: LOCK_TOKEN,
      }),
    );
    expect(rpc.mock.calls.some(([n]) => n === "bind_billing_checkout_session")).toBe(false);
  });

  it("expires Session and releases lock when bind fails after create", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "bind_billing_checkout_session") {
        return {
          data: { ok: false, failure_code: "billing_checkout_bind_failed" },
          error: null,
        };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(sessionsExpire).toHaveBeenCalledWith(SESSION_ID);
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({ p_lock_token: LOCK_TOKEN }),
    );
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_checkout_bind_failed" }),
    );
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_checkout_session_expired_compensation" }),
    );
  });

  it("returns 401 when authentication fails", async () => {
    authenticate.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(401);
  });

  it("acquires checkout lock before Stripe Customer ensure (A1)", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: null, error: null };
      }
      if (name === "ensure_billing_customer") {
        return { data: { ok: true }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "bind_billing_checkout_session") {
        return {
          data: {
            ok: true,
            lock_token: LOCK_TOKEN,
            stripe_checkout_session_id: SESSION_ID,
          },
          error: null,
        };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });

    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    expect(customersCreate).toHaveBeenCalledTimes(1);

    const names = rpc.mock.calls.map(([n]) => n as string);
    expect(names.indexOf("acquire_billing_checkout_lock")).toBeLessThan(
      names.indexOf("get_billing_customer_by_user"),
    );
    expect(names.indexOf("acquire_billing_checkout_lock")).toBeLessThan(
      names.indexOf("ensure_billing_customer"),
    );
  });

  it("returns 503 when subscriptions.list fails (fail-closed)", async () => {
    subscriptionsList.mockRejectedValue(new Error("stripe list down"));
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_failed" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({ p_lock_token: LOCK_TOKEN }),
    );
  });

  it("denies trial when has_billing_trial_history returns non-boolean data (fail-closed)", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        // error 無しだが data が null → 以前は falsy で trial を与えてしまっていた
        return { data: null, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "bind_billing_checkout_session") {
        return {
          data: {
            ok: true,
            lock_token: LOCK_TOKEN,
            stripe_checkout_session_id: SESSION_ID,
          },
          error: null,
        };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });

    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    const createArgs = sessionsCreate.mock.calls[0]![0] as {
      subscription_data: { trial_period_days?: number };
    };
    expect(createArgs.subscription_data.trial_period_days).toBeUndefined();
  });

  it("returns 503 when ensure_billing_customer fails on search hit", async () => {
    const customersSearch = vi.fn().mockResolvedValue({
      data: [{ id: "cus_from_search" }],
    });
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: null, error: null };
      }
      if (name === "ensure_billing_customer") {
        return { data: null, error: { message: "ensure failed" } };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });

    const d = deps();
    d.stripe = {
      ...d.stripe,
      customers: { create: customersCreate, search: customersSearch },
    };
    const response = await runBillingCheckout(request(), d);
    expect(response.status).toBe(503);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({ p_lock_token: LOCK_TOKEN }),
    );
  });

  it("expires Session and releases lock when Session URL is missing after bind", async () => {
    sessionsCreate.mockResolvedValue({ id: SESSION_ID, url: null });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(sessionsExpire).toHaveBeenCalledWith(SESSION_ID);
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({
        p_lock_token: LOCK_TOKEN,
        p_stripe_checkout_session_id: SESSION_ID,
      }),
    );
  });

  it("logs expire failure with alert when bind fails and expire throws (B10)", async () => {
    sessionsExpire.mockRejectedValue(new Error("expire down"));
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        return { data: { ok: true, lock_token: LOCK_TOKEN }, error: null };
      }
      if (name === "bind_billing_checkout_session") {
        return {
          data: { ok: false, failure_code: "billing_checkout_bind_failed" },
          error: null,
        };
      }
      if (name === "release_billing_checkout_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "billing_checkout_session_expire_failed",
        alertMetric: 1,
      }),
    );
  });
});
