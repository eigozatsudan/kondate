import { describe, expect, it } from "vitest";
import { CHECKOUT_LOCK_TTL_MS } from "./billing-checkout.js";

describe("CHECKOUT_LOCK_TTL_MS", () => {
  it("locks checkout Session lifetime to the 30 minute design TTL (B1)", () => {
    expect(CHECKOUT_LOCK_TTL_MS).toBe(30 * 60 * 1000);
  });
});
