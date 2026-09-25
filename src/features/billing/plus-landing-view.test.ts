import { describe, expect, it } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { billingAutoRenews, resolvePlusLandingView, scheduledCancelAt } from "./plus-landing-view";

const freeOpen: EntitlementData = {
  plan: "free",
  status: "none",
  plusEntitled: false,
  pastDueGrace: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: false,
  productSurfacesOpen: true,
  quotaPlan: "free",
};

describe("resolvePlusLandingView", () => {
  it("returns loading when loading without data", () => {
    expect(resolvePlusLandingView({ loading: true, error: false, data: null })).toEqual({
      kind: "loading",
    });
  });

  it("returns error when error without data", () => {
    expect(resolvePlusLandingView({ loading: false, error: true, data: null })).toEqual({
      kind: "error",
    });
  });

  it("returns past_due before entitled marketing", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "past_due",
      plusEntitled: true,
      pastDueGrace: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "past_due",
      surfacesOpen: true,
    });
  });

  it("returns entitled for active plus", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "entitled",
      surfacesOpen: true,
      trialing: false,
      trialEnd: null,
      currentPeriodEnd: null,
      scheduledEnd: null,
      autoRenews: true,
    });
  });

  it("passes the period end through and marks active plus as auto-renewing", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
      currentPeriodEnd: "2026-10-22T15:00:00.000Z",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toMatchObject({
      kind: "entitled",
      currentPeriodEnd: "2026-10-22T15:00:00.000Z",
      autoRenews: true,
    });
  });

  it.each([
    { status: "active" as const, cancelAtPeriodEnd: true },
    // 期間内に解約済み（canceled）でも期間末までは Plus。更新はされない
    { status: "canceled" as const, cancelAtPeriodEnd: false },
  ])(
    "does not mark plus as auto-renewing ($status, cancelAtPeriodEnd=$cancelAtPeriodEnd)",
    ({ status, cancelAtPeriodEnd }) => {
      const data: EntitlementData = {
        ...freeOpen,
        plan: "plus",
        status,
        plusEntitled: true,
        dbPlusEntitled: true,
        quotaPlan: "plus",
        currentPeriodEnd: "2026-10-22T15:00:00.000Z",
        cancelAtPeriodEnd,
      };
      expect(resolvePlusLandingView({ loading: false, error: false, data })).toMatchObject({
        kind: "entitled",
        autoRenews: false,
      });
    },
  );

  // UX 残り R2 項目 6: cancel_at だけで解約予約が来る（cancelAtPeriodEnd は false のまま）
  it("treats a scheduled cancelAt as not auto-renewing and exposes it as the end", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
      currentPeriodEnd: "2026-10-22T15:00:00.000Z",
      cancelAtPeriodEnd: false,
      cancelAt: "2026-10-10T15:00:00.000Z",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toMatchObject({
      kind: "entitled",
      currentPeriodEnd: "2026-10-22T15:00:00.000Z",
      scheduledEnd: "2026-10-10T15:00:00.000Z",
      autoRenews: false,
    });
  });

  it("ignores a leftover cancelAt once the subscription is canceled", () => {
    // 解約済みの Plus は期間末（entitlement の根拠）まで。残った cancelAt の日付は使わない
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "canceled",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
      currentPeriodEnd: "2026-10-22T15:00:00.000Z",
      cancelAt: "2026-12-01T15:00:00.000Z",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toMatchObject({
      kind: "entitled",
      scheduledEnd: null,
      autoRenews: false,
    });
  });

  it("returns incomplete without checkout", () => {
    const data: EntitlementData = { ...freeOpen, status: "incomplete" };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "incomplete",
      surfacesOpen: true,
    });
  });

  it("returns full with checkoutEnabled when free and surfaces open", () => {
    expect(resolvePlusLandingView({ loading: false, error: false, data: freeOpen })).toEqual({
      kind: "full",
      checkoutEnabled: true,
    });
  });

  it("returns full with checkout disabled when surfaces closed", () => {
    const data = { ...freeOpen, productSurfacesOpen: false };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "full",
      checkoutEnabled: false,
    });
  });

  it("never enables checkout when status is blocked even if surfaces open (belt)", () => {
    // matrix 上 incomplete は短形だが、実装が full に落ちても checkoutEnabled false を保証するヘルパを
    // isCheckoutBlockedStatus として export して unit してもよい。
    // resolve の incomplete 分岐が先なので kind は incomplete。
    const data: EntitlementData = { ...freeOpen, status: "incomplete" };
    const view = resolvePlusLandingView({ loading: false, error: false, data });
    expect(view.kind).toBe("incomplete");
  });

  it("does not treat dbPlusEntitled as entitled under kill (B5)", () => {
    // plusEntitled は quota 実効。kill 中は false なのでマーケ短形に落とさず Checkout も閉じる
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: false,
      dbPlusEntitled: true,
      productSurfacesOpen: false,
      quotaPlan: "free",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "full",
      checkoutEnabled: false,
    });
  });
});

