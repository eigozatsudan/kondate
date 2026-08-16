import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type {
  CurrentShoppingLabelWarning,
  ReconcileShoppingListRequest,
} from "@shared/contracts/shopping";
import { useAuth } from "@/features/auth/use-auth";
import {
  assertBrowserDataPlaneAligned,
  isAccessTokenPinDataPlaneBlocked,
} from "@/features/auth/session";
import {
  householdSafetyChangedEvent,
  householdSafetyQueryPrefixes,
  isHouseholdSafetyRevisionStorageKeyForUser,
  subscribeHouseholdSafetyBroadcast,
} from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  clearShoppingCommand,
  createShoppingList,
  fetchActiveShoppingList,
  readPendingShoppingCommand,
  reconcileShoppingListRequest,
  revalidateActiveShoppingList,
} from "../api/shopping-api";
import { isShoppingResumeSuppressed } from "../shopping-intent";

/** 買い物クエリは所有者 ID で名前空間化し、ユーザー切替時の stale キャッシュ混入を防ぐ。 */
export const shoppingKeys = {
  active: (userId: string) => [...householdSafetyQueryPrefixes.shopping, "active", userId] as const,
  reconcileTarget: (userId: string, menuId: string, listId: string) =>
    [...householdSafetyQueryPrefixes.shopping, "reconcile-target", userId, menuId, listId] as const,
};

export const useShoppingList = () => {
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: shoppingKeys.active(userId ?? "missing"),
    queryFn: fetchActiveShoppingList,
    enabled: userId !== undefined && userId.length > 0,
  });
};

/**
 * 買い物リストの現行安全ゲート。ready 以外は全ての書き込み操作を止める。
 * リスト再取得だけでは決して ready に戻さず、サーバーの全ソース再検証が
 * valid を返したときだけ開く（fail closed）。
 */
