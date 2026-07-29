import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import type { ServerEnv } from "./env.js";
import { json } from "./http.js";
import type { SafeLogEvent } from "./logger.js";
import { createSafeLogger } from "./logger.js";
import { computeQuotaIdentityKey } from "./quota-identity.js";

const processOutcomeSchema = z
  .object({
    ok: z.literal(true),
    outcome: z.enum([
      "applied",
      "duplicate_processed",
      "stale_ignored",
      "same_second_skip",
      "event_only",
    ]),
  })
  .loose();

export type ProcessBillingOutcome = z.infer<typeof processOutcomeSchema>["outcome"];

/** Stripe Subscription から process RPC 用の投影フィールドを抽出する。 */
export type SubscriptionProjection = {
  stripe_subscription_id: string;
  stripe_price_id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: string;
  current_period_end: string;
  trial_end: string | null;
};

/** unit 注入用の最小 Stripe 面。SDK 全体を要求しない。 */
export type BillingWebhookStripe = {
  webhooks: {
    constructEvent: (
      payload: string | Buffer,
      header: string | string[] | Buffer,
      secret: string,
    ) => Stripe.Event;
  };
  subscriptions: {
    retrieve: (id: string) => Promise<Stripe.Subscription>;
    cancel: (id: string) => Promise<Stripe.Subscription>;
    list: (params: Stripe.SubscriptionListParams) => Promise<Stripe.ApiList<Stripe.Subscription>>;
  };
};

/** unit 注入用の最小 admin 面。 */
export type BillingWebhookAdmin = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user: { id: string; email?: string | null } | null };
        error: unknown;
      }>;
    };
  };
};

export type BillingWebhookDeps = {
  env: ServerEnv;
  stripe: BillingWebhookStripe;
  admin: BillingWebhookAdmin;
  log?: (event: SafeLogEvent) => void;
  now?: () => Date;
  requestId?: string;
};

/**
 * acacia ピンでは Subscription に current_period_* がある。
 * SDK 型は最新 dahlia（item 側）のみのため両系統を読む。
 */
function periodUnixFromSubscription(sub: Stripe.Subscription): {
  start: number | null;
  end: number | null;
} {
  const legacy = sub as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  if (
    typeof legacy.current_period_start === "number" &&
    typeof legacy.current_period_end === "number"
  ) {
    return { start: legacy.current_period_start, end: legacy.current_period_end };
  }
  const item = sub.items.data[0];
  if (
    item !== undefined &&
    typeof item.current_period_start === "number" &&
    typeof item.current_period_end === "number"
  ) {
    return { start: item.current_period_start, end: item.current_period_end };
  }
  return { start: null, end: null };
}

const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

