import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import type { PortalData } from "../../shared/contracts/billing.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { createStripeClient } from "./_shared/billing-stripe.js";
import { getServerEnv, type ServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import { createSafeLogger, type SafeLogEvent } from "./_shared/logger.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./_shared/supabase-admin.js";

export type BillingPortalDeps = {
  env: ServerEnv;
  authenticate: (request: Request) => Promise<{ userId: string; email: string }>;
  stripe: {
    billingPortal: {
      sessions: {
        create: (
          params: Stripe.BillingPortal.SessionCreateParams,
        ) => Promise<Stripe.BillingPortal.Session>;
      };
    };
  };
  admin: Pick<AdminSupabaseClient, "rpc">;
  log?: (event: SafeLogEvent) => void;
  requestId?: string;
};

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
      throw new HttpError(
        404,
        "billing_customer_missing",
        "お支払い情報が見つかりません。先にプラン登録を行ってください",
      );
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
    stripe: env.stripe === undefined ? (null as never) : createStripeClient(env.stripe.secretKey),
    admin: getSupabaseAdmin(),
  });
}

export const config: Config = {
  path: "/api/billing/portal",
  method: "POST",
};
