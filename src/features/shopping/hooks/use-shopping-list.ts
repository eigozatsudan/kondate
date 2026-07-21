import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import type {
  CurrentShoppingLabelWarning,
  ReconcileShoppingListRequest,
} from "@shared/contracts/shopping";
import {
  householdSafetyChangedEvent,
  householdSafetyQueryPrefixes,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  clearShoppingCommand,
  createShoppingList,
  fetchActiveShoppingList,
  pendingShoppingCommandEnvelopeSchema,
  pendingShoppingCommandStorageKey,
  pendingShoppingCommandTtlMs,
  reconcileShoppingListRequest,
  revalidateActiveShoppingList,
} from "../api/shopping-api";

export const shoppingKeys = {
  active: [...householdSafetyQueryPrefixes.shopping, "active"] as const,
};

export const useShoppingList = () =>
  useQuery({ queryKey: shoppingKeys.active, queryFn: fetchActiveShoppingList });

/**
 * 買い物リストの現行安全ゲート。ready 以外は全ての書き込み操作を止める。
 * リスト再取得だけでは決して ready に戻さず、サーバーの全ソース再検証が
 * valid を返したときだけ開く（fail closed）。
 */
export function useShoppingSafetyGate() {
  const cache = useQueryClient();
  const epoch = useRef(0);
  const [state, setState] = useState<
    | { phase: "checking" }
    | {
        phase: "ready";
        safetyFingerprint: string | null;
        currentLabelWarnings: readonly CurrentShoppingLabelWarning[];
      }
    | { phase: "blocked"; message: string }
  >({ phase: "checking" });
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    setState({ phase: "checking" });
    try {
      await cache.invalidateQueries({ queryKey: shoppingKeys.active, exact: true });
      const list = await cache.fetchQuery({
        queryKey: shoppingKeys.active,
        queryFn: fetchActiveShoppingList,
        staleTime: 0,
      });
      if (list === null) {
        if (epoch.current === current)
          setState({ phase: "ready", safetyFingerprint: null, currentLabelWarnings: [] });
        return;
      }
      const checked = await revalidateActiveShoppingList(list.id);
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
        });
    } catch {
      if (epoch.current === current)
        setState({ phase: "blocked", message: "現在の家族設定を確認できませんでした" });
    }
  }, [cache]);
  useEffect(() => {
    const changed = () => {
      void refresh();
    };
    const stored = (event: StorageEvent) => {
      if (event.key === householdSafetyRevisionStorageKey) void refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const offline = () => {
      epoch.current += 1;
      setState({ phase: "blocked", message: "ネット接続後に現在の家族設定を確認してください" });
    };
    window.addEventListener(householdSafetyChangedEvent, changed);
    window.addEventListener("storage", stored);
    window.addEventListener("focus", changed);
    window.addEventListener("online", changed);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    }, 60_000);
    const client = getBrowserSupabaseClient();
    let closed = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    // 所有者が取れない・購読できない場合は必ず閉じる（fail closed）。
    const subscribed = Promise.resolve()
      .then(() => client.auth.getUser())
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
              setState({ phase: "blocked", message: "現在の家族設定の更新を確認できませんでした" });
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
      if (channel !== null) void client.removeChannel(channel);
    };
  }, [refresh]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    blocked: state.phase !== "ready",
    checking: state.phase === "checking",
    error: state.phase === "blocked",
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
  return useMutation({
    mutationFn: createShoppingList,
    onSuccess: () => cache.invalidateQueries({ queryKey: shoppingKeys.active }),
    retry: retryLostResponse,
  });
}

export function useReconcileShoppingList() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, input }: { listId: string; input: ReconcileShoppingListRequest }) =>
      reconcileShoppingListRequest(listId, input),
    onSuccess: () => cache.invalidateQueries({ queryKey: shoppingKeys.active }),
    retry: retryLostResponse,
  });
}

export type ResumeShoppingCommandOptions<T> = {
  kind: "create" | "reconcile";
  targetId: string | null;
  schema: z.ZodType<T>;
  submit: (command: T) => Promise<void>;
};

/**
 * 送信済みかどうか分からない create / reconcile を、再読込・復帰・オンライン復帰の
 * いずれでも「同じバイト列・同じ idempotency key」で高々1本だけ再送する。
 * 成功（応答の parse と使用中リストの読み直し）が済むまで記録は消さない。
 */
export function useResumeShoppingCommand<T>({
  kind,
  targetId,
  schema,
  submit,
}: ResumeShoppingCommandOptions<T>) {
  const inFlight = useRef(false);
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const resume = useCallback(async () => {
    if (inFlight.current || targetId === null) return;
    const key = pendingShoppingCommandStorageKey(kind, targetId);
    const saved = sessionStorage.getItem(key);
    if (saved === null) return;
    // 壊れた記録・時計が巻き戻った記録・24時間超の記録は、送信する前に必ず捨てる。
    let command: T | null = null;
    try {
      const parsed = pendingShoppingCommandEnvelopeSchema(schema).safeParse(JSON.parse(saved));
      if (parsed.success) {
        const age = Date.now() - parsed.data.createdAtMs;
        if (age >= 0 && age <= pendingShoppingCommandTtlMs) command = parsed.data.command;
      }
    } catch {
      command = null;
    }
    if (command === null) {
      sessionStorage.removeItem(key);
      return;
    }
    inFlight.current = true;
    try {
      await submitRef.current(command);
    } finally {
      inFlight.current = false;
    }
  }, [kind, schema, targetId]);

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