function unixToIsoZ(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Stripe Subscription オブジェクトから投影用フィールドを取り出す。
 * items.data[0].price を正とする（設計）。
 */
export function projectionFromSubscription(
  sub: Stripe.Subscription,
): SubscriptionProjection | null {
  const firstItem = sub.items.data[0];
  const priceId = firstItem?.price.id;
  if (typeof priceId !== "string" || priceId.length === 0) return null;
  const { start, end } = periodUnixFromSubscription(sub);
  const periodStart = unixToIsoZ(start);
  const periodEnd = unixToIsoZ(end);
  if (periodStart === null || periodEnd === null) return null;
  return {
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_end: unixToIsoZ(sub.trial_end),
  };
}

function customerIdFrom(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  // DeletedCustomer は deleted: true。Customer 側は deleted?: void。
  if ("deleted" in value && (value as { deleted?: boolean }).deleted === true) {
    return null;
  }
  if ("id" in value && typeof value.id === "string") return value.id;
  return null;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  // acacia 互換: top-level subscription。dahlia 型では parent.subscription_details 側。
  const legacy = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const sub = legacy.subscription;
  if (typeof sub === "string" && sub.length > 0) return sub;
  if (sub !== null && sub !== undefined && typeof sub === "object" && "id" in sub) {
    return typeof sub.id === "string" ? sub.id : null;
  }
  const details = invoice.parent?.subscription_details;
  if (details === null || details === undefined) return null;
  const parentSub = details.subscription;
  if (typeof parentSub === "string") {
    return parentSub.length > 0 ? parentSub : null;
  }
  return parentSub.id;
}

/**
 * user 解決: metadata.supabase_user_id → billing_customers by stripe_customer_id。
 * どちらも無ければ null（200 + billing_user_unmapped）。
 */
export async function resolveBillingUserId(
  admin: BillingWebhookAdmin,
  options: {
    metadataUserId: string | null | undefined;
    stripeCustomerId: string | null;
  },
): Promise<string | null> {
  const meta = options.metadataUserId;
  if (typeof meta === "string" && meta.length > 0) {
    return meta;
  }
  if (options.stripeCustomerId === null) return null;
  const { data, error } = await admin.rpc("get_billing_customer_by_stripe_id", {
    p_stripe_customer_id: options.stripeCustomerId,
  });
  if (error !== null || data === null || typeof data !== "object") return null;
  const userId = (data as { user_id?: unknown }).user_id;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

async function processStripeEvent(
  admin: BillingWebhookAdmin,
  payload: Record<string, unknown>,
): Promise<ProcessBillingOutcome> {
  const { data, error } = await admin.rpc("process_billing_stripe_event", {
    p_payload: payload,
  });
  if (error !== null) {
    throw new Error(error.message ?? "process_billing_stripe_event_failed");
  }
  const parsed = processOutcomeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("process_billing_stripe_event_invalid_response");
  }
  return parsed.data.outcome;
}

/**
 * 二重 live subscription: 新しい方を Stripe cancel、DB は古い方 keep。
 */
export async function cancelDualLiveSubscriptions(
  deps: {
    stripe: BillingWebhookStripe;
    admin: BillingWebhookAdmin;
    log: (event: SafeLogEvent) => void;
    requestId: string;
    startedAt: number;
  },
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const listed = await deps.stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 20,
  });
  const live = listed.data.filter((sub) => LIVE_SUB_STATUSES.has(sub.status));
  if (live.length <= 1) return;

  const sorted = [...live].sort((a, b) => a.created - b.created);
  const keep = sorted[0];
  if (keep === undefined) return;

  for (const newer of sorted.slice(1)) {
    await deps.stripe.subscriptions.cancel(newer.id);
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_dual_subscription_canceled",
      durationMs: Date.now() - deps.startedAt,
      stripeCustomerId,
      stripeSubscriptionId: newer.id,
    });
  }

  await deps.admin.rpc("mark_billing_subscription_dual_cancel_keep", {
    p_user_id: userId,
    p_keep_stripe_subscription_id: keep.id,
  });
}

/**
 * 初回 trialing|active 後に trial_history を server identity_key で焼成（A7）。
 * email 欠落は fail-closed（焼かない + log）。
 */
export async function maybeInsertTrialHistory(
  deps: {
    admin: BillingWebhookAdmin;
    env: ServerEnv;
    log: (event: SafeLogEvent) => void;
    requestId: string;
    startedAt: number;
  },
  userId: string,
  status: string,
  outcome: ProcessBillingOutcome,
): Promise<void> {
  if (status !== "trialing" && status !== "active") return;
  // applied または既に投影済み相当（duplicate は trial を再焼かないが冪等 insert も可）
  if (outcome !== "applied" && outcome !== "duplicate_processed") return;

  const { data: userData, error: userError } = await deps.admin.auth.admin.getUserById(userId);
  if (userError !== null || userData.user === null) {
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_trial_identity_unavailable",
      durationMs: Date.now() - deps.startedAt,
    });
    return;
  }
  const email = userData.user.email;
  if (email === null || email === undefined || email.length === 0) {
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_trial_identity_unavailable",
      durationMs: Date.now() - deps.startedAt,
    });
    return;
  }
  const identityKey = computeQuotaIdentityKey(deps.env.quotaIdentityHmacKey, email);
  await deps.admin.rpc("insert_billing_trial_history", {
    p_identity_key: identityKey,
  });
}

