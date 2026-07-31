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
  const refreshSession = useCallback(async (): Promise<void> => {
    const { data, error } = await client.auth.getSession();
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
    }
  }, [client]);

  useEffect(() => {
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
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(retryTimer);
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
