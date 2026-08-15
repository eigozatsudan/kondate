import { describe, expect, it } from "vitest";
import {
  applyQuotaPlan,
  computePlusEntitled,
  limitsForPlan,
  PAST_DUE_GRACE_HOURS,
  productSurfacesOpen,
  restoreKillMaskedEntitlement,
  toEntitlementData,
  type Entitlement,
} from "./billing-entitlement.js";

const baseEntitlement = {
  plan: "plus" as const,
  status: "active" as const,
  plusEntitled: true,
  pastDueGrace: false,
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: true,
} satisfies Entitlement;

describe("computePlusEntitled", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");

  it("returns false when row is null", () => {
    expect(computePlusEntitled(null, now)).toEqual({
      plusEntitled: false,
      pastDueGrace: false,
    });
  });

  it("returns true for trialing and active", () => {
    expect(
      computePlusEntitled(
        {
          status: "trialing",
          past_due_since: null,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: true, pastDueGrace: false });
    expect(
      computePlusEntitled(
        {
          status: "active",
          past_due_since: null,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: true, pastDueGrace: false });
  });

  it("returns false when past_due and past_due_since is null (A6)", () => {
    expect(
      computePlusEntitled(
        {
          status: "past_due",
          past_due_since: null,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: false, pastDueGrace: false });
  });

  it("returns grace true within PAST_DUE_GRACE_HOURS", () => {
    expect(PAST_DUE_GRACE_HOURS).toBe(72);
    const pastDueSince = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(
      computePlusEntitled(
        {
          status: "past_due",
          past_due_since: pastDueSince,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: true, pastDueGrace: true });
  });

  it("returns false when past_due grace has expired", () => {
    const pastDueSince = new Date(now.getTime() - 73 * 3600_000).toISOString();
    expect(
      computePlusEntitled(
        {
          status: "past_due",
          past_due_since: pastDueSince,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: false, pastDueGrace: false });
  });

  it("returns false at exact +72h grace boundary (SQL exclusive end parity)", () => {
    const pastDueSince = new Date(now.getTime() - PAST_DUE_GRACE_HOURS * 3600_000).toISOString();
    expect(
      computePlusEntitled(
        {
          status: "past_due",
          past_due_since: pastDueSince,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: false, pastDueGrace: false });
  });

  it("returns true for canceled while still in period", () => {
    expect(
      computePlusEntitled(
        {
          status: "canceled",
          past_due_since: null,
          current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: true, pastDueGrace: false });
  });

  it("returns false for canceled after period end", () => {
    expect(
      computePlusEntitled(
        {
          status: "canceled",
          past_due_since: null,
          current_period_end: "2026-07-01T00:00:00.000Z",
        },
        now,
      ),
    ).toEqual({ plusEntitled: false, pastDueGrace: false });
  });

  it.each(["unpaid", "incomplete", "incomplete_expired", "paused"] as const)(
    "returns false for non-entitled status %s",
    (status) => {
      expect(
        computePlusEntitled(
          {
            status,
            past_due_since: null,
            current_period_end: "2026-08-01T00:00:00.000Z",
          },
          now,
        ),
      ).toEqual({ plusEntitled: false, pastDueGrace: false });
    },
  );
});

describe("applyQuotaPlan", () => {
  it("forces free when billingEnabled is false even if dbPlusEntitled", () => {
    expect(applyQuotaPlan(baseEntitlement, false)).toBe("free");
  });

  it("returns plus when billingEnabled and plusEntitled", () => {
    expect(applyQuotaPlan(baseEntitlement, true)).toBe("plus");
  });

  it("returns free when billingEnabled but not plusEntitled", () => {
    expect(
      applyQuotaPlan(
        {
          ...baseEntitlement,
          plan: "free",
          plusEntitled: false,
          dbPlusEntitled: false,
          status: "none",
        },
        true,
      ),
    ).toBe("free");
  });
});

describe("limitsForPlan", () => {
  it("returns Free product limits", () => {
    expect(limitsForPlan("free")).toMatchObject({
      successPerDay: 3,
      attemptsPerDay: 6,
      shortWindowLimit: 4,
    });
  });

  it("returns Plus product limits", () => {
    expect(limitsForPlan("plus")).toMatchObject({
      successPerDay: 10,
      attemptsPerDay: 20,
      shortWindowLimit: 8,
    });
  });
});

describe("toEntitlementData / productSurfacesOpen (A3)", () => {
  it("closes product surfaces and forces free quota when billing disabled", () => {
    expect(productSurfacesOpen(false)).toBe(false);
    const data = toEntitlementData(baseEntitlement, false);
    expect(data.productSurfacesOpen).toBe(false);
    expect(data.quotaPlan).toBe("free");
    expect(data.dbPlusEntitled).toBe(true);
    // B5: plusEntitled は quota 実効（usage と同義）。kill 中は false。DB 生値は dbPlusEntitled
    expect(data.plusEntitled).toBe(false);
  });

  it("opens product surfaces and uses plus quota when enabled and entitled", () => {
    expect(productSurfacesOpen(true)).toBe(true);
    const data = toEntitlementData(baseEntitlement, true);
    expect(data.productSurfacesOpen).toBe(true);
    expect(data.quotaPlan).toBe("plus");
    expect(data.plusEntitled).toBe(true);
  });
});

describe("restoreKillMaskedEntitlement (B2)", () => {
  const killMasked: Entitlement = {
    plan: "free",
    status: "unpaid",
    plusEntitled: false,
    pastDueGrace: false,
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    dbPlusEntitled: false,
    pastDueSince: null,
    killSourceStatus: "active",
  };

  it("does not restore while billing is still killed", () => {
    const restored = restoreKillMaskedEntitlement(killMasked, false);
    expect(restored.status).toBe("unpaid");
    expect(restored.plusEntitled).toBe(false);
    expect(applyQuotaPlan(killMasked, false)).toBe("free");
  });

  it("does not elevate from stale kill_source without Stripe (B2)", () => {
    // kill 中に Stripe が canceled/unpaid でも webhook 欠落なら kill_source は active のまま。
    // BILLING_ENABLED 復帰だけで Plus に戻さない（webhook / reconcile 待ち）。
    const restored = restoreKillMaskedEntitlement(killMasked, true);
    expect(restored.status).toBe("unpaid");
    expect(restored.plusEntitled).toBe(false);
    expect(restored.plan).toBe("free");
    expect(applyQuotaPlan(killMasked, true)).toBe("free");
    const data = toEntitlementData(killMasked, true);
    expect(data.status).toBe("unpaid");
    expect(data.plusEntitled).toBe(false);
    expect(data.quotaPlan).toBe("free");
    expect(data.dbPlusEntitled).toBe(false);
  });

  it("does not restore real unpaid that has no kill source", () => {
    const realUnpaid: Entitlement = {
      ...killMasked,
      killSourceStatus: null,
    };
    expect(restoreKillMaskedEntitlement(realUnpaid, true).status).toBe("unpaid");
    expect(applyQuotaPlan(realUnpaid, true)).toBe("free");
  });

  it("does not restore past_due kill_source as plus (B2)", () => {
    const now = new Date();
    const pastDueMasked: Entitlement = {
      ...killMasked,
      pastDueSince: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      killSourceStatus: "past_due",
    };
    const restored = restoreKillMaskedEntitlement(pastDueMasked, true, now);
    expect(restored.status).toBe("unpaid");
    expect(restored.plusEntitled).toBe(false);
    expect(applyQuotaPlan(pastDueMasked, true, now)).toBe("free");
  });

  it("keeps unpaid when kill-source past_due has null since", () => {
    const pastDueMasked: Entitlement = {
      ...killMasked,
      pastDueSince: null,
      killSourceStatus: "past_due",
    };
    const restored = restoreKillMaskedEntitlement(pastDueMasked, true);
    expect(restored.status).toBe("unpaid");
    expect(restored.plusEntitled).toBe(false);
    expect(applyQuotaPlan(pastDueMasked, true)).toBe("free");
  });

  it("does not restore canceled kill_source as plus (B2)", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const canceledMasked: Entitlement = {
      ...killMasked,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      killSourceStatus: "canceled",
    };
    const restored = restoreKillMaskedEntitlement(canceledMasked, true, now);
    expect(restored.status).toBe("unpaid");
    expect(restored.plusEntitled).toBe(false);
    expect(applyQuotaPlan(canceledMasked, true, now)).toBe("free");
    const data = toEntitlementData(canceledMasked, true, now);
    expect(data.status).toBe("unpaid");
    expect(data.plusEntitled).toBe(false);
    expect(data.quotaPlan).toBe("free");
    expect(data.dbPlusEntitled).toBe(false);
  });

  it("uses one clock for restore and quota so wire stays consistent (B15)", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const canceled: Entitlement = {
      ...killMasked,
      status: "canceled",
      currentPeriodEnd: now.toISOString(),
      killSourceStatus: null,
      plusEntitled: false,
      plan: "free",
    };
    const data = toEntitlementData(canceled, true, now);
    expect(data.plusEntitled).toBe(data.quotaPlan === "plus");
    if (data.plan === "plus") {
      expect(data.plusEntitled).toBe(true);
    }
  });
});
