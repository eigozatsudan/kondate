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
 * B4: 投影に使う item（allowlist 優先）の period を読む。
 */
function periodUnixFromSubscription(
  sub: Stripe.Subscription,
  item: Stripe.SubscriptionItem | undefined,
): {
  start: number | null;
  end: number | null;
} {
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

/**
 * Checkout 進行中の incomplete も live 候補に含む（list / dual 対象の母集団）。
 * residual-intentional (B2): paused / unpaid は意図的に外す。
 * 非 Plus なので Checkout 409 にならず、dual cancel も触らない（pause 解除・回収を Stripe 正とする）。
 * 母集団拡大は Stripe 契約・二重 cancel ポリシー変更のため本パスではしない。
 */
const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

/**
 * dual-sub keep 優先（数値が小さいほど keep）:
 * - active（課金中）を最優先 — 新しい trialing が古い paid active を Stripe cancel しない（B3）
 * - trialing は active の次
 * - past_due は incomplete より優先するが active/trialing より下位
 *   （新しい past_due が古い健全 sub を cancel しない — a7 B3）
 * - incomplete は最下位
 * 同 rank 内は新しい created を keep（再 Checkout 後の誤ダウングレード残差を減らす）。
 * さらに B3: allowlist Plus price を持つ sub を非 allowlist より常に優先
 * （新しい非 Plus active が古い Plus active を cancel しない）。
 */
function dualSubKeepRank(status: string): number {
  if (status === "active") return 0;
  if (status === "trialing") return 1;
  if (status === "past_due") return 2;
  if (status === "incomplete") return 3;
  return 4;
}

/**
 * Customer の live sub を status 別 list で全ページ取得する（B6）。
 * delete-account の U1-M5 と同型: limit 100 の 1 ページだけでは 100 超の病理で keep/discard が欠ける。
 */
async function listLiveSubscriptionsForCustomer(
  stripe: BillingWebhookStripe,
  stripeCustomerId: string,
): Promise<Stripe.Subscription[]> {
  const byId = new Map<string, Stripe.Subscription>();
  for (const status of ["trialing", "active", "past_due", "incomplete"] as const) {
    let startingAfter: string | undefined;
    for (;;) {
      const listed = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status,
        limit: 100,
        ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
      });
      for (const sub of listed.data) {
        byId.set(sub.id, sub);
      }
      if (!listed.has_more || listed.data.length === 0) {
        break;
      }
      const last = listed.data[listed.data.length - 1];
      if (last === undefined) {
        break;
      }
      startingAfter = last.id;
    }
  }
  return [...byId.values()].filter((sub) => LIVE_SUB_STATUSES.has(sub.status));
}

/** Checkout が使う Plus price のみを権益対象にする（Dashboard 手動・Portal 価格変更の elevation を閉じる）。 */
export function isAllowlistedPlusPrice(
  priceId: string,
  stripe: { pricePlusMonthly: string; pricePlusYearly: string },
): boolean {
  return priceId === stripe.pricePlusMonthly || priceId === stripe.pricePlusYearly;
}

/** B3/B4: items のいずれかに Plus allowlist price があれば true。 */
export function subscriptionHasAllowlistedPlusPrice(
  sub: Stripe.Subscription,
  stripe: { pricePlusMonthly: string; pricePlusYearly: string },
): boolean {
  for (const item of sub.items.data) {
    const priceId = item.price.id;
    if (typeof priceId === "string" && isAllowlistedPlusPrice(priceId, stripe)) {
      return true;
    }
  }
  return false;
}

/**
 * B3: dual keep 比較。
 * 1) allowlist Plus price 優先 2) status rank 3) 新しい created
 */
function compareDualLiveSubscriptions(
  a: Stripe.Subscription,
  b: Stripe.Subscription,
  stripe: { pricePlusMonthly: string; pricePlusYearly: string } | undefined,
): number {
  if (stripe !== undefined) {
    const aPlus = subscriptionHasAllowlistedPlusPrice(a, stripe) ? 0 : 1;
    const bPlus = subscriptionHasAllowlistedPlusPrice(b, stripe) ? 0 : 1;
    if (aPlus !== bPlus) return aPlus - bPlus;
  }
  const rankDiff = dualSubKeepRank(a.status) - dualSubKeepRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  return b.created - a.created;
}

/**
 * B4: 投影に使う item を選ぶ。Plus allowlist price を優先し、無ければ先頭 item。
 * multi-item で非 Plus が items[0] でも Plus を見落とさない。
 */