export function useShoppingSafetyGate() {
  const cache = useQueryClient();
  const userId = useAuth().session?.user.id;
  const epoch = useRef(0);
  const [state, setState] = useState<
    | { phase: "checking" }
    | {
        phase: "ready";
        safetyFingerprint: string | null;
        currentLabelWarnings: readonly CurrentShoppingLabelWarning[];
      }
    | { phase: "blocked"; message: string; cause: "invalid" | "temporary" }
  >({ phase: "checking" });
  const applyChecked = useCallback(
    (
      current: number,
      checked: {
        status: string;
        safetyFingerprint: string | null;
        currentLabelWarnings: readonly CurrentShoppingLabelWarning[];
        issues: readonly { message: string }[];
      },
    ) => {
      if (epoch.current !== current) return;
      if (checked.status === "valid")
        setState({
          phase: "ready",
          safetyFingerprint: checked.safetyFingerprint,
          currentLabelWarnings: checked.currentLabelWarnings,
        });
      else
        setState({
          phase: "blocked",
          message: checked.issues.map((issue) => issue.message).join("。"),
          // 再検証が status!==valid（invalid / unverifiable）で閉じたときだけ
          // 真の list invalid。offline / catch 503 とは分ける（SHOP-R1）。
          cause: "invalid",
        });
    },
    [],
  );
  /** hard: 操作を閉じてから再検証。家族変更・offline 復帰・初回。 */
  const refresh = useCallback(async () => {
    const ownerId = userId ?? "missing";
    const current = ++epoch.current;
    setState({ phase: "checking" });
    try {
      await cache.invalidateQueries({ queryKey: shoppingKeys.active(ownerId), exact: true });
      const list = await cache.fetchQuery({
        queryKey: shoppingKeys.active(ownerId),
        queryFn: fetchActiveShoppingList,
        staleTime: 0,
      });
      if (list === null) {
        if (epoch.current === current)
          setState({ phase: "ready", safetyFingerprint: null, currentLabelWarnings: [] });
        return;
      }
      const checked = await revalidateActiveShoppingList(list.id);
      applyChecked(current, checked);
    } catch {
      if (epoch.current === current)
        setState({
          phase: "blocked",
          message: "現在の家族設定を確認できませんでした",
          cause: "temporary",
        });
    }
  }, [applyChecked, cache, userId]);
  /**
   * SHOP6 soft: ready 中の poll は UI を checking に落とさず裏で再検証する。
   * invalid / 通信失敗だけ blocked へ。Realtime 欠落後の窓を poll で閉じる。
   * SHOP4: hard と同じ epoch の裏 valid で blocked/checking を ready に戻さない。
   */
  const softRefresh = useCallback(async () => {
    const ownerId = userId ?? "missing";
    const current = epoch.current;
    try {
      const list = await cache.fetchQuery({
        queryKey: shoppingKeys.active(ownerId),
        queryFn: fetchActiveShoppingList,
        staleTime: 0,
      });
      if (list === null) return;
      const checked = await revalidateActiveShoppingList(list.id);
      if (epoch.current !== current) return;
      if (checked.status === "valid") {
        setState((prev) => {
          if (prev.phase !== "ready") return prev;
          return {
            phase: "ready",
            safetyFingerprint: checked.safetyFingerprint,
            currentLabelWarnings: checked.currentLabelWarnings,
          };
        });
        return;
      }
      applyChecked(current, checked);
    } catch {
      if (epoch.current === current)
        setState({
          phase: "blocked",
          message: "現在の家族設定を確認できませんでした",
          cause: "temporary",
        });
    }
  }, [applyChecked, cache, userId]);
  useEffect(() => {
    const changed = () => {
      void refresh();
    };
    const stored = (event: StorageEvent) => {
      // H12: 自 user の revision（+ レガシー固定キー）だけを受理し、他アカウントの誤 refresh を防ぐ
      if (userId !== undefined && isHouseholdSafetyRevisionStorageKeyForUser(event.key, userId)) {
        void refresh();
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const offline = () => {
      epoch.current += 1;
      setState({
        phase: "blocked",
        message: "ネット接続後に現在の家族設定を確認してください",
        cause: "temporary",
      });
    };
    window.addEventListener(householdSafetyChangedEvent, changed);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", changed);
    window.addEventListener("online", changed);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    // H-R3: setItem 失敗時の cross-tab hard を BroadcastChannel で補う
    const unsubscribeBroadcast =
      userId !== undefined && userId.length > 0
        ? subscribeHouseholdSafetyBroadcast(userId, changed)
        : () => {};
    const poll = window.setInterval(() => {
      // SHOP6: poll は soft（ready 維持）。hard は focus/Realtime/household 側。
      if (document.visibilityState === "visible" && navigator.onLine) void softRefresh();
    }, 60_000);
    const client = getBrowserSupabaseClient();
    let closed = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    // 所有者が取れない・購読できない場合は必ず閉じる（fail closed）。
    // R1: pin 乖離中は getUser()=B で Realtime を B に購読しない
    const subscribed = Promise.resolve()
      .then(async () => {
        if (isAccessTokenPinDataPlaneBlocked()) {
          throw new Error("auth_session_pin_mismatch");
        }
        await assertBrowserDataPlaneAligned(client);
        return client.auth.getUser();
      })
      .then((response) => {
        if (closed) return;
        if (response.error !== null) {
          offline();
          return;
        }
        const ownerId = response.data.user.id;
        const filter = `user_id=eq.${ownerId}`;
        channel = client
          .channel(`shopping-safety:${ownerId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "household_members", filter },
            changed,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "member_allergies", filter },
            changed,
          )
          .subscribe((status) => {
            // Realtime の購読状態は文字列として比較する（テストからも素の文字列が届く）。
            const state: string = status;
            if (state === "SUBSCRIBED") void refresh();
            if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              epoch.current += 1;
              setState({
                phase: "blocked",
                message: "現在の家族設定の更新を確認できませんでした",
                cause: "temporary",
              });
            }
          });
      })
      .catch(() => {
        if (!closed) offline();
      });
    void subscribed;
    return () => {
      closed = true;
      window.clearInterval(poll);
      window.removeEventListener(householdSafetyChangedEvent, changed);
      window.removeEventListener("storage", stored);
      window.removeEventListener("focus", changed);
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      unsubscribeBroadcast();
      if (channel !== null) void client.removeChannel(channel);
    };
  }, [refresh, softRefresh, userId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    blocked: state.phase !== "ready",
    checking: state.phase === "checking",
    error: state.phase === "blocked",
    // 再検証が status!==valid のときだけ true。offline / 一時 503 /
    // CHANNEL_ERROR の blocked は error=true のまま false（SHOP-R1）。
    invalid: state.phase === "blocked" && state.cause === "invalid",
    message: state.phase === "blocked" ? state.message : null,
    safetyFingerprint: state.phase === "ready" ? state.safetyFingerprint : null,
    currentLabelWarnings: state.phase === "ready" ? state.currentLabelWarnings : [],
    refresh,
  };
}

/** HTTP/ドメインエラー（code 付き）は自動再送しない。取り逃した応答だけ1回だけ再送する。 */
const retryLostResponse = (failureCount: number, error: unknown) =>
  failureCount < 1 && !(error instanceof Error && "code" in error);

export function useCreateShoppingList() {
  const cache = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: createShoppingList,
    onSuccess: () => {
      if (userId === undefined) return;
      void cache.invalidateQueries({ queryKey: shoppingKeys.active(userId) });
    },
    retry: retryLostResponse,
  });
}

export function useReconcileShoppingList() {
  const cache = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: ({ listId, input }: { listId: string; input: ReconcileShoppingListRequest }) =>
      reconcileShoppingListRequest(listId, input),
    onSuccess: () => {
      if (userId === undefined) return;
      void cache.invalidateQueries({ queryKey: shoppingKeys.active(userId) });
    },
    retry: retryLostResponse,
  });
}

export type ResumeShoppingCommandOptions<T> = {
  kind: "create" | "reconcile";
  targetId: string | null;
  schema: z.ZodType<T>;
  submit: (command: T) => Promise<void>;
  /**
   * false のとき resume しない（献立 revalidation soft/checking など）。
   * pending は残し、true に戻った effect で再試行する（HR9）。
   * 省略時は true（従来どおり mount/focus/online で送る）。
   */
  enabled?: boolean;
};

/** SHOP8: 同一 kind+target の resume POST をタブ間で直列化する Web Locks 名 */
export const shoppingResumeClaimLockName = (kind: "create" | "reconcile", targetId: string) =>
  `kondate:shopping:resume:${kind}:${targetId}`;

/**
 * 送信済みかどうか分からない create / reconcile を、再読込・復帰・オンライン復帰の
 * いずれでも「同じバイト列・同じ idempotency key」で高々1本だけ再送する。
 * 成功（応答の parse と使用中リストの読み直し）が済むまで記録は消さない。
 * enabled=false のあいだは送信せず pending を保持する（safety gate と dual-gate）。
 * SHOP8: 同一 sticky の multi-tab 並行 resume は Web Locks で直列化し、
 * finish/fail/navigate の競合を抑える（サーバ冪等は維持、クライアント UX を安定化）。
 */
export function useResumeShoppingCommand<T>({
  kind,
  targetId,
  schema,
  submit,
  enabled = true,
}: ResumeShoppingCommandOptions<T>) {
  const inFlight = useRef(false);
  const submitRef = useRef(submit);
  // enabled も ref で保持し、ロック待ち後に最新値を再確認する（クロージャ固定値では再確認にならない）。
  const enabledRef = useRef(enabled);
  // 描画中に ref を書き換えない（破棄される並行描画でも書き換わってしまうため）。
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const resume = useCallback(async () => {
    // HR9: actionsEnabled 等が false のときは送らず pending を残す
    if (!enabled || inFlight.current || targetId === null) return;
    const run = async (): Promise<void> => {
      // ロック取得後にも enabled / sticky を再確認（待ち行列中の無効化・clear に追従）
      if (!enabledRef.current) return;
      // SHOP2 (adversarial): Tab A の suppress 書き込みでは mount 済み Tab B は
      // re-render しない。focus/online の resume はクロージャの enabled ではなく
      // localStorage 正本を再読し、立っていれば旧 sticky を POST しない。
      if (isShoppingResumeSuppressed(kind, targetId)) return;
      // SHOP3: local 正本を先に読む（他タブの失応答 sticky も同じ key で再送）。
      // 壊れた / TTL 超過 / 時計巻き戻しは read 側で当該 Storage から掃除済み。
      const command = readPendingShoppingCommand(kind, targetId, schema);
      if (command === null) return;
      await submitRef.current(command);
    };
    inFlight.current = true;
    try {
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (locks !== undefined && typeof locks.request === "function") {
        await locks.request(shoppingResumeClaimLockName(kind, targetId), () => run());
      } else {
        await run();
      }
    } finally {
      inFlight.current = false;
    }
  }, [enabled, kind, schema, targetId]);

  useEffect(() => {
    const online = () => {
      void resume();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void resume();
    };
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    document.addEventListener("visibilitychange", visible);
    void resume();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("focus", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [resume]);

  return {
    clear: () => {
      if (targetId !== null) clearShoppingCommand(kind, targetId);
    },
  };
}
