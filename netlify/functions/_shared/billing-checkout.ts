import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import {
  checkoutRequestSchema,
  type CheckoutData,
  type CheckoutRequest,
} from "../../../shared/contracts/billing.js";
import type { ServerEnv } from "./env.js";
import { HttpError, json, methodNotAllowed, parseJson } from "./http.js";
import type { SafeLogEvent } from "./logger.js";
import { createSafeLogger } from "./logger.js";
import { computeQuotaIdentityKey } from "./quota-identity.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  loadEntitlement,
  type Entitlement,
} from "./billing-entitlement.js";

/** Checkout lock TTL（設計: 30 min） */
export const CHECKOUT_LOCK_TTL_MS = 30 * 60 * 1000;

/** trial 日数（未使用 identity のみ） */
export const TRIAL_PERIOD_DAYS = 7;

export type StripeCheckoutClient = {
  customers: {
    create: (params: Stripe.CustomerCreateParams) => Promise<Stripe.Customer>;
    search?: (
      params: Stripe.CustomerSearchParams,
    ) => Promise<Stripe.ApiSearchResult<Stripe.Customer>>;
  };
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams) => Promise<Stripe.Checkout.Session>;
      expire: (id: string) => Promise<Stripe.Checkout.Session>;
    };
  };
  subscriptions: {
    list: (params: Stripe.SubscriptionListParams) => Promise<Stripe.ApiList<Stripe.Subscription>>;
  };
};

export type BillingCheckoutDeps = {
  env: ServerEnv;
  authenticate: (request: Request) => Promise<{ userId: string; email: string }>;
  loadEntitlement: (userId: string) => Promise<Entitlement>;
  stripe: StripeCheckoutClient;
  admin: Pick<AdminSupabaseClient, "rpc">;
  log?: (event: SafeLogEvent) => void;
  now?: () => Date;
  requestId?: string;
  createLockToken?: () => string;
};

const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

