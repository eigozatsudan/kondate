import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/use-auth";
import {
  householdSafetyChangedEvent,
  householdSafetyQueryPrefixes,
  isHouseholdSafetyRevisionStorageKeyForUser,
  subscribeHouseholdSafetyBroadcast,
} from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  revalidateMenu,
  RevalidationApiError,
  type RevalidationResult,
} from "../api/revalidation-api";

export type RevalidationPhaseName = "checking" | "checked" | "error";

export type RevalidationPhase =
  | { phase: "checking" }
  | { phase: "checked"; result: RevalidationResult }
  | { phase: "error"; message: string };

/** RQ キー。prefix は householdSafetyQueryPrefixes.historyRevalidation と一致させる（HR3）。 */
export function menuRevalidationQueryKey(menuId: string) {
  return [...householdSafetyQueryPrefixes.historyRevalidation, menuId] as const;
}

/**
 * /menus/:menuId と /history/:menuId が共有する現行安全ゲート。
 *
 * 再検査には 2 種ある:
 * - hard: 家族条件が変わったと分かる経路。同一ターンで checking に落とし本文を隠す。
 *   失敗時は error（旧 valid で reopen しない）。
 * - soft: poll / focus / visibility。直前の checked 結果を出したまま裏で POST する
 *   （マウスをウィンドウへ戻しただけの focus でフル画面ゲートが点滅するのを防ぐ）。
 *   soft のネットワーク失敗は error へ（last-known-good valid で CTA を開かない = fail-closed）。
 *   soft 飛行中かつ直前が成功済みのときだけ checked を維持する。
 *   ただし soft 飛行中は isSoftRechecking=true を返し、呼び出し側は採用/再生成/買い物 CTA
 *   と本文 mutation（ラベル確認・在庫）を閉じる（soft 完了までの操作窓を塞ぐ）。
 * - online 復帰は hard（offline 閉鎖のあと、成功するまで操作を再開しない）。
 * - offline は hard と同様に世代を進め forcedChecking を立てるが、再 POST はしない
 *   （online hard が成功するまで閉じ続ける。飛行中 soft の finally で CTA を戻さない）。
 *   isOfflineHold=true のあいだ UI は shopping と同型の接続誘導 copy を出す。
 *
 * 飛行中の hard は常に checking。古い hard の完了で最新の閉じ状態を開けない。
 * Realtime は RLS で本人行に限定し、browser から owner ID を送らない。
 * Realtime 購読失敗（CHANNEL_ERROR / TIMED_OUT）も hard 再検査へ落とす（shopping gate と同型の fail-closed）。
 */
