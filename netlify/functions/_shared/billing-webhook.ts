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
 * dahlia 以降は period が SubscriptionItem 側。
 * Webhook endpoint が古い API version のときや再配信で acacia 形が来る場合に備え両系統を読む。
 */
function periodUnixFromSubscription(sub: Stripe.Subscription): {
  start: number | null;
  end: number | null;
} {
  const item = sub.items.data[0];
  if (
    item !== undefined &&
    typeof item.current_period_start === "number" &&
    typeof item.current_period_end === "number"
  ) {
    return { start: item.current_period_start, end: item.current_period_end };
  }
  // acacia 以前: top-level current_period_*（Basil 2025-03-31 で item 側へ移動）
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
  return { start: null, end: null };
}

/** Checkout 進行中の incomplete も live 候補に含む（list / dual 対象の母集団）。 */
const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

/**
 * dual-sub keep 優先: entitled（trialing/active/past_due）を incomplete より常に優先。
 * 古い incomplete Checkout 残骸を keep し、後からできた active を cancel しない（設計: 先に entitled）。
 */
function dualSubKeepRank(status: string): number {
  if (status === "trialing" || status === "active" || status === "past_due") return 0;
  if (status === "incomplete") return 1;
  return 2;
}

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

/**
 * Invoice から subscription id を取り出す。
 * dahlia は parent.subscription_details.subscription、acacia 以前は top-level subscription。
 * parent 側が null/undefined のときは legacy へ落ちる（throw 禁止 — webhook 500 再送嵐を防ぐ）。
 * Stripe SDK 型は null を許さないが、実 payload / 再配信では null が来得るため unknown 経由で読む。
 */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details;
  if (details !== null && details !== undefined) {
    // unknown: SDK 上は string | Subscription だが runtime null を TypeError なく扱う
    const parentSub: unknown = details.subscription;
    const fromParent = subscriptionIdFromUnknown(parentSub);
    if (fromParent !== null) return fromParent;
  }
  const legacy = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  return subscriptionIdFromUnknown(legacy.subscription);
}

/** string / {id} / null|undefined を TypeError なしで subscription id に正規化する */
function subscriptionIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (!("id" in value)) {
    return null;
  }
  const id = Reflect.get(value, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
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

/** dual-sub 整理の結果。canonical 投影は keep 側を正とする。 */
export type DualSubscriptionCleanup = {
  keepSubscriptionId: string | null;
  discardedSubscriptionIds: readonly string[];
};

/**
 * 二重 live subscription: keep は entitled 優先・同順位なら created が古い方、他を Stripe cancel。
 * 呼び出し側は discarded に含まれるイベント subscription を通常 projection してはならない。
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
): Promise<DualSubscriptionCleanup> {
  // status 別 list で terminal 履歴に埋もれた live を落とさない（単一 page status=all は不十分）
  const byId = new Map<string, Stripe.Subscription>();
  for (const status of ["trialing", "active", "past_due", "incomplete"] as const) {
    const listed = await deps.stripe.subscriptions.list({
      customer: stripeCustomerId,
      status,
      limit: 100,
    });
    for (const sub of listed.data) {
      byId.set(sub.id, sub);
    }
  }
  const live = [...byId.values()].filter((sub) => LIVE_SUB_STATUSES.has(sub.status));
  if (live.length <= 1) {
    return {
      keepSubscriptionId: live[0]?.id ?? null,
      discardedSubscriptionIds: [],
    };
  }

  // entitled 優先 → created 昇順（先に entitled になった方を keep）
  const sorted = [...live].sort((a, b) => {
    const rankDiff = dualSubKeepRank(a.status) - dualSubKeepRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return a.created - b.created;
  });
  const keep = sorted[0];
  if (keep === undefined) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }

  const discardedSubscriptionIds: string[] = [];
  for (const other of sorted.slice(1)) {
    await deps.stripe.subscriptions.cancel(other.id);
    discardedSubscriptionIds.push(other.id);
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_dual_subscription_canceled",
      durationMs: Date.now() - deps.startedAt,
      stripeCustomerId,
      stripeSubscriptionId: other.id,
    });
  }

  const { data: markData, error: markError } = await deps.admin.rpc(
    "mark_billing_subscription_dual_cancel_keep",
    {
      p_user_id: userId,
      p_keep_stripe_subscription_id: keep.id,
    },
  );
  // keep 記録失敗は 500 で再送（discard 投影で誤 cancel 化しない）
  if (markError !== null) {
    throw new Error(markError.message ?? "mark_billing_subscription_dual_cancel_keep_failed");
  }
  if (markData !== null && typeof markData === "object") {
    const ok = (markData as { ok?: unknown }).ok;
    if (ok === false) {
      throw new Error("mark_billing_subscription_dual_cancel_keep_rejected");
    }
  }

  return {
    keepSubscriptionId: keep.id,
    discardedSubscriptionIds,
  };
}

/**
 * 終端イベント（canceled / deleted）向け: イベント subscription が既に live でなく、
 * 同一 Customer に別の live keep が残っている場合は discarded 扱いとする。
 * 同一リクエスト内 dual cancel 後に遅れて届く discard 側 deleted が、
 * keep 行を canceled で上書きしないための投影リダイレクト。
 * Stripe cancel は行わない（既に terminal）。
 */
export async function resolveTerminalEventDualProjection(
  deps: {
    stripe: BillingWebhookStripe;
  },
  stripeCustomerId: string,
  eventSubscriptionId: string,
): Promise<DualSubscriptionCleanup> {
  const byId = new Map<string, Stripe.Subscription>();
  for (const status of ["trialing", "active", "past_due", "incomplete"] as const) {
    const listed = await deps.stripe.subscriptions.list({
      customer: stripeCustomerId,
      status,
      limit: 100,
    });
    for (const sub of listed.data) {
      byId.set(sub.id, sub);
    }
  }
  const live = [...byId.values()].filter((sub) => LIVE_SUB_STATUSES.has(sub.status));
  // イベント対象がまだ live なら通常投影（terminal と矛盾するが list を正にしない）
  if (live.some((sub) => sub.id === eventSubscriptionId)) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }
  // live が無い = 本当の単一 sub 終端。イベント自体を投影する
  if (live.length === 0) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }
  const sorted = [...live].sort((a, b) => {
    const rankDiff = dualSubKeepRank(a.status) - dualSubKeepRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return a.created - b.created;
  });
  const keep = sorted[0];
  if (keep === undefined) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }
  return {
    keepSubscriptionId: keep.id,
    discardedSubscriptionIds: [eventSubscriptionId],
  };
}

