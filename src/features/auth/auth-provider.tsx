import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import { AuthContext, type AuthContextValue } from "./auth-context";
import {
  startAuthContinuationRecovery,
  type AuthContinuationRecoveryGateway,
} from "./auth-continuation-recovery";
import {
  publishAuthContinuationCompletion,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import { withTimeout } from "./async-timeout";
import { createAuthGateway } from "./auth-gateway";

export type AuthProviderClient = {
  auth: Pick<BrowserSupabaseClient["auth"], "getSession" | "onAuthStateChange">;
};

type AuthProviderProps = {
  children: ReactNode;
  client?: AuthProviderClient;
  recoveryGateway?: AuthContinuationRecoveryGateway;
  navigateTo?: (returnTo: string) => void;
  startRecovery?: (input: {
    gateway: AuthContinuationRecoveryGateway;
    storage: Storage;
    onComplete: (result: { kind: "complete"; flowId: string; returnTo: string }) => void;
    ttlMs: number;
  }) => () => void;
};

/** 初回 getSession 失敗時の再試行間隔（U1-I4）。短すぎると IDB ロックを悪化させない程度に。 */
const COLD_START_SESSION_RETRY_MS = 1_500;
/** 単発 getSession の hang 上限（C5）。never-settle でも再試行枠を空けられるようにする。 */
export const COLD_START_GET_SESSION_TIMEOUT_MS = 5_000;
/** cold-start 全体の fail-closed 上限。超えたら未ログイン扱いで UI を解放する（C5）。 */
export const COLD_START_SESSION_DEADLINE_MS = 15_000;

function publishCompletionSafely(completion: { flowId: string; returnTo: string }): void {
  try {
    publishAuthContinuationCompletion(completion);
  } catch {
    // session確立後のlocalStorage障害はrefreshと遷移を妨げず、例外内容も外へ出さない。
  }
}

function navigateToReturnPath(returnTo: string): void {
  window.location.assign(returnTo);
}

export function AuthProvider({
  children,
  client: providedClient,
  recoveryGateway,
  navigateTo = navigateToReturnPath,
  startRecovery = startAuthContinuationRecovery,
}: AuthProviderProps) {
  const client = providedClient ?? getBrowserSupabaseClient();
  const [defaultRecoveryGateway] = useState(() =>
    providedClient === undefined ? createAuthGateway(getBrowserSupabaseClient()) : undefined,
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 一度でも getSession 成功（error === null）したら true。SIGNED_OUT でも true のまま。
  const hasResolvedSessionOnce = useRef(false);
  // cold-start の壁時計起点（マウント時）。deadline 超過で fail-closed。
  const coldStartBeganAtMs = useRef<number | null>(null);
  const refreshSession = useCallback(async (): Promise<void> => {
    const beganAt = coldStartBeganAtMs.current ?? Date.now();
    coldStartBeganAtMs.current = beganAt;
    try {
      const { data, error } = await withTimeout(
        client.auth.getSession(),
        COLD_START_GET_SESSION_TIMEOUT_MS,
      );
      // B-I6: getSession の一時エラーで直前 session を捨てない。
      // クリアは error === null かつ session === null、または SIGNED_OUT のみ。
      if (error === null) {
        setSession(data.session);
        hasResolvedSessionOnce.current = true;
        setLoaded(true);
        return;
      }
      // U1-I4: 初回成功前の一時エラーは loaded=true にしない（loading のまま再試行）。
      // 成功後の focus 再試行失敗は B-I6 どおり session 維持 + loaded 維持。
      if (hasResolvedSessionOnce.current) {
        setLoaded(true);
        return;
      }
      // 一時エラーの累積も cold-start deadline で fail-closed（C5）
      if (Date.now() - beganAt >= COLD_START_SESSION_DEADLINE_MS) {
        setSession(null);
        setLoaded(true);
      }
    } catch {
      // timeout / never-settle: 初回成功前は loading 継続。全体上限は deadline タイマーが担当。
    }
  }, [client]);

  useEffect(() => {
    coldStartBeganAtMs.current = Date.now();
    void refreshSession();
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      hasResolvedSessionOnce.current = true;
      setLoaded(true);
    });
    const onFocus = (): void => void refreshSession();
    window.addEventListener("focus", onFocus);
    // 初回 getSession が一時失敗したまま loading で固まらないよう、未解決中だけ再試行する
    const retryTimer = window.setInterval(() => {
      if (!hasResolvedSessionOnce.current) void refreshSession();
    }, COLD_START_SESSION_RETRY_MS);
    // C5: hang/一時失敗の再試行を打ち切り、未ログインとして UI を解放する全体上限
    const coldStartDeadlineTimer = window.setTimeout(() => {
      if (hasResolvedSessionOnce.current) return;
      setSession(null);
      setLoaded(true);
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(retryTimer);
      window.clearTimeout(coldStartDeadlineTimer);
    };
  }, [client, refreshSession]);

  useEffect(() => {
    const gateway = recoveryGateway ?? defaultRecoveryGateway;
    if (gateway === undefined || window.location.pathname === "/auth/callback") return undefined;
    return startRecovery({
      gateway,
      storage: window.localStorage,
      ttlMs: providedClient === undefined ? getPublicEnv().authContinuationTtlMs : 300_000,
      onComplete: (result) => {
        publishCompletionSafely({ flowId: result.flowId, returnTo: result.returnTo });
        void refreshSession();
        if (result.returnTo.startsWith("/")) navigateTo(result.returnTo);
      },
    });
  }, [
    defaultRecoveryGateway,
    navigateTo,
    providedClient,
    recoveryGateway,
    refreshSession,
    startRecovery,
  ]);

  useEffect(
    () =>
      startAuthContinuationCompletionListener({
        onComplete: (result) => {
          void refreshSession();
          navigateTo(result.returnTo);
        },
      }),
    [navigateTo, refreshSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: !loaded ? "loading" : session === null ? "unauthenticated" : "authenticated",
      session,
      refreshSession,
    }),
    [loaded, refreshSession, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
