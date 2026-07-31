import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  householdSafetyChangedEvent,
  isHouseholdSafetyRevisionStorageKey,
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
 *
 * 再検査には 2 種ある:
 * - hard: 家族条件が変わったと分かる経路。同一ターンで checking に落とし本文を隠す。
 *   失敗時は error（旧 valid で reopen しない）。
 * - soft: poll / focus / visibility。直前の checked 結果を出したまま裏で POST する
 *   （マウスをウィンドウへ戻しただけの focus でフル画面ゲートが点滅するのを防ぐ）。
 *   soft のネットワーク失敗は last-known-good を維持（意図的）。
 * - online 復帰は hard（offline 閉鎖のあと、成功するまで操作を再開しない）。
 *
 * 飛行中の hard は常に checking。古い hard の完了で最新の閉じ状態を開けない。
 * Realtime は RLS で本人行に限定し、browser から owner ID を送らない。
 */
export function useMenuRevalidation(menuId: string) {
  const cache = useQueryClient();
  const [forcedChecking, setForcedChecking] = useState(false);
  // 単調増加。完了時に最新世代だけが forcedChecking を解除する
  const requestGenerationRef = useRef(0);

  // 配列参照を render ごとに変えない（callback/effect thrash で poll・Realtime が壊れる）
  const queryKey = useMemo(() => menuRevalidationQueryKey(menuId), [menuId]);

  const query = useQuery({
    queryKey,
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
    // focus は自前 soft recheck で扱う。RQ 既定の window focus refetch と二重にしない
    refetchOnWindowFocus: false,
    enabled: menuId.length > 0,
  });

  /**
   * soft: キャッシュを残したまま再 POST。表示は直前の checked を維持する。
   */
  const beginSoftRecheck = useCallback(() => {
    if (menuId.length === 0) return;
    void cache.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "active",
    });
  }, [cache, menuId, queryKey]);

  /**
   * hard: 同期的に checking へ落とし、キャッシュを本当に捨ててから再 POST する。
   * setQueryData(undefined) は TQ v5 で no-op のため removeQueries / resetQueries を使う。
   * 進行中 soft の finally が forcedChecking を下ろさないよう、先に世代を進める。
   */
  const beginHardRecheck = useCallback(() => {
    if (menuId.length === 0) return;
    // 進行中 soft の finally が generation 一致で forcedChecking を下ろすのを防ぐ
    requestGenerationRef.current += 1;
    setForcedChecking(true);
    void cache.cancelQueries({ queryKey, exact: true });
    // data を消してから active refetch（失敗時 hasData=false → error、旧 valid に戻さない）
    void cache.resetQueries({ queryKey, exact: true });
  }, [cache, menuId, queryKey]);

  /**
   * 公開 API は hard（ラベル確認後・stale confirm 失敗など fail-closed が必要な呼び出し元向け）。
   */
  const beginRecheck = beginHardRecheck;

  useEffect(() => {
    const hard = () => {
      beginHardRecheck();
    };
    const soft = () => {
      beginSoftRecheck();
    };
    const stored = (event: StorageEvent) => {
      if (isHouseholdSafetyRevisionStorageKey(event.key)) hard();
    };
    // マウスを画面へ戻しただけでも window focus が飛ぶため soft（裏再検査）
    const onFocus = () => {
      if (document.visibilityState === "visible") soft();
    };
    // online は hard: offline で閉じたあと、成功するまで操作を再開しない
    const onOnline = () => {
      hard();
    };
    const onOffline = () => {
      // オフライン中は fetch が始まらないため、明示的に閉じ続ける
      setForcedChecking(true);
    };
    const channel = getBrowserSupabaseClient()
      .channel(`menu-safety:${menuId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members" }, hard)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_allergies" }, hard)
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
      if (document.visibilityState === "visible" && navigator.onLine) soft();
    }, pollMs);
    window.addEventListener(householdSafetyChangedEvent, hard);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(householdSafetyChangedEvent, hard);
      window.removeEventListener("storage", stored);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
      void channel.unsubscribe();
    };
  }, [beginHardRecheck, beginSoftRecheck, menuId]);

  // hard / 初回 data なしだけ checking。soft の isFetching では直前結果を出したままにする。
  // soft 失敗は hasData 維持で checked（last-known-good）。hard 失敗は data 無しで error。
  const hasData = query.data !== undefined;
  const phase: RevalidationPhaseName = forcedChecking
    ? "checking"
    : !hasData && (query.isPending || query.isFetching)
      ? "checking"
      : !hasData && query.isError
        ? "error"
        : hasData
          ? "checked"
          : "checking";

  const errorMessage =
    query.error instanceof Error ? query.error.message : "現在の家族設定で確認できませんでした";

  const refetch = useCallback(() => {
    // エラー画面の「もう一度確認」は hard（操作再開前に閉じたゲートを取り直す）
    requestGenerationRef.current += 1;
    setForcedChecking(true);
    void cache.cancelQueries({ queryKey, exact: true });
    return cache.resetQueries({ queryKey, exact: true });
  }, [cache, queryKey]);

  return {
    ...query,
    phase,
    result: phase === "checked" ? query.data : undefined,
    errorMessage: phase === "error" ? errorMessage : undefined,
    beginRecheck,
    beginSoftRecheck,
    beginHardRecheck,
    refetch,
  };
}
