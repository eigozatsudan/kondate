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
    onComplete: (result: { kind: "complete"; returnTo: string }) => void;
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
    if (recoveryGateway === undefined) return undefined;
    return startRecovery({
      gateway: recoveryGateway,
      storage: window.localStorage,
      ttlMs: getPublicEnv().authContinuationTtlMs,
      onComplete: () => void refreshSession(),
    });
  }, [recoveryGateway, refreshSession, startRecovery]);

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
