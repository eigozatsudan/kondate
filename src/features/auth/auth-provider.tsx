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
  readAuthContinuationCompletion,
  startAuthContinuationCompletionListener,
} from "./auth-continuation-completion";
import { withTimeout } from "./async-timeout";
import { createAuthGateway } from "./auth-gateway";
import { clearSoftSessionResidualBestEffort } from "./auth-cleanup";
import {
  clearAuthFlow,
  clearBrowserSupabaseSessionStorage,
  listUnexpiredAuthFlows,
} from "./auth-flow";
import { resetAuthCallbackUrlCaptureIfLeftCallback } from "./auth-callback-url-capture";

/**
 * C-R1 / C2: 確立済み user の無言差し替えを抑止する session pin。
 *
 * C-R1: residual recovery 起動中〜後着 exchange の user 差し替え。
 * C2: residual 外 multi-tab callback 完了による last-writer clobber も同じ pin で拒否する。
 *
 * stop は in-flight `resumeFlow`/`exchangeCodeForSession` を abort できない（R2）。
 * unauthenticated `/login` で recovery が claim→exchange を開始した直後に別経路で session=A が
 * 確立すると cleanup→stop するが、後から settle した B の exchange が Supabase session を
 * 差し替え、`onAuthStateChange` の無条件 `setSession` で React 状態も B になる。
 *
 * 防衛:
 * - 最初に確立した session の user を pin する（residual arm 有無に依存しない — C2）
 * - pin 中に別 user が来たら setSession を捨て、可能なら pin token を復元する
 * - session null（logout / 失効）で解除。意図的なアカウント切替は一度 unauthenticated を経由する
 * - residual recovery 起動中は pin 前の first-writer も同様（C-R1）
 * - C-R2: multi-tab 別 account 並立は製品非対応。setSession 復元は cooldown + 窓上限で thrash を抑える
 */
type ResidualSessionGuard = {
  /** residual recovery 稼働中（first session 待ち含む） */
  armed: boolean;
  pinnedUserId: string | null;
  pinnedSession: Session | null;
  /** C-R2: 直近の pin 復元時刻（setSession thrash 抑制） */
  lastRestoreAtMs: number;
  /** C-R2: 復元回数窓の起点 */
  restoreWindowStartedAtMs: number;
  /** C-R2: 窓内の復元試行回数 */
  restoreCountInWindow: number;
};

/** C-R2: 連続 setSession 復元の最短間隔（ms） */
const PIN_RESTORE_COOLDOWN_MS = 2_000;
/** C-R2: 復元回数を数える窓（ms） */
const PIN_RESTORE_WINDOW_MS = 10_000;
/** C-R2: 窓内の最大 restore 試行（超過後は React pin のみ維持） */
const PIN_RESTORE_MAX_PER_WINDOW = 3;

function createResidualSessionGuard(): ResidualSessionGuard {
  return {
    armed: false,
    pinnedUserId: null,
    pinnedSession: null,
    lastRestoreAtMs: 0,
    restoreWindowStartedAtMs: 0,
    restoreCountInWindow: 0,
  };
}

function clearResidualSessionGuard(guard: ResidualSessionGuard): void {
  guard.armed = false;
  guard.pinnedUserId = null;
  guard.pinnedSession = null;
  guard.lastRestoreAtMs = 0;
  guard.restoreWindowStartedAtMs = 0;
  guard.restoreCountInWindow = 0;
}

/**
 * C-R2: pin 復元 setSession を発行してよいか。
 * multi-tab が互いに相手 user を弾いて setSession し合う thrash を有界にする。
 * React 状態の pin 一貫性は restore 有無に依存しない。
 */
function shouldAttemptPinSessionRestore(guard: ResidualSessionGuard, nowMs: number): boolean {
  if (nowMs - guard.lastRestoreAtMs < PIN_RESTORE_COOLDOWN_MS) return false;
  if (
    guard.restoreWindowStartedAtMs === 0 ||
    nowMs - guard.restoreWindowStartedAtMs > PIN_RESTORE_WINDOW_MS
  ) {
    guard.restoreWindowStartedAtMs = nowMs;
    guard.restoreCountInWindow = 0;
  }
  if (guard.restoreCountInWindow >= PIN_RESTORE_MAX_PER_WINDOW) return false;
  guard.restoreCountInWindow += 1;
  guard.lastRestoreAtMs = nowMs;
  return true;
}