export function selectSubscriptionItemForProjection(
  sub: Stripe.Subscription,
  stripe?: { pricePlusMonthly: string; pricePlusYearly: string },
): Stripe.SubscriptionItem | undefined {
  if (stripe !== undefined) {
    for (const item of sub.items.data) {
      const priceId = item.price.id;
      if (typeof priceId === "string" && isAllowlistedPlusPrice(priceId, stripe)) {
        return item;
      }
    }
  }
  return sub.items.data[0];
}

/**
 * B1/B7: 投影直前の権益ガード。
 * - 未知 price → unpaid（status のみ Plus になる経路を閉じる）
 * - BILLING_ENABLED=false → Plus になり得る status を unpaid に落とす（kill 中の DB Plus 投影を止める）
 * price_id 自体は監査用に保持する。
 */
export function guardSubscriptionProjection(
  projection: SubscriptionProjection,
  options: {
    billingEnabled: boolean;
    stripe: { pricePlusMonthly: string; pricePlusYearly: string };
  },
): SubscriptionProjection {
  const priceOk = isAllowlistedPlusPrice(projection.stripe_price_id, options.stripe);
  const elevating =
    projection.status === "trialing" ||
    projection.status === "active" ||
    projection.status === "past_due" ||
    projection.status === "canceled";
  if (!priceOk && elevating) {
    return { ...projection, status: "unpaid" };
  }
  if (!options.billingEnabled && elevating) {
    return { ...projection, status: "unpaid" };
  }
  return projection;
}

/**
 * kill 中に elevating を unpaid へ落とすとき、元 status を残す（B3 復元用）。
 * unknown price の unpaid は kill マスクではないので null。
 * BILLING_ENABLED=true では null を返し、SQL 側の kill_source_status をクリアする。
 */
export function resolveKillSourceStatus(
  originalStatus: string,
  options: { billingEnabled: boolean; priceOk: boolean },
): string | null {
  if (options.billingEnabled) return null;
  if (!options.priceOk) return null;
  if (
    originalStatus === "trialing" ||
    originalStatus === "active" ||
    originalStatus === "past_due" ||
    originalStatus === "canceled"
  ) {
    return originalStatus;
  }
  return null;
}

