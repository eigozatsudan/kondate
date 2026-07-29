import type { Config } from "@netlify/functions";
import { requireUserWithEmail } from "./_shared/auth.js";
import { loadEntitlement } from "./_shared/billing-entitlement.js";
import { runBillingCheckout } from "./_shared/billing-checkout.js";
import { getStripeClientFromEnv } from "./_shared/billing-stripe.js";
import { getServerEnv } from "./_shared/env.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/**
 * POST /api/billing/checkout
 * Hosted Checkout Session を作成し redirect URL を返す。
 */
export default async function billingCheckout(request: Request): Promise<Response> {
  const env = getServerEnv();
  // billingEnabled=false / 鍵無しは runBillingCheckout 内で 503 billing_disabled
  const stripeClient = getStripeClientFromEnv(env);
  return runBillingCheckout(request, {
    env,
    authenticate: requireUserWithEmail,
    loadEntitlement,
    // 鍵無し時は never で満たし、runBillingCheckout が 503 を返す
    stripe: stripeClient === null ? (null as never) : stripeClient,
    admin: getSupabaseAdmin(),
  });
}

export const config: Config = {
  path: "/api/billing/checkout",
  method: "POST",
};