/**
 * 初回 trialing|active 後に trial_history を server identity_key で焼成（A7）。
 *
 * Plus 投影後に焼成を落とすと、cancel 後の再 Checkout で 7 日 trial を再付与できる
 * 金銭経路の穴になる。identity 解決失敗・RPC 失敗は throw → 500 で Stripe 再送させ、
 * process が duplicate_processed になっても再試行で焼成を完了させる（fail-closed）。
 *
 * outcome は問わない（stale_ignored / same_second_skip も含む）。ignore-older で
 * canceled が先に applied され、遅延 trialing が stale でも、event が trialing|active なら
 * trial があった証拠として焼成する。insert は ON CONFLICT DO NOTHING で冪等。
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
): Promise<void> {
  // process outcome に依存しない（fail-closed: イベント status のみで判定）
  if (status !== "trialing" && status !== "active") return;

  const { data: userData, error: userError } = await deps.admin.auth.admin.getUserById(userId);
  if (userError !== null || userData.user === null) {
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_trial_identity_unavailable",
      durationMs: Date.now() - deps.startedAt,
    });
    throw new Error("billing_trial_identity_unavailable");
  }
  const email = userData.user.email;
  if (email === null || email === undefined || email.length === 0) {
    deps.log({
      level: "warn",
      requestId: deps.requestId,
      code: "billing_trial_identity_unavailable",
      durationMs: Date.now() - deps.startedAt,
    });
    throw new Error("billing_trial_identity_unavailable");
  }
  const identityKey = computeQuotaIdentityKey(deps.env.quotaIdentityHmacKey, email);
  const { error: insertError } = await deps.admin.rpc("insert_billing_trial_history", {
    p_identity_key: identityKey,
  });
  // PostgREST は { error } を throw しない。未検査だと HTTP 200 のまま trial 未焼成になる。
  if (insertError !== null) {
    deps.log({
      level: "error",
      requestId: deps.requestId,
      code: "billing_trial_history_insert_failed",
      durationMs: Date.now() - deps.startedAt,
    });
    throw new Error(insertError.message ?? "insert_billing_trial_history_failed");
  }
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

  let dualCleanup: DualSubscriptionCleanup = {
    keepSubscriptionId: null,
    discardedSubscriptionIds: [],
  };
  if (customerId !== null && LIVE_SUB_STATUSES.has(sub.status)) {
    dualCleanup = await cancelDualLiveSubscriptions(
      { stripe: deps.stripe, admin: deps.admin, log, requestId, startedAt },
      userId,
      customerId,
    );
  } else if (customerId !== null) {
    // 遅延 discarded cancel/deleted: live keep が残っていれば keep を投影する
    dualCleanup = await resolveTerminalEventDualProjection(
      { stripe: deps.stripe },
      customerId,
      sub.id,
    );
  }

  // cancel 済み discard の live-payload 再送: live が keep のみだと discarded=[] になり、
  // イベント sub を canceled で投影して keep を上書きし得る。keep と異なる id なら discarded 扱い。
  if (
    dualCleanup.keepSubscriptionId !== null &&
    dualCleanup.keepSubscriptionId !== sub.id &&
    !dualCleanup.discardedSubscriptionIds.includes(sub.id)
  ) {
    dualCleanup = {
      keepSubscriptionId: dualCleanup.keepSubscriptionId,
      discardedSubscriptionIds: [...dualCleanup.discardedSubscriptionIds, sub.id],
    };
  }

  // 同一秒の決定論: retrieve を正として payload に載せる（evt_ 文字列順は使わない）。
  // dual-sub で discard した subscription のイベントは keep 側を投影する（cancel 後 status で上書きしない）。
  const projectingDiscardedOntoKeep =
    dualCleanup.discardedSubscriptionIds.includes(sub.id) &&
    dualCleanup.keepSubscriptionId !== null;
  const projectSubscriptionId = projectingDiscardedOntoKeep
    ? (dualCleanup.keepSubscriptionId as string)
    : sub.id;

  let retrieved: SubscriptionProjection | null = null;
  try {
    const liveSub = await deps.stripe.subscriptions.retrieve(projectSubscriptionId);
    retrieved = projectionFromSubscription(liveSub);
  } catch {
    // discard 済みイベントで keep retrieve 失敗時は event オブジェクトで上書きしない
    if (projectSubscriptionId === sub.id) {
      retrieved = projectionFromSubscription(sub);
    }
  }
  const projection =
    retrieved ?? (projectSubscriptionId === sub.id ? projectionFromSubscription(sub) : null);
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

  // deleted で discarded を keep へリダイレクトしているとき、keep を canceled に落とさない
  const forceCanceledFromDeleted =
    event.type === "customer.subscription.deleted" && !projectingDiscardedOntoKeep;
  const projectedStatus = forceCanceledFromDeleted ? "canceled" : projection.status;

  const clearPastDue =
    projectedStatus === "active" || projectedStatus === "trialing" || forceCanceledFromDeleted;

  const outcome = await processStripeEvent(deps.admin, {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_event_created: event.created,
    user_id: userId,
    stripe_subscription_id: projection.stripe_subscription_id,
    stripe_price_id: projection.stripe_price_id,
    status: projectedStatus,
    cancel_at_period_end: projection.cancel_at_period_end,
    current_period_start: projection.current_period_start,
    current_period_end: projection.current_period_end,
    trial_end: projection.trial_end,
    clear_past_due_since: clearPastDue,
    // same-second 用。RPC が created 比較後に参照。evt_ 辞書順は使わない。
    retrieved_subscription: {
      status: projectedStatus,
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

  // trial 焼成の status は **イベントオブジェクトの frozen status** を使う。
  // live retrieve（projection）だと、applied 後 burn 500 → cancel → 同一 event 再送で
  // retrieve=canceled となり burn が永久スキップされ、同一 identity の再 trial が開く。
  const statusForTrial = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
  await maybeInsertTrialHistory(
    { admin: deps.admin, env: deps.env, log, requestId, startedAt },
    userId,
    statusForTrial,
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
    // 投影不能でも event ledger へ記録（再送地獄回避の 200 + durable claim）
    const outcome = await processStripeEvent(deps.admin, {
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: event.created,
      user_id: userId,
      skip_subscription_projection: true,
    });
    return json(200, { ok: true, data: { outcome } });
  }

  // invoice.paid は Subscription オブジェクトの status と整合させる（past_due を勝手に active 化しない）。
  // past_due_since クリアは paid 確定かつ status が active/trialing のときだけ（A6: past_due+NULL=非 entitled）。
  const isPaid = event.type === "invoice.paid";
  const status = projection.status;
  const clearPastDueSince = isPaid && (status === "active" || status === "trialing");

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
    clear_past_due_since: clearPastDueSince,
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

  // subscription.* が欠落・遅延しても invoice 経路だけで Plus が投影され得るため、
  // 初回 trialing|active の trial 焼成はイベント種別を問わず共有する（A7）。
  // invoice.paid の duplicate 再送時は live retrieve が canceled でも焼成を再試行する
  //（初回 applied 後 burn 失敗 → cancel で永久スキップされるのを防ぐ）。
  const statusForTrial =
    event.type === "invoice.paid" &&
    outcome === "duplicate_processed" &&
    status !== "trialing" &&
    status !== "active"
      ? "active"
      : status;
  await maybeInsertTrialHistory(
    { admin: deps.admin, env: deps.env, log, requestId, startedAt },
    userId,
    statusForTrial,
  );

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
