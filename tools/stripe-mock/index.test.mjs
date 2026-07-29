import assert from "node:assert/strict";
import test from "node:test";
import {
  STRIPE_MOCK_WEBHOOK_SECRET,
  createMockCheckoutSession,
  injectStripeWebhookEvent,
} from "./index.mjs";

test("exports fixed webhook secret and session fixtures", () => {
  assert.match(STRIPE_MOCK_WEBHOOK_SECRET, /^whsec_test_/u);
  const session = createMockCheckoutSession({ userId: "u1", interval: "year" });
  assert.equal(session.mode, "subscription");
  assert.equal(session.metadata.supabase_user_id, "u1");
  assert.ok(session.url.includes("checkout.stripe"));
});

test("injectStripeWebhookEvent builds subscription-shaped event", () => {
  const event = injectStripeWebhookEvent({
    type: "customer.subscription.updated",
    id: "evt_fixed",
    created: 2000,
    payload: {
      id: "sub_1",
      status: "active",
      metadata: { supabase_user_id: "u1" },
    },
  });
  assert.equal(event.id, "evt_fixed");
  assert.equal(event.created, 2000);
  assert.equal(event.type, "customer.subscription.updated");
  assert.equal(event.api_version, "2025-02-24.acacia");
  assert.equal(event.data.object.status, "active");
});
