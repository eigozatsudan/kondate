import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { revalidateMenu, type RevalidationResult } from "../api/revalidation-api";

export type RevalidationPhaseName = "checking" | "checked" | "error";

export type RevalidationPhase =
  | { phase: "checking" }
  | { phase: "checked"; result: RevalidationResult }
  | { phase: "error"; message: string };

export function menuRevalidationQueryKey(menuId: string) {
  return ["menu-revalidation", menuId] as const;
}

/**
 * /menus/:menuId と /history/:menuId が共有する現行安全ゲート。
 * 同一イベントターンで checking に入り、manual-success の逃げ道は持たない。
 * 飛行中の再検証は常に checking とし、古い要求の完了で最新の閉じ状態を開けない。
 * Realtime は RLS で本人行に限定し、browser から owner ID を送らない。
 */
export function useMenuRevalidation(menuId: string) {
  const cache = useQueryClient();
  const [forcedChecking, setForcedChecking] = useState(false);
  // 単調増加。完了時に最新世代だけが forcedChecking を解除する
  const requestGenerationRef = useRef(0);

  const query = useQuery({
    queryKey: menuRevalidationQueryKey(menuId),
    queryFn: async () => {
      const generation = ++requestGenerationRef.current;
      try {
        return await revalidateMenu(menuId);
      } finally {
        // 古い飛行中レスポンスが後から到着しても、最新要求の閉じ状態を開けない
        if (generation === requestGenerationRef.current) {
          setForcedChecking(false);
        }
      }
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    enabled: menuId.length > 0,
  });

  /**
   * 同期的に checking へ落とし、active query を再 POST する。
   * stale confirm 失敗など、invalidate 非同期だけでは間が空く経路から呼ぶ。
   */
  const beginRecheck = useCallback(() => {
    setForcedChecking(true);
    void cache.invalidateQueries({
      queryKey: menuRevalidationQueryKey(menuId),
      exact: true,
      refetchType: "active",
    });
  }, [cache, menuId]);

  useEffect(() => {
    const changed = () => {
      beginRecheck();
    };
    const stored = (event: StorageEvent) => {
      if (event.key === householdSafetyRevisionStorageKey) changed();
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") changed();
    };
    const onOnline = () => {
      changed();
    };
    const onOffline = () => {
      // オフライン中は fetch が始まらないため、明示的に閉じ続ける
      setForcedChecking(true);
    };
    const channel = getBrowserSupabaseClient()
      .channel(`menu-safety:${menuId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_allergies" }, changed)
      .subscribe();
    // 既定は 60s。E2E のみ window 上の test seam で短縮可能（本番は未設定）。
    const pollMs = (() => {
      const candidate = (window as Window & { __KONDATE_REVALIDATE_POLL_MS?: unknown })
        .__KONDATE_REVALIDATE_POLL_MS;
      return typeof candidate === "number" && candidate > 0 && candidate <= 60_000
        ? candidate
        : 60_000;
    })();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) changed();
    }, pollMs);
    window.addEventListener(householdSafetyChangedEvent, changed);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(householdSafetyChangedEvent, changed);
      window.removeEventListener("storage", stored);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
      void channel.unsubscribe();
    };
  }, [beginRecheck, menuId]);

  // isPending だけでは再検証 invalidate 後に古い data が残る。
  // isFetching で飛行中を、forcedChecking で同一ターンの即時閉鎖とオフラインをカバーする。
  const phase: RevalidationPhaseName =
    forcedChecking || query.isPending || query.isFetching
      ? "checking"
      : query.isError
        ? "error"
        : "checked";

  const errorMessage =
    query.error instanceof Error ? query.error.message : "現在の家族設定で確認できませんでした";

  const refetch = useCallback(() => {
    setForcedChecking(true);
    return query.refetch();
  }, [query]);

  return {
    ...query,
    phase,
    result: phase === "checked" ? query.data : undefined,
    errorMessage: phase === "error" ? errorMessage : undefined,
    beginRecheck,
    refetch,
  };
}
