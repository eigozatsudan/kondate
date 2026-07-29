import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getEntitlement } from "./billing-api";

export function entitlementQueryKey(userId: string) {
  return ["billing-entitlement", userId] as const;
}

/** Checkout 成功後の短周期 poll 間隔（設計: webhook 遅延 UX） */
export const ENTITLEMENT_SUCCESS_POLL_INTERVAL_MS = 2_000;
/** 短周期 poll の上限（設計: 5 分後も Free なら確認不能 UX へ） */
export const ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS = 5 * 60 * 1000;
/** 連続失敗で短周期を止める閾値 */
export const ENTITLEMENT_SUCCESS_POLL_MAX_FAILURES = 3;

export type EntitlementSuccessPollInput = {
  plusEntitled: boolean;
  fetchFailureCount: number;
  startedAtMs: number;
  nowMs: number;
};

/**
 * Checkout 成功後の短周期 poll 継続判定。
 * Plus 反映・5 分 deadline・連続失敗で false（無期限 2s poll 禁止）。
 */
export function shouldContinueEntitlementSuccessPoll(input: EntitlementSuccessPollInput): boolean {
  if (input.plusEntitled) return false;
  if (input.fetchFailureCount >= ENTITLEMENT_SUCCESS_POLL_MAX_FAILURES) return false;
  if (input.nowMs - input.startedAtMs >= ENTITLEMENT_SUCCESS_POLL_DEADLINE_MS) return false;
  return true;
}

/**
 * 設定・成功後 upsell が共有する entitlement クエリ。
 * billing=success 復帰時は webhook 遅延に備え短周期 re-fetch する。
 * Plus 反映・5 分 deadline・連続失敗で停止する（無期限 2s poll 禁止）。
 */
export function useEntitlement(
  userId: string,
  options: {
    /** Stripe Checkout 成功戻り。true の間だけ短周期で再取得する。 */
    pollAfterCheckoutSuccess?: boolean;
    /** Plus 反映または poll 終了時（query 除去用）。 */
    onCheckoutPollSettled?: () => void;
  } = {},
) {
  const pollAfterCheckoutSuccess = options.pollAfterCheckoutSuccess === true;
  const onCheckoutPollSettled = options.onCheckoutPollSettled;
  const pollStartedAtRef = useRef<number | null>(null);
  const settledRef = useRef(false);
  const [pollActive, setPollActive] = useState(pollAfterCheckoutSuccess);

  useEffect(() => {
    if (pollAfterCheckoutSuccess) {
      pollStartedAtRef.current = Date.now();
      settledRef.current = false;
      setPollActive(true);
    } else {
      pollStartedAtRef.current = null;
      setPollActive(false);
    }
  }, [pollAfterCheckoutSuccess]);

  const query = useQuery({
    queryKey: entitlementQueryKey(userId),
    queryFn: () => getEntitlement(),
    // 通常は 30s。Checkout 成功直後は 2s で webhook 反映を待つ。
    staleTime: pollActive ? 0 : 30_000,
    refetchInterval: (q) => {
      if (!pollActive) return false;
      const started = pollStartedAtRef.current ?? Date.now();
      const cont = shouldContinueEntitlementSuccessPoll({
        plusEntitled: q.state.data?.plusEntitled === true,
        fetchFailureCount: q.state.fetchFailureCount,
        startedAtMs: started,
        nowMs: Date.now(),
      });
      return cont ? ENTITLEMENT_SUCCESS_POLL_INTERVAL_MS : false;
    },
    enabled: userId.length > 0,
  });

  useEffect(() => {
    if (!pollActive || settledRef.current) return;
    const started = pollStartedAtRef.current ?? Date.now();
    const cont = shouldContinueEntitlementSuccessPoll({
      plusEntitled: query.data?.plusEntitled === true,
      fetchFailureCount: query.failureCount,
      startedAtMs: started,
      nowMs: Date.now(),
    });
    if (!cont) {
      settledRef.current = true;
      setPollActive(false);
      onCheckoutPollSettled?.();
    }
  }, [pollActive, query.data?.plusEntitled, query.failureCount, onCheckoutPollSettled]);

  return query;
}
