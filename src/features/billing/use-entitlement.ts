import { useQuery } from "@tanstack/react-query";
import { getEntitlement } from "./billing-api";

export function entitlementQueryKey(userId: string) {
  return ["billing-entitlement", userId] as const;
}

/**
 * 設定・成功後 upsell が共有する entitlement クエリ。
 * billing=success 復帰時は webhook 遅延に備え短周期 re-fetch する。
 */
export function useEntitlement(
  userId: string,
  options: {
    /** Stripe Checkout 成功戻り。true の間だけ短周期で再取得する。 */
    pollAfterCheckoutSuccess?: boolean;
  } = {},
) {
  const pollAfterCheckoutSuccess = options.pollAfterCheckoutSuccess === true;
  return useQuery({
    queryKey: entitlementQueryKey(userId),
    queryFn: () => getEntitlement(),
    // 通常は 30s。Checkout 成功直後は 2s で webhook 反映を待つ。
    staleTime: pollAfterCheckoutSuccess ? 0 : 30_000,
    refetchInterval: pollAfterCheckoutSuccess ? 2_000 : false,
    enabled: userId.length > 0,
  });
}
