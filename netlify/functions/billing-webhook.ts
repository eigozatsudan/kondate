import type { Config } from "@netlify/functions";
import { getStripeClientFromEnv } from "./_shared/billing-stripe.js";
import {
  handleBillingWebhook,
  type BillingWebhookAdmin,
  type BillingWebhookStripe,
} from "./_shared/billing-webhook.js";
import { getServerEnv } from "./_shared/env.js";
import { methodNotAllowed } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/** AdminSupabaseClient を webhook 注入面へ橋渡し（RPC 名は runtime で固定）。 */
function asWebhookAdmin(): BillingWebhookAdmin {
  const admin = getSupabaseAdmin();
  return {
    rpc: async (fn, args) => {
      // RPC 名は webhook 実装が固定文字列で呼ぶ。型は Database 関数名 union へ寄せる。
      type RpcName = Parameters<typeof admin.rpc>[0];
      const result = await admin.rpc(fn as RpcName, args as never);
      return {
        data: result.data as unknown,
        error: result.error === null ? null : { message: result.error.message },
      };
    },
    auth: {
      admin: {
        getUserById: async (id) => {
          const result = await admin.auth.admin.getUserById(id);
          const user = result.data.user;
          return {
            data: {
              user:
                user === null
                  ? null
                  : {
                      id: user.id,
                      email: user.email ?? null,
                    },
            },
            error: result.error,
          };
        },
      },
    },
  };
}

/**
 * POST /api/billing/webhook
 * Stripe-Signature 検証。JWT 不要。BILLING_ENABLED 非依存（鍵があれば稼働 = A3）。
 */
export default async function billingWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const env = getServerEnv();
  if (env.stripe === undefined) {
    return handleBillingWebhook(request, {
      env,
      // 鍵無し: handle 内で 503
      stripe: null as unknown as BillingWebhookStripe,
      admin: asWebhookAdmin(),
    });
  }
  const stripe = getStripeClientFromEnv(env);
  return handleBillingWebhook(request, {
    env,
    // env.stripe ありなら client も必ず作れる（mockBaseUrl も伝播）
    stripe: stripe as BillingWebhookStripe,
    admin: asWebhookAdmin(),
  });
}

export const config: Config = {
  path: "/api/billing/webhook",
  method: "POST",
};
