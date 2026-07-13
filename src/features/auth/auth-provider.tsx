import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getPublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  startAuthContinuationRecovery,
  type AuthContinuationRecoveryGateway,
} from "./auth-continuation-recovery";
import {
  publishAuthContinuationCompletion,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import { createAuthGateway } from "./auth-gateway";

export type AuthContextValue = {
  status: "loading" | "authenticated" | "unauthenticated";
  session: Session | null;
  refreshSession(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export type AuthProviderClient = {
  auth: Pick<BrowserSupabaseClient["auth"], "getSession" | "onAuthStateChange">;
};

type AuthProviderProps = {
  children: ReactNode;
  client?: AuthProviderClient;
  recoveryGateway?: AuthContinuationRecoveryGateway;
  startRecovery?: (input: {
    gateway: AuthContinuationRecoveryGateway;
    storage: Storage;
    onComplete: (result: { kind: "complete"; flowId: string; returnTo: string }) => void;
    ttlMs: number;
  }) => () => void;
};

export function AuthProvider({
  children,
  client: providedClient,
  recoveryGateway,
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
    setSession(error === null ? data.session : null);
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
        publishAuthContinuationCompletion({ flowId: result.flowId, returnTo: result.returnTo });
        void refreshSession();
        if (result.returnTo.startsWith("/")) window.location.assign(result.returnTo);
      },
    });
  }, [defaultRecoveryGateway, providedClient, recoveryGateway, refreshSession, startRecovery]);

  useEffect(
    () =>
      startAuthContinuationCompletionListener({
        onComplete: (result) => {
          void refreshSession();
          window.location.assign(result.returnTo);
        },
      }),
    [refreshSession],
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

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("AuthProvider が必要です");
  return value;
}