/**
 * C2 / C-R1: pin 済み、または residual recovery arm 中はガード有効。
 * 旧 guardUntilMs は常時 pin（authenticated 中）に置き換え、callback 後着 clobber 窓を閉じる。
 */
function isSessionPinActive(guard: ResidualSessionGuard): boolean {
  return guard.pinnedUserId !== null || guard.armed;
}

/**
 * 認証待ち UI（login / callback）かどうか。
 * C16 / C14: completion 後の強制 navigate をこの path に限定し、設定編集中の未保存 UI を捨てない。
 */
function isAuthWaitingPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/auth/callback";
}

/**
 * C16 / C14 / C7 / C1: returnTo へ navigate してよいか。
 * - 認証待ち path 以外は session 再取得のみ（設定等の強制遷移を避ける）
 * - 待ち flow に flowId 一致があれば navigate（same-tab: clear 前 CustomEvent）
 * - waiting 空は secret 消去後の完了印拾いを許す
 * - C1 multi-flow: 勝者タブの publish は completion 書込→clear 後に他タブへ StorageEvent が届く。
 *   他 flow が残っていても、当該 flowId の完了印が読めるなら正当な完了として navigate する
 *   （残っている他 flow だけを見て抑止すると completion.returnTo を捨て URL returnTo に落ちる）。
 */
function shouldNavigateOnAuthComplete(flowId: string): boolean {
  if (!isAuthWaitingPath(window.location.pathname)) return false;
  const waiting = listUnexpiredAuthFlows(window.localStorage, new Date());
  if (waiting.some((flow) => flow.id === flowId)) return true;
  if (waiting.length === 0) return true;
  // multi-flow かつ当該 flow は clear 済み: 完了印が残っていれば cross-tab の正規順序
  return readAuthContinuationCompletion(flowId, window.localStorage) !== null;
}