export function useMenuRevalidation(menuId: string) {
  const cache = useQueryClient();
  const userId = useAuth().session?.user.id;
  const [forcedChecking, setForcedChecking] = useState(false);
  // HR1: offline hold 中だけ true。checking overlay を shopping と同型の offline 文言に切り替える
  const [isOfflineHold, setIsOfflineHold] = useState(false);
  // HR4: soft コールバックが最新 hold を見る（effect 再束縛なし / jsdom の onLine 不整合にも耐える）
  const isOfflineHoldRef = useRef(false);
  isOfflineHoldRef.current = isOfflineHold;
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
   * offline: hard と同じく世代を進めて閉じるが、offline 中は再 POST しない。
   * online 復帰の hard 契約と衝突させない（resetQueries しない）。
   */
  const beginOfflineHold = useCallback(() => {
    if (menuId.length === 0) return;
    // HR3: 飛行中 soft の finally が generation 一致で forcedChecking を下ろすのを防ぐ
    requestGenerationRef.current += 1;
    setIsOfflineHold(true);
    setForcedChecking(true);
    void cache.cancelQueries({ queryKey, exact: true });
  }, [cache, menuId, queryKey]);

  /**
   * soft: キャッシュを残したまま再 POST。表示は直前の checked を維持する。
   * HR4: offline hold 中は no-op（generation を進めず sticky を保つ）。
   * HR2: offline なのに hold 未入なら beginOfflineHold へ（`offline` イベント欠落でも CTA を閉じる）。
   * focus soft が generation を進めて finally で hold を崩し error CTA へ落ちる経路を閉じる。
   */
  const beginSoftRecheck = useCallback(() => {
    if (menuId.length === 0) return;
    if (isOfflineHoldRef.current) return;
    // HR2: soft/poll/focus 到達時に offline なら hold へ（イベント無し切断でも actionable を残さない）
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      beginOfflineHold();
      return;
    }
    void cache.invalidateQueries({
      queryKey,
      exact: true,
      refetchType: "active",
    });
  }, [beginOfflineHold, cache, menuId, queryKey]);

  /**
   * hard: 同期的に checking へ落とし、キャッシュを本当に捨ててから再 POST する。
   * setQueryData(undefined) は TQ v5 で no-op のため removeQueries / resetQueries を使う。
   * 進行中 soft の finally が forcedChecking を下ろさないよう、先に世代を進める。
   * HR1: offline 中の hard（Realtime CHANNEL_ERROR/TIMED_OUT 等）は POST せず hold を sticky に保つ。
   * online 復帰（navigator.onLine=true）の hard だけが hold を下ろして再 POST する。
   */
  const beginHardRecheck = useCallback(() => {
    if (menuId.length === 0) return;
    // HR1: offline 中は resetQueries（POST）も hold 解除もしない
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      beginOfflineHold();
      return;
    }
    // 進行中 soft の finally が generation 一致で forcedChecking を下ろすのを防ぐ
    requestGenerationRef.current += 1;
    // online hard 等へ遷移したら offline 専用文言は下ろす（再 POST 中は通常 checking copy）
    setIsOfflineHold(false);
    setForcedChecking(true);
    void cache.cancelQueries({ queryKey, exact: true });
    // data を消してから active refetch（失敗時 hasData=false → error、旧 valid に戻さない）
    void cache.resetQueries({ queryKey, exact: true });
  }, [beginOfflineHold, cache, menuId, queryKey]);

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
      // H12: 自 user の revision だけ hard 再検査（他アカウント共有端末の誤 invalidate を閉じる）
      if (userId !== undefined && isHouseholdSafetyRevisionStorageKeyForUser(event.key, userId)) {
        hard();
      }
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
      beginOfflineHold();
    };
    const channel = getBrowserSupabaseClient()
      .channel(`menu-safety:${menuId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members" }, hard)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_allergies" }, hard)
      .subscribe((status) => {
        // Realtime 購読状態は文字列比較（テストからも素の文字列が届く）。
        // CHANNEL_ERROR / TIMED_OUT は hard 再検査へ（旧 valid のまま 60s soft 依存にしない）。
        // offline 中は beginHardRecheck 内で hold へ（HR1: sticky hold を error に落とさない）。
        const state: string = status;
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          hard();
        }
      });
    // 既定は 60s。dev / E2E のみ window 上の test seam で短縮・無効化可能。
    // 本番バンドル（import.meta.env.PROD）では seam を読まず常に 60s（HR7）。
    // 0 は soft poll 無効（E2E で focus/Realtime 等と 2s poll 観測を混線させない）。
    const pollMs = (() => {
      if (import.meta.env.PROD) return 60_000;
      const candidate = (window as Window & { __KONDATE_REVALIDATE_POLL_MS?: unknown })
        .__KONDATE_REVALIDATE_POLL_MS;
      if (candidate === 0) return 0;
      return typeof candidate === "number" && candidate > 0 && candidate <= 60_000
        ? candidate
        : 60_000;
    })();
    // pollMs=0 のときは interval を張らない（signal 専用待機と soft poll を分離する E2E 用）。
    // HR2: offline でも soft を呼び、beginSoftRecheck が hold へ入れる（onLine ガードは soft 側）。
    const timer =
      pollMs === 0
        ? undefined
        : window.setInterval(() => {
            if (document.visibilityState === "visible") soft();
          }, pollMs);
    window.addEventListener(householdSafetyChangedEvent, hard);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onFocus);
    // H-R3: setItem 失敗時の cross-tab hard を BroadcastChannel で補う
    const unsubscribeBroadcast =
      userId !== undefined && userId.length > 0
        ? subscribeHouseholdSafetyBroadcast(userId, hard)
        : () => {};
    return () => {
      window.removeEventListener(householdSafetyChangedEvent, hard);
      window.removeEventListener("storage", stored);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onFocus);
      unsubscribeBroadcast();
      if (timer !== undefined) window.clearInterval(timer);
      void channel.unsubscribe();
    };
  }, [beginHardRecheck, beginOfflineHold, beginSoftRecheck, menuId, userId]);

  // hard / 初回 data なしだけ checking。soft の isFetching では直前結果を出したままにする
  // （focus 点滅防止）。soft ネットワーク失敗は isError で error へ落とし、旧 valid の CTA を開かない。
  // hard 失敗は data 無し + isError で error。成功済み data かつ非 error のときだけ checked。
  const hasData = query.data !== undefined;
  const phase: RevalidationPhaseName = forcedChecking
    ? "checking"
    : hasData && !query.isError
      ? "checked"
      : query.isPending || query.isFetching
        ? "checking"
        : "error";

  // HR1: soft 飛行中（直前 checked を維持したまま isFetching）だけ true。
  // hard の forcedChecking / 初回 data なしは phase=checking 側で閉じるため false。
  const isSoftRechecking = !forcedChecking && hasData && !query.isError && query.isFetching;

  // マウント時から offline で初回 POST が落ちた場合も shopping と同型の誘導を出す
  // navigator.onLine を Error.message より優先（汎用 network 文言で offline が埋もれない）
  const offlineErrorFallback = "ネット接続後にこの献立の対象家族の設定を確認してください";
  const errorMessage =
    typeof navigator !== "undefined" && !navigator.onLine
      ? offlineErrorFallback
      : query.error instanceof Error
        ? query.error.message
        : "この献立の対象家族の設定で確認できませんでした";
  // HR2: 生存 0 の 422 は phase=error のまま。code だけ公式 escape 判定に渡す。
  // ネットワーク失敗など generic Error は code 無し（retarget を開かない）。
  const errorCode =
    phase === "error" && query.error instanceof RevalidationApiError ? query.error.code : undefined;

  const refetch = useCallback(() => {
    // エラー画面の「もう一度確認」は hard と同型（操作再開前に閉じたゲートを取り直す）。
    // HR8: offline なら hold 維持・POST しない（beginHardRecheck と対称。
    // 無条件 clear + resetQueries だと sticky hold 契約が崩れ error/再 POST になる）。
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      beginOfflineHold();
      return;
    }
    requestGenerationRef.current += 1;
    setIsOfflineHold(false);
    setForcedChecking(true);
    void cache.cancelQueries({ queryKey, exact: true });
    return cache.resetQueries({ queryKey, exact: true });
  }, [beginOfflineHold, cache, queryKey]);

  // offline hold 中だけ true（online hard 開始で下ろす）。テスト注入互換のため phase と独立
  const offlineHoldActive = isOfflineHold && phase === "checking";

  return {
    ...query,
    phase,
    result: phase === "checked" ? query.data : undefined,
    errorMessage: phase === "error" ? errorMessage : undefined,
    errorCode,
    isSoftRechecking,
    /** HR1: offline hold 中。UI は shopping gate と同型の接続誘導を出す */
    isOfflineHold: offlineHoldActive,
    beginRecheck,
    beginSoftRecheck,
    beginHardRecheck,
    refetch,
  };
}