async function handleSubscriptionEvent(
  deps: BillingWebhookDeps,
  event: Stripe.Event,
  log: (event: SafeLogEvent) => void,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = customerIdFrom(sub.customer);
  const metadataUserId =
    typeof sub.metadata.supabase_user_id === "string" ? sub.metadata.supabase_user_id : null;

  const userId = await resolveBillingUserId(deps.admin, {
    metadataUserId,
    stripeCustomerId: customerId,
  });
  if (userId === null) {
    log({
      level: "warn",
      requestId,
      code: "billing_user_unmapped",
      durationMs: Date.now() - startedAt,
      alertMetric: 1,
      ...(customerId === null ? {} : { stripeCustomerId: customerId }),
    });
    return json(200, {
      ok: true,
      data: { handled: true, code: "billing_user_unmapped" },
    });
  }

  if (customerId !== null && LIVE_SUB_STATUSES.has(sub.status)) {
    await cancelDualLiveSubscriptions(
      { stripe: deps.stripe, admin: deps.admin, log, requestId, startedAt },
      userId,
      customerId,
    );
  }

  // 同一秒の決定論: retrieve を正として payload に載せる（evt_ 文字列順は使わない）
  let retrieved: SubscriptionProjection | null = null;
  try {
    const liveSub = await deps.stripe.subscriptions.retrieve(sub.id);
    retrieved = projectionFromSubscription(liveSub);
  } catch {
    retrieved = projectionFromSubscription(sub);
  }
  const projection = retrieved ?? projectionFromSubscription(sub);
  if (projection === null) {
    // 投影不能は event 記録のみ（再送地獄回避で 200）
    const outcome = await processStripeEvent(deps.admin, {
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: event.created,
      user_id: userId,
      skip_subscription_projection: true,
    });
    log({
      level: "info",
      requestId,
      code: "billing_webhook_ok",
      durationMs: Date.now() - startedAt,
      billingStatus: sub.status,
    });
    return json(200, { ok: true, data: { outcome } });
  }

  const clearPastDue =
    projection.status === "active" ||
    projection.status === "trialing" ||
    event.type === "customer.subscription.deleted";

  const outcome = await processStripeEvent(deps.admin, {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_event_created: event.created,
    user_id: userId,
    stripe_subscription_id: projection.stripe_subscription_id,
    stripe_price_id: projection.stripe_price_id,
    status: event.type === "customer.subscription.deleted" ? "canceled" : projection.status,
    cancel_at_period_end: projection.cancel_at_period_end,
    current_period_start: projection.current_period_start,
    current_period_end: projection.current_period_end,
    trial_end: projection.trial_end,
    clear_past_due_since: clearPastDue,
    // same-second 用。RPC が created 比較後に参照。evt_ 辞書順は使わない。
    retrieved_subscription: {
      status: event.type === "customer.subscription.deleted" ? "canceled" : projection.status,
      stripe_price_id: projection.stripe_price_id,
      stripe_subscription_id: projection.stripe_subscription_id,
      cancel_at_period_end: projection.cancel_at_period_end,
      current_period_start: projection.current_period_start,
      current_period_end: projection.current_period_end,
      trial_end: projection.trial_end,
    },
  });

  if (outcome === "stale_ignored") {
    log({
      level: "info",
      requestId,
      code: "billing_webhook_stale",
      durationMs: Date.now() - startedAt,
      billingStatus: projection.status,
      stripeSubscriptionId: projection.stripe_subscription_id,
    });
  } else if (outcome === "same_second_skip") {
    log({
      level: "info",
      requestId,
      code: "billing_webhook_same_second_skip",
      durationMs: Date.now() - startedAt,
      billingStatus: projection.status,
      stripeSubscriptionId: projection.stripe_subscription_id,
    });
  } else {
    log({
      level: "info",
      requestId,
      code: "billing_webhook_ok",
      durationMs: Date.now() - startedAt,
      billingStatus: projection.status,
      stripeSubscriptionId: projection.stripe_subscription_id,
    });
  }

  const statusForTrial =
    event.type === "customer.subscription.deleted" ? "canceled" : projection.status;
  await maybeInsertTrialHistory(
    { admin: deps.admin, env: deps.env, log, requestId, startedAt },
    userId,
    statusForTrial,
    outcome,
  );

  return json(200, { ok: true, data: { outcome } });
}

