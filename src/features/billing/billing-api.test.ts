import { describe, expect, it, vi, beforeEach } from "vitest";
import { isAllowedStripeRedirectUrl } from "@shared/contracts/billing";
import { createCheckoutSession, createPortalSession } from "./billing-api";

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: vi.fn(() => Promise.resolve("access-token-test")),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: vi.fn(() => ({})),
}));

describe("isAllowedStripeRedirectUrl (B7)", () => {
  it("accepts Stripe checkout and portal hosts over https", () => {
    expect(isAllowedStripeRedirectUrl("https://checkout.stripe.com/c/pay/cs_test")).toBe(true);
    expect(isAllowedStripeRedirectUrl("https://billing.stripe.com/p/session/test")).toBe(true);
    expect(isAllowedStripeRedirectUrl("https://checkout.stripe.test/c/pay/cs_mock")).toBe(true);
    expect(isAllowedStripeRedirectUrl("https://billing.stripe.test/p/session/mock")).toBe(true);
  });

  it("rejects non-Stripe hosts and non-https", () => {
    expect(isAllowedStripeRedirectUrl("https://evil.example/phish")).toBe(false);
    expect(isAllowedStripeRedirectUrl("http://checkout.stripe.com/c/pay/cs_test")).toBe(false);
    expect(isAllowedStripeRedirectUrl("https://checkout.stripe.com.evil.example/x")).toBe(false);
    expect(isAllowedStripeRedirectUrl("not-a-url")).toBe(false);
  });
});

describe("createCheckoutSession / createPortalSession host DiD (B7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects checkout URL outside Stripe hosts", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { url: "https://evil.example/phish" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createCheckoutSession({ interval: "month" }, { fetchImpl })).rejects.toThrow(
      "billing_redirect_url_invalid",
    );
  });

  it("accepts Stripe checkout URL", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            data: { url: "https://checkout.stripe.com/c/pay/cs_ok" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(createCheckoutSession({ interval: "month" }, { fetchImpl })).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_ok",
    });
  });

  it("rejects portal URL outside Stripe hosts", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { url: "https://evil.example/portal" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(createPortalSession({ fetchImpl })).rejects.toThrow(
      "billing_redirect_url_invalid",
    );
  });
});
