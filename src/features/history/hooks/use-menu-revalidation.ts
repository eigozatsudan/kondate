import { useEffect, useState } from "react";
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
 * Realtime は RLS で本人行に限定し、browser から owner ID を送らない。
 */
export function useMenuRevalidation(menuId: string) {
  const cache = useQueryClient();
  const [forcedChecking, setForcedChecking] = useState(false);
  const query = useQuery({
    queryKey: menuRevalidationQueryKey(menuId),
    queryFn: async () => {
      const result = await revalidateMenu(menuId);
      setForcedChecking(false);
      return result;
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    enabled: menuId.length > 0,
  });

  useEffect(() => {
    const changed = () => {
      // 同期的に checking へ落とし、直後に active query を再 POST する
      setForcedChecking(true);
      void cache.invalidateQueries({
        queryKey: menuRevalidationQueryKey(menuId),
        exact: true,
        refetchType: "active",
      });
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
      setForcedChecking(true);
    };
    const channel = getBrowserSupabaseClient()
      .channel(`menu-safety:${menuId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_allergies" }, changed)
      .subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) changed();
    }, 60_000);
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
  }, [cache, menuId]);

  // isPending のみでは再検証 invalidate 後に古い data が残るため forcedChecking を併用する
  const phase: RevalidationPhaseName =
    forcedChecking || query.isPending ? "checking" : query.isError ? "error" : "checked";

  const errorMessage =
    query.error instanceof Error ? query.error.message : "現在の家族設定で確認できませんでした";

  return {
    ...query,
    phase,
    result: phase === "checked" ? query.data : undefined,
    errorMessage: phase === "error" ? errorMessage : undefined,
  };
}