it("returns loading even when stale entitled data is present (B6)", () => {
  const data: EntitlementData = {
    ...freeOpen,
    plan: "plus",
    status: "active",
    plusEntitled: true,
    dbPlusEntitled: true,
    quotaPlan: "plus",
  };
  expect(resolvePlusLandingView({ loading: true, error: false, data }).kind).toBe("loading");
});

it("returns error even when stale entitled data is present (B6)", () => {
  const data: EntitlementData = {
    ...freeOpen,
    plan: "plus",
    status: "active",
    plusEntitled: true,
    dbPlusEntitled: true,
    quotaPlan: "plus",
  };
  expect(resolvePlusLandingView({ loading: false, error: true, data }).kind).toBe("error");
});

// UX 残り R2 修正 I-2: cancelAt は境界（お試し中は trialEnd、それ以外は currentPeriodEnd）以前のときだけ
// 終了予定として扱う。境界より後なら、その前に更新・課金が起きる
describe("scheduledCancelAt boundary", () => {
  const active: EntitlementData = {
    ...freeOpen,
    plan: "plus",
    status: "active",
    plusEntitled: true,
    dbPlusEntitled: true,
    quotaPlan: "plus",
    currentPeriodEnd: "2026-10-22T15:00:00.000Z",
  };
  const trialing: EntitlementData = {
    ...active,
    status: "trialing",
    trialEnd: "2026-09-30T15:00:00.000Z",
  };

  it.each([
    { label: "before the period end", cancelAt: "2026-10-10T15:00:00.000Z" },
    { label: "equal to the period end", cancelAt: "2026-10-22T15:00:00.000Z" },
    { label: "in the past", cancelAt: "2026-09-01T15:00:00.000Z" },
  ])("treats cancelAt $label as the scheduled end while active", ({ cancelAt }) => {
    const data = { ...active, cancelAt };
    expect(scheduledCancelAt(data)).toBe(cancelAt);
    expect(billingAutoRenews(data)).toBe(false);
  });

  it("ignores cancelAt after the period end while active", () => {
    const data = { ...active, cancelAt: "2026-12-09T15:00:00.000Z" };
    expect(scheduledCancelAt(data)).toBeNull();
    expect(billingAutoRenews(data)).toBe(true);
  });

  it("uses the trial end as the boundary while trialing", () => {
    expect(scheduledCancelAt({ ...trialing, cancelAt: "2026-09-30T15:00:00.000Z" })).toBe(
      "2026-09-30T15:00:00.000Z",
    );
    // 期間末（10/22）より前でも、無料期間の終了（9/30）より後なら課金が先に起きる
    const afterTrial = { ...trialing, cancelAt: "2026-10-10T15:00:00.000Z" };
    expect(scheduledCancelAt(afterTrial)).toBeNull();
    expect(billingAutoRenews(afterTrial)).toBe(true);
  });

  it("does not treat cancelAt as scheduled when the boundary is unknown", () => {
    const data = { ...active, currentPeriodEnd: null, cancelAt: "2026-10-10T15:00:00.000Z" };
    expect(scheduledCancelAt(data)).toBeNull();
    expect(billingAutoRenews(data)).toBe(true);
    // cancelAtPeriodEnd は境界に関わらず従来どおり
    expect(billingAutoRenews({ ...data, cancelAtPeriodEnd: true })).toBe(false);
  });
});