export type AuthProviderClient = {
  auth: Pick<BrowserSupabaseClient["auth"], "getSession" | "onAuthStateChange"> & {
    /**
     * C-R1: 後着 residual exchange 差し替え時に勝者 session を復元する。
     * 本番 BrowserSupabaseClient は常に持つ。テスト注入は省略可（React 状態ガードのみ）。
     */
    setSession?: BrowserSupabaseClient["auth"]["setSession"];
  };
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
 * R1: AuthProvider は RouterProvider の外側にあり、SPA 遷移では remount も effect 再評価も起きない。
 * history パッチで拾えない path 変化の保険として、短周期で location.pathname を同期する。
 */
const AUTH_RECOVERY_PATH_SYNC_MS = 500;

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
 * - flow secret / completion は温存し、並行ログイン・recovery を優先する。
 * - soft 失効（別 effect）は pending-deposit / PKCE verifier を追加で消す（C3/C10）。cold-start は触らない。
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
  // R1: SPA path を recovery effect の deps に載せる。Router 外のため useLocation は使えない。
  const [locationPathname, setLocationPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  // 一度でも getSession 成功（error === null）したら true。SIGNED_OUT でも true のまま。
  const hasResolvedSessionOnce = useRef(false);
  // cold-start の壁時計起点（マウント時）。deadline 超過で fail-closed。
  const coldStartBeganAtMs = useRef<number | null>(null);
  // C5/C6: このタブで一度でも authenticated になったか。soft SIGNED_OUT 時の草稿掃除判定用。
  // cold-start 未ログイン（RR1）では false のまま → flow/pending を焼かない。
  const hadAuthenticatedSessionRef = useRef(false);
  // C-R1 / C2: residual recovery と multi-tab callback 後着の session 世代ガード
  const residualSessionGuardRef = useRef<ResidualSessionGuard>(createResidualSessionGuard());
  // C12: probe timeout 中は authenticated shell が stale になり得る。storage は焼かず UX のみ。
  const [sessionProbeDegraded, setSessionProbeDegraded] = useState(false);

  /**
   * C-R1 / C2: session 適用の単一入口。pin 済み / residual arm 中の別 user 差し替えを拒否する。
   * @returns 適用したか（false = 後着差し替えを抑止）
   */
  const applyAuthSession = useCallback(
    (nextSession: Session | null): boolean => {
      const guard = residualSessionGuardRef.current;
      if (nextSession === null) {
        clearResidualSessionGuard(guard);
        setSessionProbeDegraded(false);
        setSession(null);
        return true;
      }
      if (isSessionPinActive(guard)) {
        if (guard.pinnedUserId === null) {
          // residual recovery 起動後 or 初回確立: 最初の session を勝者として pin
          guard.pinnedUserId = nextSession.user.id;
          guard.pinnedSession = nextSession;
        } else if (nextSession.user.id !== guard.pinnedUserId) {
          // 後着 residual / multi-tab callback 等による無言差し替えを拒否（C-R1 / C2）
          // C-R2: 同一 user の pin token だけを restore。cooldown/上限で multi-tab thrash を抑える。
          // C-R7: restore 見送り（cap/cooldown）や setSession 失敗時は sessionProbeDegraded を立て、
          // React pin と共有 storage session の一時乖離を UI に最小通知する（タブ横断 pin 権威は非導入）。
          const pinned = guard.pinnedSession;
          const restore = client.auth.setSession;
          if (
            pinned !== null &&
            typeof restore === "function" &&
            typeof pinned.access_token === "string" &&
            typeof pinned.refresh_token === "string" &&
            pinned.access_token.length > 0 &&
            pinned.refresh_token.length > 0
          ) {
            if (shouldAttemptPinSessionRestore(guard, Date.now())) {
              // Supabase 内部 session も B に置換済みのことがあるため、勝者 token を best-effort で戻す
              void restore
                .call(client.auth, {
                  access_token: pinned.access_token,
                  refresh_token: pinned.refresh_token,
                })
                .then((result) => {
                  // setSession が error を返しても throw しない SDK 契約に備える
                  if (result.error !== null) {
                    setSessionProbeDegraded(true);
                  }
                })
                .catch(() => {
                  // 復元失敗でも React 状態は pin 維持。storage/Bearer 乖離を degraded で示す（C-R7）
                  setSessionProbeDegraded(true);
                });
            } else {
              // cooldown / 窓上限で restore を見送った: storage は相手 user のまま残り得る
              setSessionProbeDegraded(true);
            }
          }
          // React 状態は勝者のまま。B への setSession は行わない。
          return false;
        } else {
          // 同一 user の TOKEN_REFRESHED 等: pin を新しい token で更新
          guard.pinnedSession = nextSession;
        }
      } else {
        // pin 無しの初回 session（cold-start 等）
        guard.pinnedUserId = nextSession.user.id;
        guard.pinnedSession = nextSession;
      }
      setSessionProbeDegraded(false);
      setSession(nextSession);
      return true;
    },
    [client],
  );

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
        applyAuthSession(data.session);
        hasResolvedSessionOnce.current = true;
        setSessionProbeDegraded(false);
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
        applyAuthSession(null);
        setLoaded(true);
      }
    } catch {
      // C12: timeout / never-settle。storage は焼かず、authenticated なら degraded UX のみ。
      // 初回成功前は loading 継続。全体上限は deadline タイマーが担当。
      if (hasResolvedSessionOnce.current && residualSessionGuardRef.current.pinnedUserId !== null) {
        setSessionProbeDegraded(true);
      }
    }
  }, [applyAuthSession, client]);

  useEffect(() => {
    coldStartBeganAtMs.current = Date.now();
    void refreshSession();
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      applyAuthSession(nextSession);
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
      applyAuthSession(null);
      setLoaded(true);
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(retryTimer);
      window.clearTimeout(coldStartDeadlineTimer);
    };
  }, [applyAuthSession, client, refreshSession]);

  // C5/C6/C7: authenticated → unauthenticated（SIGNED_OUT / refresh 失効の getSession null 等）で
  // 共有端末に free-form 草稿・feedback fingerprint・session を残さない。
  // C7: flow secret / completion / callback-owner は温存（他タブ create 直後を unbound にしない）。
  // C3/C10: pending-deposit と PKCE verifier は soft でも消す（共有端末の code 残渣）。
  // 明示 logout / アカウント削除は clearLocalAuthAndDrafts（全所有キー）のまま。
  useEffect(() => {
    if (session !== null) {
      hadAuthenticatedSessionRef.current = true;
      return;
    }
    if (!loaded || !hadAuthenticatedSessionRef.current) return;
    hadAuthenticatedSessionRef.current = false;
    try {
      clearSoftSessionResidualBestEffort();
    } catch {
      // storage 障害でも UI の unauthenticated 遷移は続行
    }
  }, [session, loaded]);

  // R1: pathname を追跡し recovery の開始/停止条件を SPA 遷移でも再評価する。
  // React Router の pushState/replaceState は popstate を発火しないため history を包む。
  // 保険として短周期 re-check も行う（他経路の location 変更・取りこぼし用）。
  useEffect(() => {
    const syncPath = (): void => {
      const next = window.location.pathname;
      // C7: callback 外へ出たら capture sticky を解除（SPA soft-nav 再入場用）
      resetAuthCallbackUrlCaptureIfLeftCallback(next);
      setLocationPathname((prev) => (prev === next ? prev : next));
    };
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
      originalPushState(...args);
      syncPath();
    }) as History["pushState"];
    window.history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      originalReplaceState(...args);
      syncPath();
    }) as History["replaceState"];
    window.addEventListener("popstate", syncPath);
    const timer = window.setInterval(syncPath, AUTH_RECOVERY_PATH_SYNC_MS);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncPath);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const gateway = recoveryGateway ?? defaultRecoveryGateway;
    // locationPathname を deps に含め、/login で start 後の SPA 離脱でも cleanup→stop する（R1）。
    const path = locationPathname;
    if (gateway === undefined) return undefined;
    // /auth/callback は AuthCallbackPage の target recovery に委譲（二重 claim を避ける）。
    if (path === "/auth/callback") return undefined;
    // C1 / C2 / C6:
    // - residual recovery は認証待ち path（実質 /login）かつ unauthenticated + loaded のみ。
    // - authenticated の /login は LoginPage が即 Navigate するため recovery 不要。許可すると
    //   stop 後も abort できない in-flight exchange が onAuthStateChange 経由で無言差し替えする（C1/C6）。
    // - unauthenticated の /planner 等で recovery すると soft 失効後の他 flow residual が
    //   待機 UI 無しで complete し得る（C2）。completion listener が cross-tab 完了を拾う。
    // R1: 非待機 path へ SPA 離脱したら effect cleanup で stop。
    if (!isAuthWaitingPath(path)) return undefined;
    if (!loaded || session !== null) return undefined;
    const recoveryTtlMs =
      providedClient === undefined ? getPublicEnv().authContinuationTtlMs : 300_000;
    const storage = window.localStorage;
    // C-R1: residual recovery 起動で arm（first session 待ち）。C2 で pin は authenticated 中ずっと有効。
    const guard = residualSessionGuardRef.current;
    guard.armed = true;
    const stopRecovery = startRecovery({
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
    return () => {
      stopRecovery();
      const g = residualSessionGuardRef.current;
      // arm のみ解除。pin 済み（authenticated）なら C2 でそのまま別 user を拒否し続ける。
      g.armed = false;
      if (g.pinnedUserId === null) {
        clearResidualSessionGuard(g);
      }
    };
  }, [
    defaultRecoveryGateway,
    loaded,
    locationPathname,
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
      // C12: probe timeout 中。session オブジェクトは残り得るが API は fail-closed。
      sessionProbeDegraded,
    }),
    [loaded, refreshSession, session, sessionProbeDegraded],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
