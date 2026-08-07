import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import type { PortalData } from "../../shared/contracts/billing.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import {
  BillingEntitlementUnavailableError,
  loadEntitlement,
  type Entitlement,
} from "./_shared/billing-entitlement.js";
import { getStripeClientFromEnv } from "./_shared/billing-stripe.js";
import { getServerEnv, type ServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import { createSafeLogger, type SafeLogEvent } from "./_shared/logger.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./_shared/supabase-admin.js";

export type BillingPortalDeps = {
  env: ServerEnv;
  authenticate: (request: Request) => Promise<{ userId: string; email: string }>;
  loadEntitlement: (userId: string) => Promise<Entitlement>;
  stripe: {
    billingPortal: {
      sessions: {
        create: (
          params: Stripe.BillingPortal.SessionCreateParams,
        ) => Promise<Stripe.BillingPortal.Session>;
      };
    };
    /** B9: DB free 時の live sub 確認（Checkout list と同型の母集団） */
    subscriptions: {
      list: (params: Stripe.SubscriptionListParams) => Promise<Stripe.ApiList<Stripe.Subscription>>;
    };
  };
  admin: Pick<AdminSupabaseClient, "rpc">;
  log?: (event: SafeLogEvent) => void;
  requestId?: string;
  now?: () => Date;
};

/**
 * residual-intentional と揃えた live 母集団（paused / unpaid は外す）。
 * Checkout list / webhook dual と同型。
 */
const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

/**
 * Portal を開いてよい subscription 状態（DB 投影ベース）。
 * Free 終端（none / canceled 期間外 / unpaid 等）は Checkout へ誘導し、
 * Portal 経由の price 変更・trial 再付与をアプリ側で塞ぐ。
 * incomplete / past_due / 期間内 canceled は支払い完了・解約管理のため許可。
 *
 * B9: DB free でも Stripe に live sub がある場合は `customerHasLiveStripeSubscription`
 * で許可する（webhook 遅延で Checkout 409 + Portal 403 の両閉じを避ける）。
 */
export function isBillingPortalAllowed(entitlement: Entitlement, now: Date = new Date()): boolean {
  if (entitlement.dbPlusEntitled) return true;
  if (
    entitlement.status === "trialing" ||
    entitlement.status === "active" ||
    entitlement.status === "past_due" ||
    entitlement.status === "incomplete"
  ) {
    return true;
  }
  if (entitlement.status === "canceled" && entitlement.currentPeriodEnd !== null) {
    return now.getTime() < new Date(entitlement.currentPeriodEnd).getTime();
  }
  return false;
}

/**
 * B9: Customer に live subscription があるか（status 別 list limit 1）。
 * list 失敗は呼び出し側で 503 にする。
 */
export async function customerHasLiveStripeSubscription(
  stripe: BillingPortalDeps["stripe"],
  customerId: string,
): Promise<boolean> {
  for (const status of ["trialing", "active", "past_due", "incomplete"] as const) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status,
      limit: 1,
    });
    if (listed.data.some((sub) => LIVE_SUB_STATUSES.has(sub.status))) {
      return true;
    }
  }
  return false;
}

/**
 * POST /api/billing/portal
 * Customer Portal Session を作成し redirect URL を返す。
 */
export async function runBillingPortal(
  request: Request,
  deps: BillingPortalDeps,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const startedAt = Date.now();
  const requestId = deps.requestId ?? randomUUID();
  const log = deps.log ?? createSafeLogger();

  try {
    if (!deps.env.billingEnabled || deps.env.stripe === undefined) {
      throw new HttpError(503, "billing_disabled", "お支払い機能は現在ご利用いただけません");
    }

    const user = await deps.authenticate(request);

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
    const now = deps.now ?? (() => new Date());
    const dbPortalAllowed = isBillingPortalAllowed(entitlement, now());

    const { data, error } = await deps.admin.rpc("get_billing_customer_by_user", {
      p_user_id: user.userId,
    });
    if (error !== null) {
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }
    const customerId =
      data !== null && typeof data === "object"
        ? (data as { stripe_customer_id?: unknown }).stripe_customer_id
        : undefined;
    if (typeof customerId !== "string" || customerId.length === 0) {
      // DB 許可でも map 無しは 404。Free 終端の map 無しは 403（Checkout 誘導）
      if (dbPortalAllowed) {
        throw new HttpError(
          404,
          "billing_customer_missing",
          "お支払い情報が見つかりません。先にプラン登録を行ってください",
        );
      }
      throw new HttpError(
        403,
        "billing_portal_unavailable",
        "お支払い管理を開ける状態ではありません。プラン登録からお進みください",
      );
    }

    // B9: DB 投影が Free 終端でも Stripe live sub があれば Portal を開く。
    // Checkout list が live を既に検出している複合で 403 に閉じない。
    // 真の Free 終端（live 無し）は従来どおり 403（trial 再付与・price 変更の Portal 迂回を塞ぐ）。
    if (!dbPortalAllowed) {
      let hasLive: boolean;
      try {
        hasLive = await customerHasLiveStripeSubscription(deps.stripe, customerId);
      } catch {
        throw new HttpError(503, "request_failed", "処理を完了できませんでした");
      }
      if (!hasLive) {
        throw new HttpError(
          403,
          "billing_portal_unavailable",
          "お支払い管理を開ける状態ではありません。プラン登録からお進みください",
        );
      }
      log({
        level: "info",
        requestId,
        code: "billing_portal_allowed_stripe_live",
        durationMs: Date.now() - startedAt,
        stripeCustomerId: customerId,
      });
    }

    const session = await deps.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${deps.env.SERVER_SITE_ORIGIN}/settings`,
      locale: "ja",
    });
    if (typeof session.url !== "string" || session.url.length === 0) {
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }

    log({
      level: "info",
      requestId,
      code: "billing_portal_created",
      durationMs: Date.now() - startedAt,
      stripeCustomerId: customerId,
    });

    return json<PortalData>(200, { ok: true, data: { url: session.url } });
  } catch (error: unknown) {
    return handleError(error);
  }
}

export default async function billingPortal(request: Request): Promise<Response> {
  const env = getServerEnv();
  return runBillingPortal(request, {
    env,
    authenticate: requireUserWithEmail,
    loadEntitlement,
    stripe: getStripeClientFromEnv(env) ?? (null as never),
    admin: getSupabaseAdmin(),
  });
}

export const config: Config = {
  path: "/api/billing/portal",
  method: "POST",
};
