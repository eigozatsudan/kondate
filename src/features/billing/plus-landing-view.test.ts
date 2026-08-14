import { describe, expect, it } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { resolvePlusLandingView } from "./plus-landing-view";

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