function unixToIsoZ(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Stripe Subscription オブジェクトから投影用フィールドを取り出す。
 * B4: Plus allowlist price の item を優先（無い場合は先頭 item）。period も同 item から取る。
 */
export function projectionFromSubscription(
  sub: Stripe.Subscription,
  stripe?: { pricePlusMonthly: string; pricePlusYearly: string },
): SubscriptionProjection | null {
  const item = selectSubscriptionItemForProjection(sub, stripe);
  const priceId = item?.price.id;
  if (typeof priceId !== "string" || priceId.length === 0) return null;
  const { start, end } = periodUnixFromSubscription(sub, item);
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
 * user 解決: billing_customers の stripe_customer_id マップを正とする。
 * - map 必須（meta のみの被害者 UUID 載せ elevation を閉じる = B2）
 * - map + meta 両方あるときは一致必須（U5-M1）
 * - 解決不能は null（5xx + billing_user_unmapped。Stripe 再送で map 後に適用）
 */
export async function resolveBillingUserId(
  admin: BillingWebhookAdmin,
  options: {
    metadataUserId: string | null | undefined;
    stripeCustomerId: string | null;
  },
): Promise<string | null> {
  const meta =
    typeof options.metadataUserId === "string" && options.metadataUserId.length > 0
      ? options.metadataUserId
      : null;
  let mapped: string | null = null;
  if (options.stripeCustomerId !== null) {
    const { data, error } = await admin.rpc("get_billing_customer_by_stripe_id", {
      p_stripe_customer_id: options.stripeCustomerId,
    });
    if (error === null && data !== null && typeof data === "object") {
      const userId = (data as { user_id?: unknown }).user_id;
      if (typeof userId === "string" && userId.length > 0) mapped = userId;
    }
  }
  // B2: customer map が無ければ投影しない（Checkout 正規は ensure_billing_customer 済み）。
  if (mapped === null) return null;
  if (meta !== null && meta !== mapped) return null;
  return mapped;
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
 * 二重 live subscription: keep は entitled 優先・同順位なら created が新しい方、他を Stripe cancel。
 * 呼び出し側は discarded に含まれるイベント subscription を通常 projection してはならない。
 */
export async function cancelDualLiveSubscriptions(
  deps: {
    stripe: BillingWebhookStripe;
    admin: BillingWebhookAdmin;
    log: (event: SafeLogEvent) => void;
    requestId: string;
    startedAt: number;
    /** B3: Plus price allowlist。未指定時は status/created のみ（後方互換）。 */
    prices?: { pricePlusMonthly: string; pricePlusYearly: string };
  },
  userId: string,
  stripeCustomerId: string,
): Promise<DualSubscriptionCleanup> {
  // status 別 list + has_more で terminal 履歴に埋もれた live を落とさない（B6）
  const live = await listLiveSubscriptionsForCustomer(deps.stripe, stripeCustomerId);
  if (live.length <= 1) {
    return {
      keepSubscriptionId: live[0]?.id ?? null,
      discardedSubscriptionIds: [],
    };
  }

  // B3: allowlist Plus 優先 → status rank → 新しい created
  const sorted = [...live].sort((a, b) => compareDualLiveSubscriptions(a, b, deps.prices));
  const keep = sorted[0];
  if (keep === undefined) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }

  // residual-intentional (B9): mark は keep の stripe_subscription_id / updated_at のみ更新。
  // status・period・past_due_since は直後の process 投影に委ねる。mark 成功〜process 完了前の
  // 歪み窓は再送で修復し得るが、migration 契約変更（mark で status も写す）は本パスでしない。
  //
  // B10: mark 成功後に Stripe cancel。cancel 先行だと mark missing で 500 のとき discard が
  // 既に取消不能になり、DB 未投影窓が広がる。行未作成（missing）は cancel せず process 投影へ。
  const { data: markData, error: markError } = await deps.admin.rpc(
    "mark_billing_subscription_dual_cancel_keep",
    {
      p_user_id: userId,
      p_keep_stripe_subscription_id: keep.id,
    },
  );
  if (markError !== null) {
    throw new Error(markError.message ?? "mark_billing_subscription_dual_cancel_keep_failed");
  }
  if (markData !== null && typeof markData === "object") {
    const ok = (markData as { ok?: unknown }).ok;
    if (ok === false) {
      const failureCode = (markData as { failure_code?: unknown }).failure_code;
      if (failureCode === "billing_subscription_missing") {
        // 初回 dual で行がまだ無い: cancel せず process で行を作り、再送で dual を完了させる
        deps.log({
          level: "warn",
          requestId: deps.requestId,
          code: "billing_dual_cancel_mark_missing",
          durationMs: Date.now() - deps.startedAt,
          stripeCustomerId,
        });
        return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
      }
      throw new Error("mark_billing_subscription_dual_cancel_keep_rejected");
    }
  }

  // B11: discard を 1 件ずつ try。途中失敗で全体 throw すると先行 cancel が不可逆のまま
  // event 未 claim になり、部分 dual 窓だけが残る。残りも cancel を試し、mark 済み keep は
  // 呼び出し側の process 投影へ進める（再送で残 live を再整理）。
  const discardedSubscriptionIds: string[] = [];
  let cancelFailureCount = 0;
  for (const other of sorted.slice(1)) {
    try {
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
    } catch {
      cancelFailureCount += 1;
      deps.log({
        level: "error",
        requestId: deps.requestId,
        code: "billing_dual_subscription_cancel_failed",
        durationMs: Date.now() - deps.startedAt,
        stripeCustomerId,
        stripeSubscriptionId: other.id,
        alertMetric: 1,
      });
    }
  }
  if (cancelFailureCount > 0) {
    deps.log({
      level: "error",
      requestId: deps.requestId,
      code: "billing_dual_cancel_partial",
      durationMs: Date.now() - deps.startedAt,
      stripeCustomerId,
      stripeSubscriptionId: keep.id,
      alertMetric: 1,
    });
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
    /** B3: dual keep と同じ allowlist 優先比較 */
    prices?: { pricePlusMonthly: string; pricePlusYearly: string };
  },
  stripeCustomerId: string,
  eventSubscriptionId: string,
): Promise<DualSubscriptionCleanup> {
  // B6: terminal 経路も dual cancel と同じ全ページ list を使う
  const live = await listLiveSubscriptionsForCustomer(deps.stripe, stripeCustomerId);
  // イベント対象がまだ live なら通常投影（terminal と矛盾するが list を正にしない）
  if (live.some((sub) => sub.id === eventSubscriptionId)) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }
  // live が無い = 本当の単一 sub 終端。イベント自体を投影する
  if (live.length === 0) {
    return { keepSubscriptionId: null, discardedSubscriptionIds: [] };
  }
  // B3: allowlist Plus 優先 → status rank → 新しい created（dual cancel と同順）
  const sorted = [...live].sort((a, b) => compareDualLiveSubscriptions(a, b, deps.prices));
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
    // B9: map 未整備は process 前に 5xx + 非 claim。Stripe は 2xx を再送しない。
    // map 後に同一 evt を再送させ、elevation を適用する。
    log({
      level: "warn",
      requestId,
      code: "billing_user_unmapped",
      durationMs: Date.now() - startedAt,
      alertMetric: 1,
      ...(customerId === null ? {} : { stripeCustomerId: customerId }),
    });
    return json(500, {
      ok: false,
      error: { code: "billing_user_unmapped", message: "処理を完了できませんでした" },
    });
  }

  let dualCleanup: DualSubscriptionCleanup = {
    keepSubscriptionId: null,
    discardedSubscriptionIds: [],
  };
  const prices = deps.env.stripe;
  if (customerId !== null && LIVE_SUB_STATUSES.has(sub.status)) {
    dualCleanup = await cancelDualLiveSubscriptions(
      {
        stripe: deps.stripe,
        admin: deps.admin,
        log,
        requestId,
        startedAt,
        ...(prices === undefined ? {} : { prices }),
      },
      userId,
      customerId,
    );
  } else if (customerId !== null) {
    // 遅延 discarded cancel/deleted: live keep が残っていれば keep を投影する
    dualCleanup = await resolveTerminalEventDualProjection(
      { stripe: deps.stripe, ...(prices === undefined ? {} : { prices }) },
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
    // B4: allowlist item 優先で投影
    retrieved = projectionFromSubscription(liveSub, prices);
  } catch {
    // discard 済みイベントで keep retrieve 失敗時は event オブジェクトで上書きしない
    if (projectSubscriptionId === sub.id) {
      retrieved = projectionFromSubscription(sub, prices);
    }
  }
  let projection =
    retrieved ??
    (projectSubscriptionId === sub.id ? projectionFromSubscription(sub, prices) : null);
  if (projection === null) {
    // residual-intentional (B5): 投影不能は skip_subscription_projection で claim + event_only。
    // 再送地獄回避の 200。権益更新は後続 event / reconcile 待ち（同一 evt 再送は duplicate）。
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
  // forceCanceled 後に B1/B7 ガード（deleted→canceled が kill 中に再昇格しないよう後段で適用）
  let guardedProjection: SubscriptionProjection = {
    ...projection,
    status: forceCanceledFromDeleted ? "canceled" : projection.status,
  };
  const stripeCfg = deps.env.stripe;
  const priceOk =
    stripeCfg !== undefined && isAllowlistedPlusPrice(guardedProjection.stripe_price_id, stripeCfg);
  // B-R5: since 判定は kill unpaid の前。元 past_due を unpaid 後 status で落とさない。
  const preGuardStatus = guardedProjection.status;
  const killSourceStatus = resolveKillSourceStatus(preGuardStatus, {
    billingEnabled: deps.env.billingEnabled,
    priceOk,
  });
  if (stripeCfg !== undefined) {
    guardedProjection = guardSubscriptionProjection(guardedProjection, {
      billingEnabled: deps.env.billingEnabled,
      stripe: stripeCfg,
    });
  }
  const projectedStatus = guardedProjection.status;
  projection = guardedProjection;

  // B-R7: clear は guard 前 status。kill 中は persist が unpaid でも
  // active/trialing 復帰なら since を消す（設計 L351: 復帰で NULL）。
  const clearPastDue =
    preGuardStatus === "active" || preGuardStatus === "trialing" || forceCanceledFromDeleted;
  // 初回 past_due の grace 起点は webhook 処理時刻ではなく Stripe event.created。
  // SQL は既存 past_due_since を優先 coalesce するため再送・延長では伸ばさない。
  // residual-intentional (B8): SQL 正本は payload 欠落時 clock_timestamp() fallback。
  // 正規 Function 経路は常に past_due_since を載せる。手投入/将来 path の延長残差は migration 契約。
  // B-R5: kill 中 unpaid でも元 past_due なら初回候補として載せる。
  // B-R6: 後続イベントも event.created を載せるが、SQL unpaid else は既存優先で延長しない。
  const pastDueSinceIso =
    !clearPastDue && preGuardStatus === "past_due" ? unixToIsoZ(event.created) : null;

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
    kill_source_status: killSourceStatus,
    ...(pastDueSinceIso !== null ? { past_due_since: pastDueSinceIso } : {}),
    // same-second 用。RPC が created 比較後に参照。evt_ 辞書順は使わない。
    // residual-intentional (B7): 投影成功時は常に retrieved を載せるため SQL の terminality
    // fallback は実質デッド。同一秒 race は後勝ち live スナップショット（migration 契約）。
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
  // 非 allowlist price は Plus 対象外なので焼成しない（B1 と整合。過焼成を避ける）。
  const statusForTrial = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
  if (
    deps.env.stripe !== undefined &&
    isAllowlistedPlusPrice(projection.stripe_price_id, deps.env.stripe)
  ) {
    await maybeInsertTrialHistory(
      { admin: deps.admin, env: deps.env, log, requestId, startedAt },
      userId,
      statusForTrial,
    );
  }

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

  // B12: checkout lock 解放は projection 用 user 解決と独立。
  // map 未解決でも metadata / client_reference の user で session 紐づき lock を解放し、
  // 最大 30m の billing_checkout_in_progress を避ける（権益投影は別経路）。
  // B2: release の `{ error }` を検査し、失敗時は claim 前に 500 で止めて Stripe 再送させる。
  // released:false（行なし）は既解放・未 bind の idempotent no-op として成功扱い。
  const lockUserId = userId ?? metadataUserId;
  let released = false;
  if (lockUserId !== null && typeof session.id === "string") {
    const { data: releaseData, error: releaseError } = await deps.admin.rpc(
      "release_billing_checkout_lock",
      {
        p_user_id: lockUserId,
        p_stripe_checkout_session_id: session.id,
      },
    );
    if (releaseError !== null) {
      throw new Error(releaseError.message ?? "release_billing_checkout_lock_failed");
    }
    released =
      releaseData !== null &&
      typeof releaseData === "object" &&
      (releaseData as { released?: unknown }).released === true;
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
  return json(200, { ok: true, data: { outcome, released } });
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
    // B8: 第一 retrieve 失敗は claim せず 5xx。Stripe 再送で回復する。
    log({
      level: "error",
      requestId,
      code: "billing_invoice_subscription_retrieve_failed",
      durationMs: Date.now() - startedAt,
      alertMetric: 1,
    });
    throw new Error("invoice_subscription_retrieve_failed");
  }

  const resolvedCustomerId = customerId ?? customerIdFrom(sub.customer);
  const metadataUserId =
    typeof sub.metadata.supabase_user_id === "string" ? sub.metadata.supabase_user_id : null;
  const userId = await resolveBillingUserId(deps.admin, {
    metadataUserId,
    stripeCustomerId: resolvedCustomerId,
  });
  if (userId === null) {
    // B9: subscription 経路と同型。claim せず 5xx。map 後の Stripe 再送で適用する。
    log({
      level: "warn",
      requestId,
      code: "billing_user_unmapped",
      durationMs: Date.now() - startedAt,
      alertMetric: 1,
    });
    return json(500, {
      ok: false,
      error: { code: "billing_user_unmapped", message: "処理を完了できませんでした" },
    });
  }

  // F-U05-1: invoice 経路も subscription.* と同型の dual-sub keep リダイレクトを行う。
  // discard 側の invoice.paid / payment_failed が keep を canceled 等で上書きしない。
  const prices = deps.env.stripe;
  let dualCleanup: DualSubscriptionCleanup = {
    keepSubscriptionId: null,
    discardedSubscriptionIds: [],
  };
  if (resolvedCustomerId !== null && LIVE_SUB_STATUSES.has(sub.status)) {
    dualCleanup = await cancelDualLiveSubscriptions(
      {
        stripe: deps.stripe,
        admin: deps.admin,
        log,
        requestId,
        startedAt,
        ...(prices === undefined ? {} : { prices }),
      },
      userId,
      resolvedCustomerId,
    );
  } else if (resolvedCustomerId !== null) {
    dualCleanup = await resolveTerminalEventDualProjection(
      { stripe: deps.stripe, ...(prices === undefined ? {} : { prices }) },
      resolvedCustomerId,
      sub.id,
    );
  }
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

  const projectingDiscardedOntoKeep =
    dualCleanup.discardedSubscriptionIds.includes(sub.id) &&
    dualCleanup.keepSubscriptionId !== null;
  const projectSubscriptionId = projectingDiscardedOntoKeep
    ? (dualCleanup.keepSubscriptionId as string)
    : sub.id;

  let projection: SubscriptionProjection | null = null;
  try {
    const liveSub = await deps.stripe.subscriptions.retrieve(projectSubscriptionId);
    // B4: allowlist item 優先で投影
    projection = projectionFromSubscription(liveSub, prices);
  } catch {
    // discard イベントで keep retrieve 失敗時は event 側 sub で上書きしない
    if (projectSubscriptionId === sub.id) {
      projection = projectionFromSubscription(sub, prices);
    }
  }
  if (projection === null && projectSubscriptionId === sub.id) {
    projection = projectionFromSubscription(sub, prices);
  }
  if (projection === null) {
    // residual-intentional (B5): subscription 経路と同型。event_only claim で再送停止。
    const outcome = await processStripeEvent(deps.admin, {
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: event.created,
      user_id: userId,
      skip_subscription_projection: true,
    });
    return json(200, { ok: true, data: { outcome } });
  }

  // price allowlist + kill 中の Plus 投影抑止
  const stripeCfg = deps.env.stripe;
  const priceOk =
    stripeCfg !== undefined && isAllowlistedPlusPrice(projection.stripe_price_id, stripeCfg);
  // B-R5: since 判定は kill unpaid の前。元 past_due を unpaid 後 status で落とさない。
  const preGuardStatus = projection.status;
  const killSourceStatus = resolveKillSourceStatus(preGuardStatus, {
    billingEnabled: deps.env.billingEnabled,
    priceOk,
  });
  if (stripeCfg !== undefined) {
    projection = guardSubscriptionProjection(projection, {
      billingEnabled: deps.env.billingEnabled,
      stripe: stripeCfg,
    });
  }

  // residual-intentional (B10): invoice type で status を上書きしない。
  // Subscription retrieve を正とし、past_due を invoice.payment_failed だけで勝手に付けない。
  // payment_failed 後も retrieve が active なら demotion は subscription.updated 待ち（一時 over-entitle）。
  // past_due_since クリアは paid 確定かつ retrieve が active/trialing のときだけ（A6: past_due+NULL=非 entitled）。
  const isPaid = event.type === "invoice.paid";
  const status = projection.status;
  // B-R7: clear は guard 前 status。kill 中 unpaid でも invoice.paid + retrieve active なら消す。
  const clearPastDueSince =
    isPaid && (preGuardStatus === "active" || preGuardStatus === "trialing");
  // invoice 経路でも初回 past_due は event.created を起点に載せる（処理遅延の過付与を防ぐ / B8 Function 緩和）
  // B-R5: guard 前 status で判定。kill 中 unpaid でも元 past_due なら since を残す。
  // B-R6: 後続 payment_failed も event.created を載せるが、SQL は既存優先で延長しない。
  const pastDueSinceIso =
    !clearPastDueSince && preGuardStatus === "past_due" ? unixToIsoZ(event.created) : null;

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
    kill_source_status: killSourceStatus,
    ...(pastDueSinceIso !== null ? { past_due_since: pastDueSinceIso } : {}),
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
  // invoice.paid の duplicate 再送時は、trial 証拠があるときだけ live canceled でも焼成を再試行する
  //（初回 applied 後 burn 失敗 → cancel で永久スキップされる穴を塞ぎつつ、証拠無しの過焼成を減らす = B4）。
  const invoiceBillingReason =
    typeof (invoice as { billing_reason?: unknown }).billing_reason === "string"
      ? (invoice as { billing_reason: string }).billing_reason
      : null;
  const hasTrialBurnEvidence =
    projection.trial_end != null ||
    invoiceBillingReason === "subscription_create" ||
    invoiceBillingReason === "subscription_update";
  const statusForTrial =
    event.type === "invoice.paid" &&
    outcome === "duplicate_processed" &&
    status !== "trialing" &&
    status !== "active" &&
    hasTrialBurnEvidence
      ? "active"
      : status;
  if (
    deps.env.stripe !== undefined &&
    isAllowlistedPlusPrice(projection.stripe_price_id, deps.env.stripe)
  ) {
    await maybeInsertTrialHistory(
      { admin: deps.admin, env: deps.env, log, requestId, startedAt },
      userId,
      statusForTrial,
    );
  }

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
 * - 署名検証と event 処理は BILLING_ENABLED 非依存（鍵があれば稼働 = A3）
 * - ただし kill 中は guardSubscriptionProjection で Plus になり得る status を投影しない（B7）
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

  // residual-intentional (B12): 署名欠落/不正は 400（秘密無し elevation 閉じ済み）。
  // SDK 既定 timestamp tolerance と whsec 漏洩時の注入は秘密管理境界の運用残差。
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
