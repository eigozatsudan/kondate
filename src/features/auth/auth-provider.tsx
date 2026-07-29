import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
  const refreshSession = useCallback(async (): Promise<void> => {
    const { data, error } = await client.auth.getSession();
    // B-I6: getSession の一時エラーで直前 session を捨てない。
    // クリアは error === null かつ session === null、または SIGNED_OUT のみ。
    if (error === null) {
      setSession(data.session);
    }
    setLoaded(true);
  }, [client]);

  useEffect(() => {
    void refreshSession();
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoaded(true);
    });
    const onFocus = (): void => void refreshSession();
    window.addEventListener("focus", onFocus);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
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