async function handleCheckoutSessionEvent(
  deps: BillingWebhookDeps,
  event: Stripe.Event,
  log: (event: SafeLogEvent) => void,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  const session = event.data.object as Stripe.Checkout.Session;
  const metadataUserId =
    typeof session.metadata?.supabase_user_id === "string"
      ? session.metadata.supabase_user_id
      : typeof session.client_reference_id === "string"
        ? session.client_reference_id
        : null;
  const customerId = customerIdFrom(session.customer);

  const userId = await resolveBillingUserId(deps.admin, {
    metadataUserId,
    stripeCustomerId: customerId,
  });

  // lock 解放は session id で（user 解決できなくても session 側で no-op になり得る）
  if (userId !== null && typeof session.id === "string") {
    await deps.admin.rpc("release_billing_checkout_lock", {
      p_user_id: userId,
      p_stripe_checkout_session_id: session.id,
    });
  }

  // subscription 投影は subscription イベントに寄せる。event 記録のみ。
  const outcome = await processStripeEvent(deps.admin, {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_event_created: event.created,
    ...(userId === null ? { skip_subscription_projection: true } : { user_id: userId }),
    skip_subscription_projection: true,
  });

  log({
    level: "info",
    requestId,
    code: "billing_webhook_ok",
    durationMs: Date.now() - startedAt,
  });
  return json(200, { ok: true, data: { outcome, released: userId !== null } });
}

async function handleInvoiceEvent(
  deps: BillingWebhookDeps,
  event: Stripe.Event,
  log: (event: SafeLogEvent) => void,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = subscriptionIdFromInvoice(invoice);
  const customerId = customerIdFrom(invoice.customer);

  if (subId === null) {
    const outcome = await processStripeEvent(deps.admin, {
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: event.created,
      skip_subscription_projection: true,
    });
    return json(200, { ok: true, data: { outcome } });
  }

  let sub: Stripe.Subscription;
  try {
    sub = await deps.stripe.subscriptions.retrieve(subId);
  } catch {
    const outcome = await processStripeEvent(deps.admin, {
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: event.created,
      skip_subscription_projection: true,
    });
    return json(200, { ok: true, data: { outcome } });
  }

  const metadataUserId =
    typeof sub.metadata.supabase_user_id === "string" ? sub.metadata.supabase_user_id : null;
  const userId = await resolveBillingUserId(deps.admin, {
    metadataUserId,
    stripeCustomerId: customerId ?? customerIdFrom(sub.customer),
  });
  if (userId === null) {
    log({
      level: "warn",
      requestId,
      code: "billing_user_unmapped",
      durationMs: Date.now() - startedAt,
      alertMetric: 1,
    });
    return json(200, {
      ok: true,
      data: { handled: true, code: "billing_user_unmapped" },
    });
  }

  const projection = projectionFromSubscription(sub);
  if (projection === null) {
    return json(200, { ok: true, data: { outcome: "event_only" } });
  }

  const isPaid = event.type === "invoice.paid";
  const status = isPaid
    ? projection.status === "past_due"
      ? "active"
      : projection.status
    : projection.status === "past_due"
      ? "past_due"
      : projection.status;

  const outcome = await processStripeEvent(deps.admin, {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_event_created: event.created,
    user_id: userId,
    stripe_subscription_id: projection.stripe_subscription_id,
    stripe_price_id: projection.stripe_price_id,
    status,
    cancel_at_period_end: projection.cancel_at_period_end,
    current_period_start: projection.current_period_start,
    current_period_end: projection.current_period_end,
    trial_end: projection.trial_end,
    clear_past_due_since: isPaid,
    retrieved_subscription: {
      status,
      stripe_price_id: projection.stripe_price_id,
      stripe_subscription_id: projection.stripe_subscription_id,
      cancel_at_period_end: projection.cancel_at_period_end,
      current_period_start: projection.current_period_start,
      current_period_end: projection.current_period_end,
      trial_end: projection.trial_end,
    },
  });

  log({
    level: "info",
    requestId,
    code: outcome === "stale_ignored" ? "billing_webhook_stale" : "billing_webhook_ok",
    durationMs: Date.now() - startedAt,
    billingStatus: status,
    stripeSubscriptionId: projection.stripe_subscription_id,
  });
  return json(200, { ok: true, data: { outcome } });
}

