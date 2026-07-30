import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { STRIPE_API_VERSION } from "../../../shared/contracts/billing.js";
import type { ServerEnv } from "./env.js";
import {
  handleBillingWebhook,
  subscriptionIdFromInvoice,
  type BillingWebhookDeps,
} from "./billing-webhook.js";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "cus_test_1";
const SUB_ID = "sub_test_1";

function baseEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    VITE_SUPABASE_URL: "http://127.0.0.1:8000",
    SUPABASE_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
    SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
    AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    AUTH_CONTINUATION_TTL_SECONDS: 300,
    SUPABASE_PUBLISHABLE_KEY: "publishable-test",
    OPENROUTER_API_KEY: "mock-key",
    OPENROUTER_MODELS: "mock/kondate-primary:free,mock/kondate-repair:free",
    OPENROUTER_BASE_URL: "http://openrouter-mock:8787/api/v1",
    isLocal: true,
    aiQuotaDisabled: false,
    supabase: {
      url: "http://kong:8000",
      publishableKey: "publishable-test",
      serviceRoleKey: "service-role-key-at-least-twenty-characters",
    },
    openRouter: {
      apiKey: "mock-key",
      baseUrl: "http://openrouter-mock:8787/api/v1",
      models: ["mock/kondate-primary:free", "mock/kondate-repair:free"],
      userDailyLimit: 3,
      userDailyAttemptLimit: 6,
      userShortWindowLimit: 4,
      userShortWindowSeconds: 600,
      globalDailyLimit: 20,
      timeoutMs: 24_000,
      functionTotalBudgetMs: 55_000,
      staleAfterSeconds: 180,
    },
    generationIntegrity: {
      requestHmacKey: new Uint8Array(32),
    },
    quotaIdentityHmacKey: new Uint8Array(32).fill(2),
    billingEnabled: false,
    stripe: {
      secretKey: "sk_test_xxx",
      webhookSecret: "whsec_xxx",
      pricePlusMonthly: "price_m",
      pricePlusYearly: "price_y",
      apiVersion: STRIPE_API_VERSION,
    },
    ...overrides,
  } as ServerEnv;
}

function makeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  // dahlia: period は SubscriptionItem 側（Basil 2025-03-31 以降）
  return {
    id: SUB_ID,
    object: "subscription",
    customer: CUSTOMER_ID,
    status: "active",
    cancel_at_period_end: false,
    trial_end: null,
    created: 1_720_000_000,
    metadata: { supabase_user_id: USER_ID, plan_code: "plus" },
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          object: "subscription_item",
          current_period_start: 1_720_000_000,
          current_period_end: 1_722_592_000,
          price: { id: "price_m", object: "price" },
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "",
    },
    ...overrides,
  } as Stripe.Subscription;
}

function makeEvent(
  type: Stripe.Event.Type,
  object: Stripe.Event.Data.Object,
  overrides: Partial<Stripe.Event> = {},
): Stripe.Event {
  return {
    id: "evt_test_1",
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 2000,
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    ...overrides,
  } as Stripe.Event;
}