async function ensureStripeCustomer(deps: BillingCheckoutDeps, userId: string): Promise<string> {
  const { data, error } = await deps.admin.rpc("get_billing_customer_by_user", {
    p_user_id: userId,
  });
  if (error !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  if (data !== null && typeof data === "object") {
    const existing = (data as { stripe_customer_id?: unknown }).stripe_customer_id;
    if (typeof existing === "string" && existing.length > 0) {
      return existing;
    }
  }

  // 既存 Customer の二重作成を避ける（metadata 検索。search 非対応 mock は create へ）
  if (deps.stripe.customers.search !== undefined) {
    try {
      const found = await deps.stripe.customers.search({
        query: `metadata["supabase_user_id"]:"${userId}"`,
        limit: 1,
      });
      const hit = found.data[0];
      if (hit !== undefined) {
        await deps.admin.rpc("ensure_billing_customer", {
          p_user_id: userId,
          p_stripe_customer_id: hit.id,
        });
        return hit.id;
      }
    } catch {
      // search 失敗時は create へフォールバック
    }
  }

  const created = await deps.stripe.customers.create({
    metadata: { supabase_user_id: userId },
  });
  const { error: ensureError } = await deps.admin.rpc("ensure_billing_customer", {
    p_user_id: userId,
    p_stripe_customer_id: created.id,
  });
  if (ensureError !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  return created.id;
}

async function hasUsedTrial(deps: BillingCheckoutDeps, email: string): Promise<boolean> {
  const identityKey = computeQuotaIdentityKey(deps.env.quotaIdentityHmacKey, email);
  const { data, error } = await deps.admin.rpc("has_billing_trial_history", {
    p_identity_key: identityKey,
  });
  if (error !== null) {
    // trial 判定不能は trial なし（焼かない・与えない fail-closed 寄りの有料開始）
    return true;
  }
  return data;
}

/**
 * POST /api/billing/checkout の実装。
 * 順序: entitlement 確認 → acquire(lock_token) → sessions.create → bind。
 * create 失敗で release(token)。bind 失敗で expire + release。
 */
export async function runBillingCheckout(
  request: Request,
  deps: BillingCheckoutDeps,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);

  const startedAt = Date.now();
  const requestId = deps.requestId ?? randomUUID();
  const log = deps.log ?? createSafeLogger();
  const now = deps.now ?? (() => new Date());

  try {
    if (!deps.env.billingEnabled || deps.env.stripe === undefined) {
      throw new HttpError(503, "billing_disabled", "お支払い機能は現在ご利用いただけません");
    }

    const user = await deps.authenticate(request);
    const body: CheckoutRequest = await parseJson(request, checkoutRequestSchema);

    let entitlement: Entitlement;
    try {
      entitlement = await deps.loadEntitlement(user.userId);
    } catch (error: unknown) {
      if (error instanceof BillingEntitlementUnavailableError) {
        throw new HttpError(
          503,
          "billing_entitlement_unavailable",
          "プラン情報を確認できませんでした。しばらくしてからお試しください。",
        );
      }
      throw error;
    }

    // DB 投影で既に entitled → 409（kill 中は Checkout 自体 503 なのでここに来ない）
    if (entitlement.dbPlusEntitled) {
      throw new HttpError(409, "billing_already_entitled", "すでに Plus をご利用中です");
    }
    if (
      entitlement.status === "trialing" ||
      entitlement.status === "active" ||
      entitlement.status === "past_due" ||
      entitlement.status === "incomplete"
    ) {
      throw new HttpError(409, "billing_already_entitled", "すでに Plus をご利用中です");
    }

    const priceId =
      body.interval === "month"
        ? deps.env.stripe.pricePlusMonthly
        : deps.env.stripe.pricePlusYearly;

    const customerId = await ensureStripeCustomer(deps, user.userId);

    // Stripe 側の live sub がある場合は Portal 誘導（409）
    try {
      const listed = await deps.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });
      if (listed.data.some((sub) => LIVE_SUB_STATUSES.has(sub.status))) {
        throw new HttpError(409, "billing_already_entitled", "すでに Plus をご利用中です");
      }
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      // list 失敗は続行（acquire 後に create が最終判定）
    }

    const lockToken = (deps.createLockToken ?? randomUUID)();
    const expiresAt = new Date(now().getTime() + CHECKOUT_LOCK_TTL_MS).toISOString();
    const { data: acquireData, error: acquireError } = await deps.admin.rpc(
      "acquire_billing_checkout_lock",
      {
        p_user_id: user.userId,
        p_lock_token: lockToken,
        p_expires_at: expiresAt,
      },
    );
    if (acquireError !== null) {
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }
    const acquireOk =
      acquireData !== null &&
      typeof acquireData === "object" &&
      (acquireData as { ok?: unknown }).ok === true;
    if (!acquireOk) {
      log({
        level: "info",
        requestId,
        code: "billing_checkout_in_progress",
        durationMs: Date.now() - startedAt,
        priceInterval: body.interval,
      });
      throw new HttpError(
        409,
        "billing_checkout_in_progress",
        "お支払い手続きが進行中です。しばらくしてからお試しください",
      );
    }

    const usedTrial = await hasUsedTrial(deps, user.email);
    const origin = deps.env.SERVER_SITE_ORIGIN;
    let session: Stripe.Checkout.Session;
    try {
      session = await deps.stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.userId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/settings?billing=success`,
        cancel_url: `${origin}/settings?billing=cancel`,
        subscription_data: {
          ...(usedTrial ? {} : { trial_period_days: TRIAL_PERIOD_DAYS }),
          metadata: { supabase_user_id: user.userId, plan_code: "plus" },
        },
        metadata: { supabase_user_id: user.userId, plan_code: "plus" },
        payment_method_collection: "always",
        allow_promotion_codes: false,
        locale: "ja",
      });
    } catch {
      await deps.admin.rpc("release_billing_checkout_lock", {
        p_user_id: user.userId,
        p_lock_token: lockToken,
      });
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    if (typeof session.id !== "string" || session.id.length === 0) {
      await deps.admin.rpc("release_billing_checkout_lock", {
        p_user_id: user.userId,
        p_lock_token: lockToken,
      });
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    const { data: bindData, error: bindError } = await deps.admin.rpc(
      "bind_billing_checkout_session",
      {
        p_user_id: user.userId,
        p_lock_token: lockToken,
        p_stripe_checkout_session_id: session.id,
      },
    );
    const bindOk =
      bindError === null &&
      bindData !== null &&
      typeof bindData === "object" &&
      (bindData as { ok?: unknown }).ok === true;
    if (!bindOk) {
      log({
        level: "error",
        requestId,
        code: "billing_checkout_bind_failed",
        durationMs: Date.now() - startedAt,
        priceInterval: body.interval,
      });
      try {
        await deps.stripe.checkout.sessions.expire(session.id);
        log({
          level: "info",
          requestId,
          code: "billing_checkout_session_expired_compensation",
          durationMs: Date.now() - startedAt,
        });
      } catch {
        // best-effort expire
      }
      await deps.admin.rpc("release_billing_checkout_lock", {
        p_user_id: user.userId,
        p_lock_token: lockToken,
      });
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    if (typeof session.url !== "string" || session.url.length === 0) {
      await deps.admin.rpc("release_billing_checkout_lock", {
        p_user_id: user.userId,
        p_lock_token: lockToken,
        p_stripe_checkout_session_id: session.id,
      });
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    log({
      level: "info",
      requestId,
      code: "billing_checkout_created",
      durationMs: Date.now() - startedAt,
      priceInterval: body.interval,
      plan: applyQuotaPlan(entitlement, deps.env.billingEnabled),
    });

    return json<CheckoutData>(200, { ok: true, data: { url: session.url } });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return json(error.status, {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
    return json(500, {
      ok: false,
      error: { code: "request_failed", message: "処理を完了できませんでした" },
    });
  }
}

/** 本番用: loadEntitlement を実 RPC に接続 */
export function createDefaultCheckoutDeps(
  partial: Omit<BillingCheckoutDeps, "loadEntitlement"> & {
    loadEntitlement?: BillingCheckoutDeps["loadEntitlement"];
  },
): BillingCheckoutDeps {
  return {
    ...partial,
    loadEntitlement: partial.loadEntitlement ?? loadEntitlement,
  };
}
