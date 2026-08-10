import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import { AuthContext, type AuthContextValue } from "./auth-context";
import {
  startAuthContinuationRecovery,
  type AuthContinuationRecoveryGateway,
  type RecoveryResult,
} from "./auth-continuation-recovery";
import {
  publishAuthContinuationCompletion,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import { withTimeout } from "./async-timeout";
import { createAuthGateway } from "./auth-gateway";
import { clearOwnedLocalDataBestEffort } from "./auth-cleanup";
import {
  clearAuthFlow,
  clearBrowserSupabaseSessionStorage,
  listUnexpiredAuthFlows,
} from "./auth-flow";

/**
 * 認証待ち UI（login / callback）かどうか。
 * C16 / C14: completion 後の強制 navigate をこの path に限定し、設定編集中の未保存 UI を捨てない。
 */
function isAuthWaitingPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/auth/callback";
}

/**
 * C16 / C14 / C7: returnTo へ navigate してよいか。
 * - 認証待ち path 以外は session 再取得のみ（設定等の強制遷移を避ける）
 * - 待ち flow があるときは flowId 一致時のみ（別 flow 完了・改ざん payload を拒否）
 * - waiting 空は secret 消去後の完了印拾いを許す（C12 と整合）
 */
function shouldNavigateOnAuthComplete(flowId: string): boolean {
  if (!isAuthWaitingPath(window.location.pathname)) return false;
  const waiting = listUnexpiredAuthFlows(window.localStorage, new Date());
  if (waiting.length > 0 && !waiting.some((flow) => flow.id === flowId)) {
    return false;
  }
  return true;
}

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
    onResult?: (result: RecoveryResult) => void;
    ttlMs: number;
  }) => () => void;
};

/** 初回 getSession 失敗時の再試行間隔（U1-I4）。短すぎると IDB ロックを悪化させない程度に。 */
const COLD_START_SESSION_RETRY_MS = 1_500;
/** 単発 getSession の hang 上限（C5）。never-settle でも再試行枠を空けられるようにする。 */
export const COLD_START_GET_SESSION_TIMEOUT_MS = 5_000;
/** cold-start 全体の fail-closed 上限。超えたら未ログイン扱いで UI を解放する（C5）。 */
export const COLD_START_SESSION_DEADLINE_MS = 15_000;

/**
 * C5 / RR1: cold-start deadline で UI を unauthenticated にするとき、**session 永続キーのみ**消す。
 *
 * C5 の目的（「未ログイン UI + 端末に refresh 残存 → focus で復活」）は session キー削除で足りる。
 * 旧 clearOwnedAuthStorage は flow secret / pending-deposit / callback-owner まで origin 共有領域から
 * 一掃し、他タブの進行中 OAuth を unbound にした（RR1）。
 *
 * Tradeoff（意図的）:
 * - session キー自体は origin 共有のため、このタブの fail-closed で他タブの persist token も消える。
 *   他タブはメモリ上 session が残る間は動き得るが、reload 後は再ログインが必要になり得る。
 * - flow secret / pending-deposit / completion は温存し、並行ログイン・recovery を優先する。
 * - signOut は getSession hang と同系で固着し得るため storage のみ同期 clear（best-effort）。
 * - 明示 logout は auth-cleanup 経由の clearOwnedAuthStorage（全所有キー）のまま。
 */
