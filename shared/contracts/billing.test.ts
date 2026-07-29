import { describe, expect, it } from "vitest";
import { STRIPE_API_VERSION, checkoutRequestSchema, entitlementDataSchema } from "./billing.js";

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

  it("pins STRIPE_API_VERSION to the design-locked acacia string", () => {
    expect(STRIPE_API_VERSION).toBe("2025-02-24.acacia");
  });
});
