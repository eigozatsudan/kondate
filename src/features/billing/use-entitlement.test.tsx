import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS,
  ENTITLEMENT_SUCCESS_POLL_INTERVAL_MS,
  ENTITLEMENT_SUCCESS_POLL_MAX_FAILURES,
  shouldContinueEntitlementSuccessPoll,
} from "./use-entitlement";

describe("shouldContinueEntitlementSuccessPoll", () => {
  const base = {
    plusEntitled: false,
    fetchFailureCount: 0,
    startedAtMs: 1_000_000,
    nowMs: 1_000_000,
  };

  it("continues while free within deadline and without failure storm", () => {
    expect(
      shouldContinueEntitlementSuccessPoll({
        ...base,
        nowMs: base.startedAtMs + ENTITLEMENT_SUCCESS_POLL_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("stops when plus entitled", () => {
    expect(
      shouldContinueEntitlementSuccessPoll({
        ...base,
        plusEntitled: true,
      }),
    ).toBe(false);
  });

  it("stops at 5 minute deadline", () => {
    expect(
      shouldContinueEntitlementSuccessPoll({
        ...base,
        nowMs: base.startedAtMs + ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS,
      }),
    ).toBe(false);
  });

  it("stops after continuous failures reach threshold", () => {
    expect(
      shouldContinueEntitlementSuccessPoll({
        ...base,
        fetchFailureCount: ENTITLEMENT_SUCCESS_POLL_MAX_FAILURES,
      }),
    ).toBe(false);
  });

  it("locks interval and deadline constants to design values", () => {
    expect(ENTITLEMENT_SUCCESS_POLL_INTERVAL_MS).toBe(2_000);
    expect(ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS).toBe(5 * 60 * 1000);
    expect(ENTITLEMENT_SUCCESS_POLL_MAX_FAILURES).toBe(3);
  });

  it("stops at deadline even when plusEntitled and failureCount stay unchanged (B8)", () => {
    expect(
      shouldContinueEntitlementSuccessPoll({
        ...base,
        plusEntitled: false,
        fetchFailureCount: 0,
        nowMs: base.startedAtMs + ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS + 1,
      }),
    ).toBe(false);
  });
});