async function handleCustomerOnlyEvent(
  deps: BillingWebhookDeps,
  event: Stripe.Event,
  log: (event: SafeLogEvent) => void,
  requestId: string,
  startedAt: number,
): Promise<Response> {
  // customer.* は mapping 確認のみ。email はログしない。event 記録。
  const outcome = await processStripeEvent(deps.admin, {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_event_created: event.created,
    skip_subscription_projection: true,
  });
  log({
    level: "info",
    requestId,
    code: "billing_webhook_ok",
    durationMs: Date.now() - startedAt,
  });
  return json(200, { ok: true, data: { outcome } });
}

/**
 * Stripe Webhook の本体。
 * - 署名検証は body parse 前（constructEvent が raw body を要求）
 * - BILLING_ENABLED 非依存（鍵があれば稼働 = A3）
 * - subscription 投影の DB 書込は process_billing_stripe_event 1 回のみ
 */
export async function handleBillingWebhook(
  request: Request,
  deps: BillingWebhookDeps,
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = deps.requestId ?? randomUUID();
  const log = deps.log ?? createSafeLogger();

  const stripeConfig = deps.env.stripe;
  if (stripeConfig === undefined) {
    return json(503, {
      ok: false,
      error: {
        code: "billing_disabled",
        message: "お支払い機能を利用できません",
      },
    });
  }

  const signature = request.headers.get("stripe-signature");
  if (signature === null || signature.length === 0) {
    return json(400, {
      ok: false,
      error: { code: "invalid_signature", message: "署名を確認できません" },
    });
  }

  // 署名検証は raw body。JSON parse 前に constructEvent。
  const rawBody = Buffer.from(await request.arrayBuffer());
  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(rawBody, signature, stripeConfig.webhookSecret);
  } catch {
    return json(400, {
      ok: false,
      error: { code: "invalid_signature", message: "署名を確認できません" },
    });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return await handleSubscriptionEvent(deps, event, log, requestId, startedAt);
      case "checkout.session.completed":
      case "checkout.session.expired":
        return await handleCheckoutSessionEvent(deps, event, log, requestId, startedAt);
      case "invoice.paid":
      case "invoice.payment_failed":
        return await handleInvoiceEvent(deps, event, log, requestId, startedAt);
      case "customer.created":
      case "customer.updated":
        return await handleCustomerOnlyEvent(deps, event, log, requestId, startedAt);
      default: {
        // 未対応 type も event 記録のみで 200（再送地獄回避）
        const outcome = await processStripeEvent(deps.admin, {
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_event_created: event.created,
          skip_subscription_projection: true,
        });
        log({
          level: "info",
          requestId,
          code: "billing_webhook_ok",
          durationMs: Date.now() - startedAt,
        });
        return json(200, { ok: true, data: { outcome } });
      }
    }
  } catch {
    return json(500, {
      ok: false,
      error: { code: "request_failed", message: "処理を完了できませんでした" },
    });
  }
}