describe("subscriptionIdFromInvoice", () => {
  it("reads dahlia parent.subscription_details.subscription string", () => {
    const invoice = {
      id: "in_dahlia_str",
      object: "invoice",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: SUB_ID },
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe(SUB_ID);
  });

  it("reads dahlia parent.subscription_details.subscription expanded object", () => {
    const invoice = {
      id: "in_dahlia_obj",
      object: "invoice",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: { id: SUB_ID, object: "subscription" } },
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe(SUB_ID);
  });

  it("falls back to legacy top-level when parent.subscription is null", () => {
    // 7b3e631 の typeof parentSub.id 直読みは null で TypeError → 500 再送嵐。
    // null/undefined は throw せず acacia 形へ落ちる。
    const invoice = {
      id: "in_parent_null",
      object: "invoice",
      subscription: SUB_ID,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: null },
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe(SUB_ID);
  });

  it("falls back to legacy when parent.subscription is undefined", () => {
    const invoice = {
      id: "in_parent_undef",
      object: "invoice",
      subscription: SUB_ID,
      parent: {
        type: "subscription_details",
        subscription_details: {},
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe(SUB_ID);
  });

  it("returns null when parent.subscription is null and no legacy subscription", () => {
    const invoice = {
      id: "in_no_sub",
      object: "invoice",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: null },
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBeNull();
  });

  it("prefers non-empty dahlia string over legacy", () => {
    const invoice = {
      id: "in_prefer_dahlia",
      object: "invoice",
      subscription: "sub_legacy",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: SUB_ID },
      },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe(SUB_ID);
  });
});

describe("handleBillingWebhook", () => {
  const constructEvent = vi.fn();
  const retrieve = vi.fn();
  const cancel = vi.fn();
  const list = vi.fn();
  const rpc = vi.fn();
  const getUserById = vi.fn();
  const logSink = vi.fn();

  function deps(envOverrides: Partial<ServerEnv> = {}): BillingWebhookDeps {
    return {
      env: baseEnv(envOverrides),
      stripe: {
        webhooks: { constructEvent },
        subscriptions: { retrieve, cancel, list },
      },
      admin: {
        rpc,
        auth: {
          admin: {
            getUserById,
          },
        },
      },
      log: logSink,
      requestId: "req-billing-1",
    };
  }

  function signedRequest(body = "{}"): Request {
    return new Request("http://127.0.0.1/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=1,v1=test",
        "content-type": "application/json",
      },
      body,
    });
  }

  beforeEach(() => {
    constructEvent.mockReset();
    retrieve.mockReset();
    cancel.mockReset();
    list.mockReset();
    rpc.mockReset();
    getUserById.mockReset();
    logSink.mockReset();
    list.mockResolvedValue({ data: [], object: "list", has_more: false, url: "" });
    retrieve.mockImplementation((id: string) => Promise.resolve(makeSubscription({ id })));
    getUserById.mockResolvedValue({
      data: { user: { id: USER_ID, email: "user@example.com" } },
      error: null,
    });
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({ data: { ok: true, outcome: "applied" }, error: null });
      }
      if (name === "insert_billing_trial_history") {
        return Promise.resolve({ data: { ok: true, inserted: true }, error: null });
      }
      if (name === "get_billing_customer_by_stripe_id") {
        return Promise.resolve({
          data: { user_id: USER_ID, stripe_customer_id: CUSTOMER_ID },
          error: null,
        });
      }
      if (name === "release_billing_checkout_lock") {
        return Promise.resolve({ data: { ok: true, released: true }, error: null });
      }
      if (name === "mark_billing_subscription_dual_cancel_keep") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it("calls process_billing_stripe_event once per delivery (not split claim+upsert)", async () => {
    const sub = makeSubscription();
    constructEvent.mockReturnValue(makeEvent("customer.subscription.updated", sub));
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    const processCalls = rpc.mock.calls.filter(([name]) => name === "process_billing_stripe_event");
    expect(processCalls).toHaveLength(1);
    expect(rpc.mock.calls.some(([name]) => name === "insert_billing_webhook_event")).toBe(false);
    expect(
      rpc.mock.calls.some(([name]) => name === "upsert_billing_subscription_from_stripe"),
    ).toBe(false);
  });

  it("after claim-then-crash before project, Stripe retry eventually projects (crash-safe)", async () => {
    const sub = makeSubscription();
    constructEvent.mockReturnValue(makeEvent("customer.subscription.updated", sub));
    let attempts = 0;
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        attempts += 1;
        if (attempts === 1) {
          return { data: null, error: { message: "tx aborted" } };
        }
        return { data: { ok: true, outcome: "applied" }, error: null };
      }
      if (name === "insert_billing_trial_history") {
        return { data: { ok: true, inserted: true }, error: null };
      }
      return { data: null, error: null };
    });

    const first = await handleBillingWebhook(signedRequest(), deps());
    expect(first.status).toBe(500);

    const second = await handleBillingWebhook(signedRequest(), deps());
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      data: { outcome: "applied" },
    });
    expect(attempts).toBe(2);
  });

  it("ignores subscription events older than last_stripe_event_created", async () => {
    const sub = makeSubscription();
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", sub, { id: "evt_old", created: 1000 }),
    );
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "stale_ignored" }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { outcome: "stale_ignored" },
    });
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_webhook_stale" }),
    );
  });

  it("does not use evt_ id lexicographic order as time tie-break", async () => {
    const sub = makeSubscription();
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", sub, {
        id: "evt_zzz_later_lex",
        created: 2000,
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "canceled" }));
    await handleBillingWebhook(signedRequest(), deps());
    const processCall = rpc.mock.calls.find(([name]) => name === "process_billing_stripe_event");
    expect(processCall).toBeDefined();
    const payload = processCall![1] as { p_payload: Record<string, unknown> };
    // same-second は retrieve 結果を payload に載せる。event.id の文字列順比較はしない。
    expect(payload.p_payload.retrieved_subscription).toMatchObject({
      status: "canceled",
      stripe_subscription_id: SUB_ID,
    });
    expect(retrieve).toHaveBeenCalledWith(SUB_ID);
  });

  it("does not re-entitle from delayed active after canceled past period_end", async () => {
    const sub = makeSubscription({ status: "active" });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", sub, { id: "evt_delayed_active", created: 1500 }),
    );
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "stale_ignored" }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { outcome: "stale_ignored" },
    });
    // 投影 mutate は process 1 回のみ・outcome で抑止（split upsert なし）
    expect(rpc.mock.calls.filter(([n]) => n === "process_billing_stripe_event")).toHaveLength(1);
  });

  it("does not re-entitle from delayed active after past_due grace expired", async () => {
    const sub = makeSubscription({ status: "active" });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", sub, { id: "evt_after_grace", created: 100 }),
    );
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "stale_ignored" }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { outcome: "stale_ignored" },
    });
  });

  it("does not re-entitle from delayed updated after subscription.deleted projection", async () => {
    const sub = makeSubscription({ status: "active" });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", sub, {
        id: "evt_after_deleted",
        created: 500,
      }),
    );
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "stale_ignored" }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { outcome: "stale_ignored" },
    });
  });

  it("sets past_due_since on first transition to past_due and clears on active", async () => {
    // past_due: clear_past_due_since を付けない（RPC が first transition を coalesce）
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", makeSubscription({ status: "past_due" }), {
        id: "evt_past_due",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "past_due" }));
    await handleBillingWebhook(signedRequest(), deps());
    let payload = (
      rpc.mock.calls.find(([n]) => n === "process_billing_stripe_event")![1] as {
        p_payload: Record<string, unknown>;
      }
    ).p_payload;
    expect(payload.status).toBe("past_due");
    expect(payload.clear_past_due_since).toBe(false);

    rpc.mockClear();
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", makeSubscription({ status: "active" }), {
        id: "evt_active_again",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "active" }));
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "applied" }, error: null };
      }
      if (name === "insert_billing_trial_history") {
        return { data: { ok: true, inserted: false }, error: null };
      }
      return { data: null, error: null };
    });
    await handleBillingWebhook(signedRequest(), deps());
    payload = (
      rpc.mock.calls.find(([n]) => n === "process_billing_stripe_event")![1] as {
        p_payload: Record<string, unknown>;
      }
    ).p_payload;
    expect(payload.status).toBe("active");
    expect(payload.clear_past_due_since).toBe(true);
  });

  it("inserts billing_trial_history on first trialing|active using server identity_key (A7)", async () => {
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", makeSubscription({ status: "trialing" }), {
        id: "evt_trial",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "trialing" }));
    await handleBillingWebhook(signedRequest(), deps());
    expect(getUserById).toHaveBeenCalledWith(USER_ID);
    const trialCall = rpc.mock.calls.find(([n]) => n === "insert_billing_trial_history");
    expect(trialCall).toBeDefined();
    const args = trialCall![1] as { p_identity_key: string };
    // client 供給ではなく server HMAC。64 hex。
    expect(args.p_identity_key).toMatch(/^[a-f0-9]{64}$/u);
    // process が先（trial は claim-only 内ではない）
    const names = rpc.mock.calls.map(([n]) => n as string);
    expect(names.indexOf("process_billing_stripe_event")).toBeLessThan(
      names.indexOf("insert_billing_trial_history"),
    );
  });

  it("returns 500 when trial_history insert fails after applied so Stripe retries (A7 fail-closed)", async () => {
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", makeSubscription({ status: "trialing" }), {
        id: "evt_trial_insert_fail",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "trialing" }));
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({ data: { ok: true, outcome: "applied" }, error: null });
      }
      if (name === "insert_billing_trial_history") {
        return Promise.resolve({
          data: null,
          error: { message: "insert failed", code: "57014" },
        });
      }
      if (name === "get_billing_customer_by_stripe_id") {
        return Promise.resolve({
          data: { user_id: USER_ID, stripe_customer_id: CUSTOMER_ID },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_trial_history_insert_failed" }),
    );
  });

  it("returns 500 when trial identity is unavailable after applied so Stripe retries", async () => {
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", makeSubscription({ status: "active" }), {
        id: "evt_trial_identity_fail",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "active" }));
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "not found" },
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(500);
    expect(rpc.mock.calls.some(([n]) => n === "insert_billing_trial_history")).toBe(false);
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_trial_identity_unavailable" }),
    );
  });

  it("inserts billing_trial_history on invoice.paid when status is active (A7 invoice path)", async () => {
    const invoice = {
      id: "in_1",
      object: "invoice",
      customer: CUSTOMER_ID,
      subscription: SUB_ID,
    } as unknown as Stripe.Invoice;
    constructEvent.mockReturnValue(makeEvent("invoice.paid", invoice, { id: "evt_invoice_trial" }));
    retrieve.mockResolvedValue(makeSubscription({ status: "active" }));
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(getUserById).toHaveBeenCalledWith(USER_ID);
    const trialCall = rpc.mock.calls.find(([n]) => n === "insert_billing_trial_history");
    expect(trialCall).toBeDefined();
    const args = trialCall![1] as { p_identity_key: string };
    expect(args.p_identity_key).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("invoice.paid with dahlia parent.subscription null still retrieves via legacy and burns trial", async () => {
    // parent.subscription_details.subscription=null でも TypeError せず legacy id で retrieve する。
    const invoice = {
      id: "in_dahlia_null_parent_sub",
      object: "invoice",
      customer: CUSTOMER_ID,
      subscription: SUB_ID,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: null },
      },
    } as unknown as Stripe.Invoice;
    constructEvent.mockReturnValue(
      makeEvent("invoice.paid", invoice, { id: "evt_invoice_dahlia_null" }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "active" }));
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith(SUB_ID);
    expect(rpc.mock.calls.some(([n]) => n === "insert_billing_trial_history")).toBe(true);
  });

  it("still burns trial on duplicate retry when live sub is canceled after prior burn failure", async () => {
    // 初回 applied + burn 500 のあと cancel され、同一 event_id が再送される経路。
    // live retrieve が canceled でも event オブジェクトは trialing のまま → 焼成必須。
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", makeSubscription({ status: "trialing" }), {
        id: "evt_trial_retry_after_cancel",
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "canceled" }));
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({
          data: { ok: true, outcome: "duplicate_processed" },
          error: null,
        });
      }
      if (name === "insert_billing_trial_history") {
        return Promise.resolve({ data: { ok: true, inserted: true }, error: null });
      }
      if (name === "get_billing_customer_by_stripe_id") {
        return Promise.resolve({
          data: { user_id: USER_ID, stripe_customer_id: CUSTOMER_ID },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    const trialCall = rpc.mock.calls.find(([n]) => n === "insert_billing_trial_history");
    expect(trialCall).toBeDefined();
  });

  it("burns trial on stale_ignored trialing event after newer cancel applied (A7 ignore-older)", async () => {
    // deleted が先に applied され、遅延 created(trialing) が stale_ignored になっても焼成必須。
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", makeSubscription({ status: "trialing" }), {
        id: "evt_trial_stale_after_cancel",
        created: 1000,
      }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "canceled" }));
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({
          data: { ok: true, outcome: "stale_ignored" },
          error: null,
        });
      }
      if (name === "insert_billing_trial_history") {
        return Promise.resolve({ data: { ok: true, inserted: true }, error: null });
      }
      if (name === "get_billing_customer_by_stripe_id") {
        return Promise.resolve({
          data: { user_id: USER_ID, stripe_customer_id: CUSTOMER_ID },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(rpc.mock.calls.some(([n]) => n === "insert_billing_trial_history")).toBe(true);
  });

  it("still burns trial on invoice.paid duplicate when live sub is canceled", async () => {
    const invoice = {
      id: "in_2",
      object: "invoice",
      customer: CUSTOMER_ID,
      subscription: SUB_ID,
    } as unknown as Stripe.Invoice;
    constructEvent.mockReturnValue(
      makeEvent("invoice.paid", invoice, { id: "evt_invoice_retry_cancel" }),
    );
    retrieve.mockResolvedValue(makeSubscription({ status: "canceled" }));
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({
          data: { ok: true, outcome: "duplicate_processed" },
          error: null,
        });
      }
      if (name === "insert_billing_trial_history") {
        return Promise.resolve({ data: { ok: true, inserted: true }, error: null });
      }
      if (name === "get_billing_customer_by_stripe_id") {
        return Promise.resolve({
          data: { user_id: USER_ID, stripe_customer_id: CUSTOMER_ID },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(rpc.mock.calls.some(([n]) => n === "insert_billing_trial_history")).toBe(true);
  });

  it("rejects invalid signature with 400 before body parse", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const response = await handleBillingWebhook(signedRequest("not-json{{{"), deps());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_signature" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("idempotent replay of same stripe_event_id returns 200 no-op", async () => {
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.updated", makeSubscription(), { id: "evt_dup" }),
    );
    rpc.mockImplementation((name: string) => {
      if (name === "process_billing_stripe_event") {
        return { data: { ok: true, outcome: "duplicate_processed" }, error: null };
      }
      if (name === "insert_billing_trial_history") {
        return { data: { ok: true, inserted: false }, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { outcome: "duplicate_processed" },
    });
    expect(rpc.mock.calls.filter(([n]) => n === "process_billing_stripe_event")).toHaveLength(1);
  });

  it("returns 200 billing_user_unmapped when user cannot be resolved and does not 500", async () => {
    const sub = makeSubscription({
      metadata: {},
      customer: "cus_unknown",
    });
    constructEvent.mockReturnValue(makeEvent("customer.subscription.updated", sub));
    rpc.mockImplementation((name: string) => {
      if (name === "get_billing_customer_by_stripe_id") {
        return { data: {}, error: null };
      }
      return { data: null, error: null };
    });
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { code: "billing_user_unmapped" },
    });
    expect(rpc.mock.calls.some(([n]) => n === "process_billing_stripe_event")).toBe(false);
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_user_unmapped", alertMetric: 1 }),
    );
  });

  it("late deleted of discarded dual-sub projects keep active instead of overwrite cancel", async () => {
    // dual cleanup 後に届く discard 側 deleted が keep を canceled 上書きしないこと（BILL-1）
    const keep = makeSubscription({
      id: "sub_keep",
      created: 1000,
      status: "active",
      metadata: { supabase_user_id: USER_ID },
    });
    const discardedDeleted = makeSubscription({
      id: "sub_discarded",
      created: 2000,
      status: "canceled",
      metadata: { supabase_user_id: USER_ID },
    });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.deleted", discardedDeleted, {
        id: "evt_discard_deleted_late",
        created: 9_000,
      }),
    );
    retrieve.mockImplementation((id: string) => {
      if (id === "sub_keep") return Promise.resolve(keep);
      return Promise.resolve(discardedDeleted);
    });
    list.mockImplementation((params: { status?: string }) => {
      const data = params.status === "active" || params.status === undefined ? [keep] : [];
      return Promise.resolve({ object: "list", data, has_more: false, url: "" });
    });

    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(cancel).not.toHaveBeenCalled();
    const processPayload = (
      rpc.mock.calls.find(([n]) => n === "process_billing_stripe_event")![1] as {
        p_payload: Record<string, unknown>;
      }
    ).p_payload;
    expect(processPayload.stripe_subscription_id).toBe("sub_keep");
    expect(processPayload.status).toBe("active");
  });

  it("cancels newer dual live subscription and keeps older entitled row", async () => {
    const older = makeSubscription({
      id: "sub_older",
      created: 1000,
      status: "active",
    });
    const newer = makeSubscription({
      id: "sub_newer",
      created: 2000,
      status: "active",
      metadata: { supabase_user_id: USER_ID },
    });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", newer, { id: "evt_dual" }),
    );
    // cancel 後の newer retrieve は canceled を返し得る。投影は keep(older) を正とする。
    retrieve.mockImplementation((id: string) => {
      if (id === "sub_newer") {
        return Promise.resolve(
          makeSubscription({ id: "sub_newer", status: "canceled", created: 2000 }),
        );
      }
      return Promise.resolve(older);
    });
    // status 別 list に対応（active だけに両方が載る）
    list.mockImplementation((params: { status?: string }) => {
      const data = params.status === "active" || params.status === undefined ? [older, newer] : [];
      return Promise.resolve({
        object: "list",
        data,
        has_more: false,
        url: "",
      });
    });
    cancel.mockResolvedValue(
      makeSubscription({ id: "sub_newer", status: "canceled", created: 2000 }),
    );

    await handleBillingWebhook(signedRequest(), deps());
    expect(cancel).toHaveBeenCalledWith("sub_newer");
    expect(rpc).toHaveBeenCalledWith(
      "mark_billing_subscription_dual_cancel_keep",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_keep_stripe_subscription_id: "sub_older",
      }),
    );
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "billing_dual_subscription_canceled" }),
    );

    const processPayload = (
      rpc.mock.calls.find(([n]) => n === "process_billing_stripe_event")![1] as {
        p_payload: Record<string, unknown>;
      }
    ).p_payload;
    // discard した newer ではなく keep(older) の id/status で投影する
    expect(processPayload.stripe_subscription_id).toBe("sub_older");
    expect(processPayload.status).toBe("active");
  });

  it("keeps newer active over older incomplete dual-sub (never cancel paid for incomplete)", async () => {
    const olderIncomplete = makeSubscription({
      id: "sub_incomplete_old",
      created: 1000,
      status: "incomplete",
    });
    const newerActive = makeSubscription({
      id: "sub_active_new",
      created: 2000,
      status: "active",
      metadata: { supabase_user_id: USER_ID },
    });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", newerActive, { id: "evt_dual_incomplete" }),
    );
    retrieve.mockResolvedValue(newerActive);
    list.mockImplementation((params: { status?: string }) => {
      const all = [olderIncomplete, newerActive];
      const data =
        params.status === undefined ? all : all.filter((sub) => sub.status === params.status);
      return Promise.resolve({ object: "list", data, has_more: false, url: "" });
    });
    cancel.mockResolvedValue(
      makeSubscription({ id: "sub_incomplete_old", status: "canceled", created: 1000 }),
    );

    await handleBillingWebhook(signedRequest(), deps());
    expect(cancel).toHaveBeenCalledWith("sub_incomplete_old");
    expect(cancel).not.toHaveBeenCalledWith("sub_active_new");
    expect(rpc).toHaveBeenCalledWith(
      "mark_billing_subscription_dual_cancel_keep",
      expect.objectContaining({
        p_keep_stripe_subscription_id: "sub_active_new",
      }),
    );
  });

  it("returns 500 when dual-sub mark_keep RPC fails", async () => {
    const older = makeSubscription({
      id: "sub_older",
      created: 1000,
      status: "active",
    });
    const newer = makeSubscription({
      id: "sub_newer",
      created: 2000,
      status: "active",
      metadata: { supabase_user_id: USER_ID },
    });
    constructEvent.mockReturnValue(
      makeEvent("customer.subscription.created", newer, { id: "evt_dual_mark_fail" }),
    );
    list.mockImplementation((params: { status?: string }) => {
      const data = params.status === "active" || params.status === undefined ? [older, newer] : [];
      return Promise.resolve({ object: "list", data, has_more: false, url: "" });
    });
    cancel.mockResolvedValue(newer);
    rpc.mockImplementation((name: string) => {
      if (name === "mark_billing_subscription_dual_cancel_keep") {
        return Promise.resolve({ data: null, error: { message: "mark failed" } });
      }
      if (name === "process_billing_stripe_event") {
        return Promise.resolve({ data: { ok: true, outcome: "applied" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(500);
    expect(rpc.mock.calls.some(([n]) => n === "process_billing_stripe_event")).toBe(false);
  });

  it("processes webhook when BILLING_ENABLED=false if secrets present (A3)", async () => {
    constructEvent.mockReturnValue(makeEvent("customer.subscription.updated", makeSubscription()));
    const response = await handleBillingWebhook(signedRequest(), deps({ billingEnabled: false }));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls.some(([n]) => n === "process_billing_stripe_event")).toBe(true);
  });

  it("releases lock by session id on checkout.session.completed webhook", async () => {
    const session = {
      id: "cs_test_session_1",
      object: "checkout.session",
      customer: CUSTOMER_ID,
      client_reference_id: USER_ID,
      metadata: { supabase_user_id: USER_ID },
    } as unknown as Stripe.Checkout.Session;
    constructEvent.mockReturnValue(
      makeEvent("checkout.session.completed", session, { id: "evt_cs_done" }),
    );
    const response = await handleBillingWebhook(signedRequest(), deps());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "release_billing_checkout_lock",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_stripe_checkout_session_id: "cs_test_session_1",
      }),
    );
    // subscription 投影は skip（subscription イベントに寄せる）
    const processPayload = (
      rpc.mock.calls.find(([n]) => n === "process_billing_stripe_event")![1] as {
        p_payload: Record<string, unknown>;
      }
    ).p_payload;
    expect(processPayload.skip_subscription_projection).toBe(true);
  });
});
