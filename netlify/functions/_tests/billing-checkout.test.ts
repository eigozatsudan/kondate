import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUS_LP_UPGRADE_COMING_SOON,
  STRIPE_API_VERSION,
} from "../../../shared/contracts/billing.js";
import {
  CHECKOUT_LOCK_TTL_MS,
  runBillingCheckout,
  type BillingCheckoutDeps,
} from "../_shared/billing-checkout.js";
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
  const sessionsList = vi.fn();
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
        checkout: {
          sessions: { create: sessionsCreate, expire: sessionsExpire, list: sessionsList },
        },
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
    sessionsList.mockReset();
    customersCreate.mockReset();
    subscriptionsList.mockReset();
    logSink.mockReset();
    authenticate.mockResolvedValue({ userId: USER_ID, email: EMAIL });
    loadEntitlement.mockResolvedValue(freeEntitlement);
    customersCreate.mockResolvedValue({ id: "cus_new" });
    subscriptionsList.mockResolvedValue({ data: [] });
    sessionsCreate.mockResolvedValue({ id: SESSION_ID, url: SESSION_URL });
    sessionsExpire.mockResolvedValue({ id: SESSION_ID });
    sessionsList.mockResolvedValue({ data: [], object: "list", has_more: false, url: "" });
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
    const response = await runBillingCheckout(request(), deps({}, { upgradeComingSoon: true }));
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
        checkout: {
          sessions: { create: sessionsCreate, expire: sessionsExpire, list: sessionsList },
        },
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

  // B5: grace 切れ past_due は非 Plus でも dual 防止で拒否するが「すでに Plus」コピーは使わない
  it("returns 409 billing_checkout_use_portal when status is past_due (B5)", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      status: "past_due",
      dbPlusEntitled: false,
      plusEntitled: false,
      pastDueGrace: false,
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "billing_checkout_use_portal",
        message: "お支払い管理から手続きしてください",
      },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  // B10: Stripe list の past_due は DB 経路と同じ use_portal（already_entitled に潰さない）
  it("returns 409 billing_checkout_use_portal when Stripe list finds past_due (B10)", async () => {
    subscriptionsList.mockImplementation((params: { status?: string }) => {
      if (params.status === "past_due") {
        return Promise.resolve({
          data: [{ id: "sub_pd", status: "past_due" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_use_portal" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
    // lock 取得後の 409 なので release される
    expect(rpc.mock.calls.some(([n]) => n === "release_billing_checkout_lock")).toBe(true);
  });

  // B10: Stripe list の incomplete は DB 経路と同じ incomplete code
  it("returns 409 billing_checkout_incomplete when Stripe list finds incomplete (B10)", async () => {
    subscriptionsList.mockImplementation((params: { status?: string }) => {
      if (params.status === "incomplete") {
        return Promise.resolve({
          data: [{ id: "sub_inc", status: "incomplete" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_incomplete" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  // B9/B10: DB free + Stripe active は already_entitled ではなく Portal 誘導
  it("returns 409 billing_checkout_use_portal when Stripe list finds active while DB free (B9)", async () => {
    subscriptionsList.mockImplementation((params: { status?: string }) => {
      if (params.status === "active") {
        return Promise.resolve({
          data: [{ id: "sub_live", status: "active" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_use_portal" },
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

    // B16: list は create 前に 2 回（初回 + re-list）。status 4 種 × 2
    expect(subscriptionsList).toHaveBeenCalledTimes(8);
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

  // B16: 初回 list は空、create 直前 re-list で live → 409 use_portal（Session 未作成）
  it("B16: re-lists before sessions.create and rejects live injected after first list", async () => {
    let listRound = 0;
    subscriptionsList.mockImplementation((params: { status?: string }) => {
      // 1 ラウンド = status 4 種。2 ラウンド目の active だけ live を返す
      if (params.status === "trialing") {
        listRound += 1;
      }
      if (listRound >= 2 && params.status === "active") {
        return Promise.resolve({
          data: [{ id: "sub_late", status: "active" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_use_portal" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_lock_token: LOCK_TOKEN,
      }),
    );
  });

  // B6: release が { error } を返しても silent fail しない（details.release_failed + ログ）
  it("surfaces release_failed when lock release RPC errors after create failure (B6)", async () => {
    sessionsCreate.mockRejectedValue(new Error("stripe down"));
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
      if (name === "release_billing_checkout_lock") {
        return { data: null, error: { message: "db down" } };
      }
      return { data: null, error: null };
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "request_failed",
        details: { release_failed: true },
      },
    });
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "billing_checkout_release_failed",
        alertMetric: 1,
      }),
    );
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

  it("expires leftover open Sessions and pins Session expires_at to lock TTL (B1)", async () => {
    const oldSessionId = "cs_old_open";
    sessionsList.mockResolvedValue({
      data: [{ id: oldSessionId, status: "open" }],
      object: "list",
      has_more: false,
      url: "",
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    expect(sessionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing", status: "open" }),
    );
    expect(sessionsExpire).toHaveBeenCalledWith(oldSessionId);
    const createArgs = sessionsCreate.mock.calls[0]![0] as { expires_at: number };
    // B-R1: create 直前 now+30m 以上。凍結 now でも Stripe 下限（1800s）を割らない
    expect(createArgs.expires_at).toBeGreaterThanOrEqual(
      Math.floor((Date.parse("2026-07-29T12:00:00.000Z") + CHECKOUT_LOCK_TTL_MS) / 1000),
    );
    expect(sessionsExpire).toHaveBeenCalledTimes(1);
  });

  it("sets Session expires_at from create-time now, not lock-time (B-R1)", async () => {
    // restore / lock / create の各 now をずらす。lock 時刻固定だと Stripe 下限割れを見逃す
    let nowMs = Date.parse("2026-07-29T12:00:00.000Z");
    let lockExpiresAtIso: string | undefined;
    rpc.mockImplementation((name: string, args?: { p_expires_at?: string }) => {
      if (name === "get_billing_customer_by_user") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      if (name === "has_billing_trial_history") {
        return { data: false, error: null };
      }
      if (name === "acquire_billing_checkout_lock") {
        lockExpiresAtIso = args?.p_expires_at;
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
    const response = await runBillingCheckout(request(), {
      ...deps(),
      now: () => {
        const current = new Date(nowMs);
        nowMs += 1_000;
        return current;
      },
    });
    expect(response.status).toBe(200);
    expect(lockExpiresAtIso).toBeDefined();
    const createArgs = sessionsCreate.mock.calls[0]![0] as { expires_at: number };
    const lockExpiresUnix = Math.floor(new Date(lockExpiresAtIso!).getTime() / 1000);
    expect(createArgs.expires_at).toBeGreaterThan(lockExpiresUnix);
    expect(createArgs.expires_at - lockExpiresUnix).toBeGreaterThanOrEqual(1);
  });

  it("returns 503 when leftover open Session expire fails before create (B1)", async () => {
    sessionsList.mockResolvedValue({
      data: [{ id: "cs_old_open", status: "open" }],
      object: "list",
      has_more: false,
      url: "",
    });
    sessionsExpire.mockRejectedValue(new Error("expire down"));
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "billing_checkout_session_expire_failed",
        alertMetric: 1,
      }),
    );
  });

  it("does not 409 from stale kill_source; Stripe list is the live guard (B2)", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      status: "unpaid",
      plusEntitled: false,
      dbPlusEntitled: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      killSourceStatus: "active",
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(subscriptionsList).toHaveBeenCalled();
  });

  it("still 409s via Stripe list when kill_source is stale but a live sub exists (B2)", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      status: "unpaid",
      plusEntitled: false,
      dbPlusEntitled: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      killSourceStatus: "active",
    });
    subscriptionsList.mockImplementation((params: { status?: string }) => {
      if (params.status === "active") {
        return Promise.resolve({ data: [{ id: "sub_live", status: "active" }] });
      }
      return Promise.resolve({ data: [] });
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_checkout_use_portal" },
    });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("allows checkout after kill-unpaid canceled source once Stripe list is empty (B2)", async () => {
    loadEntitlement.mockResolvedValue({
      ...freeEntitlement,
      status: "unpaid",
      plusEntitled: false,
      dbPlusEntitled: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      killSourceStatus: "canceled",
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when customer search throws instead of creating another Customer (B3)", async () => {
    const customersSearch = vi.fn().mockRejectedValue(new Error("search index down"));
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_user") {
        return { data: null, error: null };
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
    expect(customersSearch).toHaveBeenCalled();
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("expires every page of leftover open Sessions (B13)", async () => {
    sessionsList
      .mockResolvedValueOnce({
        data: [{ id: "cs_old_page1", status: "open" }],
        object: "list",
        has_more: true,
        url: "",
      })
      .mockResolvedValueOnce({
        data: [{ id: "cs_old_page2", status: "open" }],
        object: "list",
        has_more: false,
        url: "",
      });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    expect(sessionsList).toHaveBeenCalledTimes(2);
    expect(sessionsList.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ starting_after: "cs_old_page1" }),
    );
    expect(sessionsExpire).toHaveBeenCalledWith("cs_old_page1");
    expect(sessionsExpire).toHaveBeenCalledWith("cs_old_page2");
  });

  it("returns 503 when Session url host is not an allowed Stripe host (B14)", async () => {
    sessionsCreate.mockResolvedValue({
      id: SESSION_ID,
      url: "https://evil.example/phish",
    });
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(503);
    expect(sessionsExpire).toHaveBeenCalledWith(SESSION_ID);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_failed" },
    });
  });

  it("pins Session expires_at to lock TTL without the +60s tail (B12)", async () => {
    const response = await runBillingCheckout(request(), deps());
    expect(response.status).toBe(200);
    const createArgs = sessionsCreate.mock.calls[0]![0] as { expires_at: number };
    expect(createArgs.expires_at).toBe(
      Math.floor((Date.parse("2026-07-29T12:00:00.000Z") + CHECKOUT_LOCK_TTL_MS) / 1000),
    );
  });
});
