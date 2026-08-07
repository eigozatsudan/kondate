import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import {
  checkoutRequestSchema,
  PLUS_LP_UPGRADE_COMING_SOON,
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
  /**
   * テスト用 override。未指定時は shared の PLUS_LP_UPGRADE_COMING_SOON を正とする。
   * 本番ハンドラは渡さない（契約定数と UI を同時に開閉する）。
   */
  upgradeComingSoon?: boolean;
};

/**
 * residual-intentional (B2): paused / unpaid は live 母集団外（webhook dual と同型）。
 * DB free なら Checkout Session 作成可。pause 解除後の dual は webhook rank に委ねる。
 */
const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

/**
 * Stripe Customer を確定する。
 * 呼び出し側はユーザー単位 Checkout ロック取得後に限定すること（並行 create 防止 = A1）。
 */
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
        const { error: ensureSearchError } = await deps.admin.rpc("ensure_billing_customer", {
          p_user_id: userId,
          p_stripe_customer_id: hit.id,
        });
        // search ヒット後の mapping 失敗は fail-closed（Session を別 Customer で作らない）
        if (ensureSearchError !== null) {
          throw new HttpError(503, "request_failed", "処理を完了できませんでした");
        }
        return hit.id;
      }
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
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

/**
 * token 付き lock 解放（失敗経路の共通後始末）。
 * B6: PostgREST は throw せず `{ error }` を返すため、error を検査して失敗を伝播する。
 * silent fail だと token 付き lock が TTL まで残り billing_checkout_in_progress になる。
 */
async function releaseCheckoutLock(
  deps: BillingCheckoutDeps,
  userId: string,
  lockToken: string,
  sessionId?: string,
): Promise<void> {
  const { error } = await deps.admin.rpc("release_billing_checkout_lock", {
    p_user_id: userId,
    p_lock_token: lockToken,
    ...(sessionId === undefined ? {} : { p_stripe_checkout_session_id: sessionId }),
  });
  if (error !== null) {
    throw new Error(error.message || "release_billing_checkout_lock_failed");
  }
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
  // RPC は boolean 想定。null / 予期しない形は「使用済み扱い」で trial を与えない。
  if (typeof data !== "boolean") {
    return true;
  }
  return data;
}

/**
 * POST /api/billing/checkout の実装。
 * 順序: entitlement 確認 → acquire(lock_token) → Customer 確定 → list → sessions.create → bind。
 * Customer 作成は lock 保護下（並行 Checkout で Customer/Session 不一致を防ぐ = A1）。
 * create 失敗で release(token)。bind / URL 欠落で expire + release。
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
  let lockToken: string | null = null;
  let lockedUserId: string | null = null;
  let createdSessionId: string | null = null;

  try {
    if (!deps.env.billingEnabled || deps.env.stripe === undefined) {
      throw new HttpError(503, "billing_disabled", "お支払い機能は現在ご利用いただけません");
    }

    // B4: UI の COMING_SOON と API を揃える（BILLING_ENABLED だけでは申込クローズにならない）
    const upgradeComingSoon = deps.upgradeComingSoon ?? PLUS_LP_UPGRADE_COMING_SOON;
    if (upgradeComingSoon) {
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
    // B8: incomplete 放置は新規 Checkout ではなく Portal 完了を促す（30m lock 残骸と区別）
    if (entitlement.status === "incomplete") {
      throw new HttpError(
        409,
        "billing_checkout_incomplete",
        "お支払い手続きが完了していません。設定からお支払い管理を開いてください",
      );
    }
    // B5: past_due は dual 防止で Checkout 拒否するが、grace 切れは非 Plus。
    // 「すでに Plus」コピーは権益と不一致なので Portal 誘導専用 code に分離する。
    if (entitlement.status === "past_due") {
      throw new HttpError(409, "billing_checkout_use_portal", "お支払い管理から手続きしてください");
    }
    if (entitlement.status === "trialing" || entitlement.status === "active") {
      throw new HttpError(409, "billing_already_entitled", "すでに Plus をご利用中です");
    }

    const priceId =
      body.interval === "month"
        ? deps.env.stripe.pricePlusMonthly
        : deps.env.stripe.pricePlusYearly;

    // 先に lock。Customer 作成・list・Session はすべて token 保護下（設計図: lock + ensure）
    lockToken = (deps.createLockToken ?? randomUUID)();
    lockedUserId = user.userId;
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
      lockToken = null;
      lockedUserId = null;
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }
    const acquireOk =
      acquireData !== null &&
      typeof acquireData === "object" &&
      (acquireData as { ok?: unknown }).ok === true;
    if (!acquireOk) {
      lockToken = null;
      lockedUserId = null;
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

    const customerId = await ensureStripeCustomer(deps, user.userId);

    // Stripe 側の live sub がある場合は Portal 誘導（409）。
    // status 別 list（limit 1）で terminal 履歴に埋もれた live を見落とさない。
    // list 失敗は 503 fail-closed。
    try {
      for (const status of ["trialing", "active", "past_due", "incomplete"] as const) {
        const listed = await deps.stripe.subscriptions.list({
          customer: customerId,
          status,
          limit: 1,
        });
        if (listed.data.some((sub) => LIVE_SUB_STATUSES.has(sub.status))) {
          throw new HttpError(409, "billing_already_entitled", "すでに Plus をご利用中です");
        }
      }
    } catch (error: unknown) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
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
        cancel_url: `${origin}/plus?billing=cancel`,
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
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    if (typeof session.id !== "string" || session.id.length === 0) {
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }
    createdSessionId = session.id;

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
        // B10: expire 失敗は orphan session 残差。ops 向けに alert だけ上げる（PII なし）
        log({
          level: "error",
          requestId,
          code: "billing_checkout_session_expire_failed",
          durationMs: Date.now() - startedAt,
          alertMetric: 1,
        });
      }
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    if (typeof session.url !== "string" || session.url.length === 0) {
      // bind 済み Session に URL が無い = 利用不能。expire してから解放する。
      try {
        await deps.stripe.checkout.sessions.expire(session.id);
        log({
          level: "info",
          requestId,
          code: "billing_checkout_session_expired_compensation",
          durationMs: Date.now() - startedAt,
        });
      } catch {
        log({
          level: "error",
          requestId,
          code: "billing_checkout_session_expire_failed",
          durationMs: Date.now() - startedAt,
          alertMetric: 1,
        });
      }
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    // 成功: lock は webhook completed/expired または TTL で解放（ここでは解放しない）
    lockToken = null;
    lockedUserId = null;

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
    // 失敗経路: token 付き lock を必ず解放（成功時は上で null 化済み）
    // B6: release の error も検査。失敗時はログし details.release_failed を載せる（lock 残骸の可観測性）
    let releaseFailed = false;
    if (lockToken !== null && lockedUserId !== null) {
      try {
        await releaseCheckoutLock(deps, lockedUserId, lockToken, createdSessionId ?? undefined);
      } catch {
        releaseFailed = true;
        log({
          level: "error",
          requestId,
          code: "billing_checkout_release_failed",
          durationMs: Date.now() - startedAt,
          alertMetric: 1,
        });
      }
    }

    if (error instanceof HttpError) {
      const details: Record<string, unknown> = {
        ...(error.details === undefined ? {} : error.details),
        ...(releaseFailed ? { release_failed: true } : {}),
      };
      return json(error.status, {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(Object.keys(details).length === 0 ? {} : { details }),
        },
      });
    }
    return json(500, {
      ok: false,
      error: {
        code: "request_failed",
        message: "処理を完了できませんでした",
        ...(releaseFailed ? { details: { release_failed: true } } : {}),
      },
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
