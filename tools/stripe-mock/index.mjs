/**
 * Stripe ローカル mock 補助。
 * - 固定 webhook secret（E2E / unit 署名検証用）
 * - Checkout Session URL 固定返却
 * - webhook fixture 組み立て（署名付き payload 生成は test 側で constructEvent mock 可）
 *
 * 本番 Stripe API を呼ばない。CI は mock 注入のみ。
 */

/** 固定テスト用 webhook secret（whsec_ 形式）。Dashboard 値ではない。 */
export const STRIPE_MOCK_WEBHOOK_SECRET = "whsec_test_kondate_billing_fixed_secret";

/** 固定 Checkout Session URL（redirect 先の疑似） */
export const STRIPE_MOCK_CHECKOUT_SESSION_URL =
  "https://checkout.stripe.test/c/pay/cs_test_mock_session";

export const STRIPE_MOCK_CHECKOUT_SESSION_ID = "cs_test_mock_session";

export const STRIPE_MOCK_PORTAL_SESSION_URL = "https://billing.stripe.test/p/session/test_portal";

/**
 * E2E / unit 用の Stripe Event 風 payload を組み立てる。
 * 実署名は Stripe SDK constructEvent か test mock で検証する。
 *
 * @param {{ type: string, payload?: Record<string, unknown>, id?: string, created?: number }} input
 */
export function injectStripeWebhookEvent(input) {
  const created = input.created ?? Math.floor(Date.now() / 1000);
  const id = input.id ?? `evt_mock_${created}`;
  return {
    id,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created,
    type: input.type,
    data: {
      object: input.payload ?? {},
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
  };
}

/**
 * Hosted Checkout の疑似 Session オブジェクト。
 * @param {{ userId: string, customerId?: string, interval?: "month"|"year" }} input
 */
export function createMockCheckoutSession(input) {
  return {
    id: STRIPE_MOCK_CHECKOUT_SESSION_ID,
    object: "checkout.session",
    url: STRIPE_MOCK_CHECKOUT_SESSION_URL,
    mode: "subscription",
    customer: input.customerId ?? "cus_mock_1",
    client_reference_id: input.userId,
    metadata: {
      supabase_user_id: input.userId,
      plan_code: "plus",
      interval: input.interval ?? "month",
    },
  };
}

export function createMockPortalSession() {
  return {
    id: "bps_test_mock",
    object: "billing_portal.session",
    url: STRIPE_MOCK_PORTAL_SESSION_URL,
  };
}
