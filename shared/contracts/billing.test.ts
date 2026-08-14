import { describe, expect, it } from "vitest";
import {
  PLUS_LP_UPGRADE_COMING_SOON,
  STRIPE_API_VERSION,
  checkoutDataSchema,
  checkoutRequestSchema,
  entitlementDataSchema,
  portalDataSchema,
} from "./billing.js";

describe("billing contracts", () => {
  it("accepts month|year interval and rejects priceInterval", () => {
    expect(checkoutRequestSchema.parse({ interval: "month" })).toEqual({ interval: "month" });
    expect(checkoutRequestSchema.parse({ interval: "year" })).toEqual({ interval: "year" });
    expect(checkoutRequestSchema.safeParse({ priceInterval: "month" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ interval: "week" }).success).toBe(false);
  });

  it("locks entitlement wire shape including productSurfacesOpen and quotaPlan", () => {
    const sample = {
      plan: "plus",
      status: "active",
      plusEntitled: true,
      pastDueGrace: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      dbPlusEntitled: true,
      productSurfacesOpen: true,
      quotaPlan: "plus",
    };
    expect(entitlementDataSchema.parse(sample)).toEqual(sample);
    expect(
      entitlementDataSchema.safeParse({
        ...sample,
        email: "leaked@example.com",
      }).success,
    ).toBe(false);
  });

  it("rejects non-datetime entitlement period strings (S18)", () => {
    const base = {
      plan: "plus" as const,
      status: "active" as const,
      plusEntitled: true,
      pastDueGrace: false,
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      dbPlusEntitled: true,
      productSurfacesOpen: true,
      quotaPlan: "plus" as const,
    };
    expect(
      entitlementDataSchema.safeParse({ ...base, currentPeriodEnd: "not-a-date" }).success,
    ).toBe(false);
    expect(entitlementDataSchema.safeParse({ ...base, trialEnd: "soon" }).success).toBe(false);
  });

  it("pins STRIPE_API_VERSION to the design-locked dahlia string", () => {
    expect(STRIPE_API_VERSION).toBe("2026-06-24.dahlia");
  });

  it("locks PLUS_LP_UPGRADE_COMING_SOON as the dual-surface upgrade gate (B4)", () => {
    // 公開時に false へ戻す。true のあいだ UI と Checkout API が同時に閉じる。
    expect(typeof PLUS_LP_UPGRADE_COMING_SOON).toBe("boolean");
    expect(PLUS_LP_UPGRADE_COMING_SOON).toBe(true);
  });

  // S9: schema が Stripe host DiD を含み evil URL を構造拒否する
  it("S9: checkout/portal data schemas reject non-Stripe redirect hosts", () => {
    expect(
      checkoutDataSchema.safeParse({ url: "https://checkout.stripe.com/c/pay/cs_test" }).success,
    ).toBe(true);
    expect(
      portalDataSchema.safeParse({ url: "https://billing.stripe.com/p/session/test" }).success,
    ).toBe(true);
    expect(
      checkoutDataSchema.safeParse({ url: "http://checkout.stripe.com/c/pay/x" }).success,
    ).toBe(false);
    expect(checkoutDataSchema.safeParse({ url: "https://evil.example/phish" }).success).toBe(false);
    expect(portalDataSchema.safeParse({ url: "https://evil.example/phish" }).success).toBe(false);
  });
});
