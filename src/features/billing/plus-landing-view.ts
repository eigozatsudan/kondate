import type { EntitlementData } from "@shared/contracts/billing";

/**
 * サーバ billing-checkout が 409 `billing_already_entitled` にする status 集合と揃える。
 * マーケ Checkout を出してよいのはこの集合に含まれない status のみ（L13 / R-A1）。
 */
export const CHECKOUT_BLOCKED_STATUSES = ["trialing", "active", "past_due", "incomplete"] as const;

export type CheckoutBlockedStatus = (typeof CHECKOUT_BLOCKED_STATUSES)[number];

export type PlusLandingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "past_due"; surfacesOpen: boolean }
  | {
      kind: "entitled";
      surfacesOpen: boolean;
      trialing: boolean;
      trialEnd: string | null;
    }
  | { kind: "incomplete"; surfacesOpen: boolean }
  | { kind: "full"; checkoutEnabled: boolean };

function isCheckoutBlockedStatus(status: EntitlementData["status"]): boolean {
  return (CHECKOUT_BLOCKED_STATUSES as readonly string[]).includes(status);
}

/**
 * Plus LP の表示分岐の唯一の入口（設計 State matrix）。
 * 上から最初に当てはまった行だけを返す。
 * 順序: loading → error → past_due → entitled → incomplete → full
 * B6: loading/error 中は data があっても Plus 短形を出さない（fetch 成功後のみ）
 */
export function resolvePlusLandingView(input: {
  loading: boolean;
  error: boolean;
  data: EntitlementData | null;
}): PlusLandingView {
  const { loading, error, data } = input;

  // 1. loading: stale cache でも Plus 専用短形を出さない（B6 fail-closed display）
  if (loading) {
    return { kind: "loading" };
  }

  // 2. error または data なし: Plus 表示を信頼しない（stale plusEntitled を出さない）
  if (error || data == null) {
    return { kind: "error" };
  }

  // 3. past_due または pastDueGrace → 支払い短形（entitled より先）
  if (data.status === "past_due" || data.pastDueGrace) {
    return { kind: "past_due", surfacesOpen: data.productSurfacesOpen };
  }

  // 4. plusEntitled → 加入中短形（マーケ・Checkout なし）
  if (data.plusEntitled) {
    return {
      kind: "entitled",
      surfacesOpen: data.productSurfacesOpen,
      trialing: data.status === "trialing",
      trialEnd: data.trialEnd,
    };
  }

  // 5. incomplete → 手続き中短形（409 先回り・Checkout なし）
  if (data.status === "incomplete") {
    return { kind: "incomplete", surfacesOpen: data.productSurfacesOpen };
  }

  // 6/7. フル LP。checkoutEnabled は surfaces 開かつ status がブロック集合外
  return {
    kind: "full",
    checkoutEnabled: data.productSurfacesOpen && !isCheckoutBlockedStatus(data.status),
  };
}