function clearPersistedAuthOnColdStartFailClosed(): void {
  if (typeof window === "undefined") return;
  try {
    clearBrowserSupabaseSessionStorage(window.localStorage);
  } catch {
    // storage 障害でも UI 解放は続行
  }
  try {
    clearBrowserSupabaseSessionStorage(window.sessionStorage);
  } catch {
    // 同上
  }
}

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
  // C5/C6: このタブで一度でも authenticated になったか。soft SIGNED_OUT 時の草稿掃除判定用。
  // cold-start 未ログイン（RR1）では false のまま → flow/pending を焼かない。
  const hadAuthenticatedSessionRef = useRef(false);
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
        clearPersistedAuthOnColdStartFailClosed();
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
    // persist token も同期 clear し、focus 復活で「いつの間にかログイン」を防ぐ
    const coldStartDeadlineTimer = window.setTimeout(() => {
      if (hasResolvedSessionOnce.current) return;
      clearPersistedAuthOnColdStartFailClosed();
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

  // C5/C6: authenticated → unauthenticated（SIGNED_OUT / refresh 失効の getSession null 等）で
  // 共有端末に free-form 草稿・feedback fingerprint・auth residual を残さない。
  // 明示 logout / redirectToLoginForExpiredSession と同系の owned 一掃を中央で best-effort 実行する。
  // cold-start 未ログイン fail-closed（RR1: session キーのみ）とは区別し、hadAuthenticated 時だけ走らせる。
  useEffect(() => {
    if (session !== null) {
      hadAuthenticatedSessionRef.current = true;
      return;
    }
    if (!loaded || !hadAuthenticatedSessionRef.current) return;
    hadAuthenticatedSessionRef.current = false;
    try {
      clearOwnedLocalDataBestEffort();
    } catch {
      // storage 障害でも UI の unauthenticated 遷移は続行
    }
  }, [session, loaded]);

  useEffect(() => {
    const gateway = recoveryGateway ?? defaultRecoveryGateway;
    if (gateway === undefined || window.location.pathname === "/auth/callback") return undefined;
    const path = window.location.pathname;
    const authWaiting = isAuthWaitingPath(path);
    // C1: 既に authenticated かつ認証待ち path 以外では residual flow の background claim/exchange を抑止する。
    // multi-flow 併存（旧 secret を焼かない C6）は維持しつつ、別アカウント code による静かな session 差し替えを防ぐ。
    // loading 中は既 session 有無が未確定のため、認証待ち path 以外では recovery を開始しない。
    // 明示 re-login（/login）中は authenticated / loading でも recovery を許可する。
    if (!authWaiting && (!loaded || session !== null)) return undefined;
    const recoveryTtlMs =
      providedClient === undefined ? getPublicEnv().authContinuationTtlMs : 300_000;
    const storage = window.localStorage;
    return startRecovery({
      gateway,
      storage,
      ttlMs: recoveryTtlMs,
      onComplete: (result) => {
        publishCompletionSafely({ flowId: result.flowId, returnTo: result.returnTo });
        void refreshSession();
        // C14 / C1: completion listener（C16）と同型の path / waiting ガード。
        // 設定編集中などでの強制 navigate を避ける。
        if (result.returnTo.startsWith("/") && shouldNavigateOnAuthComplete(result.flowId)) {
          navigateTo(result.returnTo);
        }
      },
      // C4: AuthCallbackPage の onResult→failClosed と同型。terminal 結果で当該 flow を焼く
      // （resumeFlow 側 clear の二重化。flowId 無しの error は gateway クリアに委ねる）。
      onResult: (result) => {
        if (result.kind !== "error" && result.kind !== "expired") return;
        if (result.flowId === undefined) return;
        try {
          clearAuthFlow(result.flowId, storage);
        } catch {
          // storage 障害は次周期の list 失敗で自然停止する
        }
      },
    });
  }, [
    defaultRecoveryGateway,
    loaded,
    navigateTo,
    providedClient,
    recoveryGateway,
    refreshSession,
    session,
    startRecovery,
  ]);

  useEffect(
    () =>
      startAuthContinuationCompletionListener({
        onComplete: (result) => {
          void refreshSession();
          // C16: 認証待ち画面のタブだけ returnTo へ遷移する。
          // 設定編集中などの他タブを強制 navigate して未保存 UI を捨てない。
          // C7: 端末に待ち flow があるときは flowId 一致時のみ navigate。
          if (shouldNavigateOnAuthComplete(result.flowId)) {
            navigateTo(result.returnTo);
          }
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
