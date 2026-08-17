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
import {
  clearSoftResidualRecoverySuppressed,
  clearSoftSessionResidualBestEffort,
  isSoftResidualRecoverySuppressed,
  markSoftResidualRecoverySuppressed,
  SIGN_OUT_TIMEOUT_MS,
} from "./auth-cleanup";
import { SOFT_RESIDUAL_RECOVERY_REARM_EVENT } from "./soft-residual-recovery-suppress";
import {
  browserSupabaseSessionStorageKey,
  clearActiveLoginFlowId,
  clearAuthFlow,
  clearBrowserSupabaseSessionStorage,
  listUnexpiredAuthFlows,
  readActiveLoginFlowId,
  startAuthFlowDismissBroadcastListener,
} from "./auth-flow";
import { resetAuthCallbackUrlCaptureIfLeftCallback } from "./auth-callback-url-capture";
import {
  liveAuthSessionMarkProtectsFingerprint,
  readLiveAuthSessionMark,
  shouldCommitLiveAuthSessionMark,
  shouldRefuseUnmarkedLeftoverFirstPin,
  writeLiveAuthSessionMark,
} from "./live-auth-session-mark";
import { setAccessTokenPinDataPlaneBlocked, setAccessTokenPinnedUserId } from "./session";

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
 * leftover の access_token を hard / soft いずれかの集合へ入れる。
 * 照合は token のみ（同一 user の正規 B を落とさない）。トークン文字列はログしない。
 * 空は識別不能なので無視する。login-era の世代ずれは呼び出し側で捨てるだけでここへ来ない（C18）。
 */
function rememberAccessToken(bucket: Set<string>, nextSession: Session | null): void {
  if (nextSession === null) return;
  const token = nextSession.access_token;
  if (typeof token === "string" && token.length > 0) {
    bucket.add(token);
  }
}

function hasAccessToken(bucket: Set<string>, nextSession: Session): boolean {
  const token = nextSession.access_token;
  return typeof token === "string" && token.length > 0 && bucket.has(token);
}

/** C31: persist 由来と観測 leftover のどちらでも hard 拒否する。 */
function hasHardLeftoverAccessToken(
  observed: Set<string>,
  persistSeeded: Set<string>,
  nextSession: Session,
): boolean {
  return hasAccessToken(observed, nextSession) || hasAccessToken(persistSeeded, nextSession);
}

function leftoverSetsNonEmpty(hard: Set<string>, soft: Set<string>): boolean {
  return hard.size > 0 || soft.size > 0;
}

/**
 * fail-closed local signOut の結果が失敗か。
 * `{ error: null }` / void は成功。timeout は呼び出し側の catch。
 */
function isFailedAuthSignOutResult(result: unknown): boolean {
  if (typeof result !== "object" || result === null || !("error" in result)) {
    return false;
  }
  return result.error != null;
}

function readAccessToken(nextSession: Session | null): string | null {
  if (nextSession === null) return null;
  const token = nextSession.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * persist JSON から access_token を読める範囲で取り出す。
 * 形が違えば null。トークン文字列はログしない。
 */
function readPersistedAccessTokenFromUnknown(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("access_token" in value)) {
    return null;
  }
  const token = value.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** leftover persist が origin 共有キーに残っているか。印なし first pin 拒否の入力。 */
function hasPersistedBrowserSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(browserSupabaseSessionStorageKey);
    return raw !== null && raw !== "";
  } catch {
    return false;
  }
}

/**
 * C31: persist clear 前に local / session の session キーから leftover token を hard へ入れる。
 * parse 失敗は無視する。トークンはログしない。
 * leftoverSetsNonEmpty 用の観測 leftover とは分ける（C23 / C24 の空集合判定を壊さない）。
 */
function rememberPersistedAccessTokensAsHardLeftover(bucket: Set<string>): void {
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage.getItem(browserSupabaseSessionStorageKey);
      if (raw === null || raw === "") continue;
      const parsed: unknown = JSON.parse(raw);
      const token = readPersistedAccessTokenFromUnknown(parsed);
      if (token !== null) {
        bucket.add(token);
      }
    } catch {
      // parse / storage 障害は無視
    }
  }
}

/**
 * C16–C18: fail-closed 境界より前に始まった probe が stale-era。
 * failClosedGeneration は deadline で上げた sessionProbeGeneration。
 * `<` を使う（上げた境界そのものは re-arm 後の login-era。re-arm では世代を上げない）。
 */
function isStaleEraProbe(probeGeneration: number, failClosedGeneration: number): boolean {
  return failClosedGeneration >= 0 && probeGeneration < failClosedGeneration;
}

type PendingRawSessionProbe = {
  generation: number;
};

function hasPendingStaleEraRawProbe(
  probes: readonly PendingRawSessionProbe[],
  failClosedGeneration: number,
): boolean {
  return probes.some((probe) => isStaleEraProbe(probe.generation, failClosedGeneration));
}

function releasePendingRawSessionProbe(
  probes: PendingRawSessionProbe[],
  probe: PendingRawSessionProbe,
): void {
  const index = probes.indexOf(probe);
  if (index !== -1) {
    probes.splice(index, 1);
  }
}

/**
 * 認証待ち UI（login / callback）かどうか。
 * C16 / C14: completion 後の強制 navigate をこの path に限定し、設定編集中の未保存 UI を捨てない。
 */
function isAuthWaitingPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname === "/auth/callback";
}

/**
 * C16 / C14 / C7 / C1 / C8: returnTo へ navigate してよいか。
 * - 認証待ち path 以外は session 再取得のみ（設定等の強制遷移を避ける）
 * - 待ち flow に flowId 一致があれば navigate（same-tab: clear 前 CustomEvent）
 * - C1 multi-flow: 勝者タブの publish は completion 書込→clear 後に他タブへ StorageEvent が届く。
 *   他 flow が残っていても、当該 flowId の完了印が読めるなら正当な完了として navigate する
 *   （残っている他 flow だけを見て抑止すると completion.returnTo を捨て URL returnTo に落ちる）。
 * - C8: waiting 空の idle /login は foreign/stale completion だけでは navigate しない。
 *   residual recovery 等このタブ所有の完了（ownedByThisTab）のみ許可する。
 *   same-tab CustomEvent は publish が clear 前に配送するため flowId 一致で拾える。
 */
function shouldNavigateOnAuthComplete(
  flowId: string,
  options?: { ownedByThisTab?: boolean },
): boolean {
  if (!isAuthWaitingPath(window.location.pathname)) return false;
  const waiting = listUnexpiredAuthFlows(window.localStorage, new Date());
  if (waiting.some((flow) => flow.id === flowId)) return true;
  if (waiting.length > 0) {
    // multi-flow かつ当該 flow は clear 済み: 完了印が残っていれば cross-tab の正規順序
    return readAuthContinuationCompletion(flowId, window.localStorage) !== null;
  }
  // waiting 空: このタブが完了を所有している場合のみ（idle yank を閉じる）
  return options?.ownedByThisTab === true;
}

export type AuthProviderClient = {
  auth: Pick<BrowserSupabaseClient["auth"], "getSession" | "onAuthStateChange"> & {
    /**
     * C-R1: 後着 residual exchange 差し替え時に勝者 session を復元する。
     * 本番 BrowserSupabaseClient は常に持つ。テスト注入は省略可（React 状態ガードのみ）。
     */
    setSession?: BrowserSupabaseClient["auth"]["setSession"];
    /**
     * R1: pin 不一致時に共有 client の B JWT を落とし PostgREST/RPC の cross-user を閉じる。
     * 省略時は session 永続キーの同期 clear にフォールバック。
     */
    signOut?: BrowserSupabaseClient["auth"]["signOut"];
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
    /** C12: callback タブ専用。owner 必須の target recovery（residual は付けない） */
    targetFlowId?: string;
    /**
     * C2/C12: residual が今開始した flow だけを claimable にする。
     * targetFlowId とは別。無ければ従来どおり全件。
     */
    restrictToFlowId?: string;
    ttlMs: number;
  }) => () => void;
};

/** 初回 getSession 失敗時の再試行間隔（U1-I4）。短すぎると IDB ロックを悪化させない程度に。 */
export const COLD_START_SESSION_RETRY_MS = 1_500;
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
 * - local `signOut({ scope: "local" })` を UI 解放のあと fire-and-forget で打つ（C26 / C27 / C29）。
 *   hang は SIGN_OUT_TIMEOUT_MS。完了は待たない。global は打たない。C5 の
 *   clearExpiredSessionAuthAndDrafts は使わない（soft residual / suppress が RR1 を壊す）。
 * - signOut 成功時だけ SDK 空とみなし、login-era leftover pending（C26）と空 leftover の C23（C28）を外す。
 *   timeout / 失敗 / signOut 無しは現行 quarantine / C23 を残す。
 * - C30: fail-closed signOut 開始で expect を +1。後着 SIGNED_OUT は apply しない。
 * - C31: persist clear 前に session キーの access_token を persist-hard leftover へ。
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
  // R4: soft residual suppress 解除（createAuthFlow / clearSoft…）後に residual effect を再評価する tick。
  // suppress 自体は storage のみで deps に載らないため、clear 経路が re-arm イベントを発火する。
  const [residualRecoveryRearmTick, setResidualRecoveryRearmTick] = useState(0);
  // 一度でも getSession 成功（error === null）したら true。SIGNED_OUT でも true のまま。
  const hasResolvedSessionOnce = useRef(false);
  /**
   * C4: cold-start 15s deadline 後の fail-closed。
   * hasResolvedSessionOnce は立てない（R 系の「一度解決済み」と混ぜない）。
   * 非 null session の apply を拒否し、明示 login（createAuthFlow → re-arm）まで維持する。
   * C14: re-arm で fail-closed は下ろすが、fail-closed 前から in-flight だった prior token は
   * hard leftover で拒否する。別 access_token（正規 IdP）は apply できる。
   */
  const coldStartFailClosedRef = useRef(false);
  /**
   * C14 / C16–C18: fail-closed で上げる。re-arm では上げない（C18: 正当な login-era probe を stale にしない）。
   * in-flight getSession の settle が stale-era なら hard leftover、login-era の世代ずれは捨てるだけ。
   */
  const sessionProbeGenerationRef = useRef(0);
  /**
   * C16–C18: deadline で上げた sessionProbeGeneration。未 fail-closed は -1。
   * stale-era = probeGeneration < この値。login-era は境界世代以上（re-arm 後の現行 probe）。
   */
  const failClosedGenerationRef = useRef(-1);
  /**
   * C16–C32: fail-closed 後〜非 stale の成功 apply まで。SDK メモリ leftover / TOKEN_REFRESHED を閉じる。
   * local signOut 成功時は C23 / login-era pending を外す。失敗・timeout・signOut 無しは残す。
   */
  const sessionQuarantineRef = useRef(false);
  /**
   * fail-closed local signOut が成功したか。成功後だけ SDK メモリは空とみなす（C26 / C28 / C29）。
   * re-arm では下ろさない（C28 の正規 SIGNED_IN を通すため）。
   * 正規 session の成功 apply で下ろす（C2: 同一 user の refresh 回転を leftover にしない）。
   */
  const localSignOutClearedSdkRef = useRef(false);
  /**
   * fail-closed local signOut の in-flight。SIGNED_OUT を pin expect に載せない。
   * 後着 SIGNED_OUT が正規 B を落とさないよう、この間の null は listener で捨てる。
   */
  const failClosedLocalSignOutInFlightRef = useRef(false);
  /**
   * C30: fail-closed signOut 開始で +1。pin mismatch expect とは別。
   * listener の null を 1 回消費して apply しない。in-flight 解除後の後着 SIGNED_OUT も拾う。
   * 未消費分は SIGN_OUT_TIMEOUT_MS 後も次の 1 回の null を消費してよい。
   */
  const expectFailClosedSignedOutCountRef = useRef(0);
  /**
   * C16–C20 / C25: residual onComplete の refreshSession だけ soft leftover を通過して apply する。
   * hard leftover は trust でも apply しない。
   */
  const trustNextRefreshRef = useRef(false);
  /**
   * C14 / C25: fail-closed 中または stale-era probe で見た prior access_token。
   * re-arm 後も残し、trust でも apply しない。トークン文字列はログしない。
   */
  const hardLeftoverAccessTokensRef = useRef<Set<string>>(new Set());
  /**
   * C31: persist clear 前に読んだ leftover access_token。
   * apply は拒否するが leftoverSetsNonEmpty には載せない（C23 / C24 を壊さない）。
   * 成功 apply でも消さない（C32）。
   */
  const persistHardLeftoverAccessTokensRef = useRef<Set<string>>(new Set());
  /**
   * C16 / C23: re-arm 後に leftover として学習した access_token。
   * 通常 apply は拒否。residual onComplete の trustNextRefresh だけ通過してよい（C20）。
   */
  const softQuarantineAccessTokensRef = useRef<Set<string>>(new Set());
  /**
   * C21: quarantine 中の login-era getSession 成功 token。apply も leftover remember もしない。
   * 後続 SIGNED_IN が同じ token なら hard が無いときだけ apply する。
   */
  const pendingLoginEraAccessTokenRef = useRef<string | null>(null);
  /**
   * C16: raw getSession の未 settle。withTimeout で外れても raw が pending なら残る。
   */
  const pendingRawSessionProbesRef = useRef<PendingRawSessionProbe[]>([]);
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
   * R1 / C1: pin mismatch で client から B を落とす signOut が発火する SIGNED_OUT を、
   * React pin 解除・soft residual に誤接続しない期待カウンタ。
   * cleanup 開始で +1、session=null ごとに 1 消費（boolean だと二重 cleanup の 2 回目 null が pin を落とす）。
   */
  const expectPinMismatchSignedOutCountRef = useRef(0);
  /**
   * R1: pin reject の世代。連続 clobber で先発 restore 成功が後発 degraded を消さないようにする。
   */
  const pinRejectGenerationRef = useRef(0);
  /** C12: pin restore cap 後の再試行タイマー（マウント寿命） */
  const pinRestoreRetryTimerRef = useRef<number | null>(null);

  /**
   * R1: pin と食い違う client session（B）を data plane から落とす。
   * signOut が使えるなら local signOut（memory+storage）。無ければ session 永続キーのみ同期 clear。
   * SIGNED_OUT は expectPinMismatchSignedOutCountRef で pin 維持する。
   */
  const clearMismatchedClientSessionBestEffort = useCallback(async (): Promise<void> => {
    setAccessTokenPinDataPlaneBlocked(true);
    try {
      const signOut = client.auth.signOut;
      if (typeof signOut === "function") {
        // signOut が発火する SIGNED_OUT を 1 回分 pin 維持で消費する（二重 cleanup は refcount）
        expectPinMismatchSignedOutCountRef.current += 1;
        try {
          await withTimeout(
            Promise.resolve(signOut.call(client.auth, { scope: "local" })).catch(() => undefined),
            SIGN_OUT_TIMEOUT_MS,
          );
        } catch {
          // timeout / throw — storage 側も best-effort で落とす
          if (typeof window !== "undefined") {
            try {
              clearBrowserSupabaseSessionStorage(window.localStorage);
            } catch {
              // ignore
            }
          }
        }
        // SIGNED_OUT が同 tick で届かない実装向けに 1 microtask 待つ
        await Promise.resolve();
      } else if (typeof window !== "undefined") {
        // signOut 無し: SIGNED_OUT は来ないので expect は立てない（真の soft null を誤消費しない）
        try {
          clearBrowserSupabaseSessionStorage(window.localStorage);
        } catch {
          // ignore
        }
      }
    } catch {
      // best-effort: count は次の null で消費、または restore 成功でリセット
    }
  }, [client]);

  /**
   * C-R1 / C2: session 適用の単一入口。pin 済み / residual arm 中の別 user 差し替えを拒否する。
   * @returns 適用したか（false = 後着差し替えを抑止）
   */
  const applyAuthSession = useCallback(
    (nextSession: Session | null, options?: { bypassStaleDenylist?: boolean }): boolean => {
      // C4: fail-closed 中は遅延 getSession / onAuthStateChange の非 null を復活させない
      // C14 / C25: fail-closed 中に見た token は hard leftover。trust でも apply しない。
      // C16–C18: 観測は stale-era / fail-closed のみ。login-era 世代ずれは refreshSession 側で捨てる。
      // C20: residual onComplete の 1 回だけ soft leftover を通過する。
      if (nextSession !== null && coldStartFailClosedRef.current) {
        rememberAccessToken(hardLeftoverAccessTokensRef.current, nextSession);
        return false;
      }
      // C5: leftover persist を leftover-incapable path（/planner 等）で first-writer pin しない。
      // 印なし persist は leftover。live 印 userId 不一致も leftover。wipe 後の retry は persist-hard。
      if (nextSession !== null && residualSessionGuardRef.current.pinnedUserId === null) {
        const liveMark = readLiveAuthSessionMark();
        const pathname = typeof window !== "undefined" ? window.location.pathname : "";
        const sessionKey = `${nextSession.user.id}:${nextSession.access_token}`;
        const refuseMismatchedLiveMark =
          liveMark?.userId !== undefined && liveMark.userId !== nextSession.user.id;
        const refuseUnmarkedLeftoverPersist =
          shouldRefuseUnmarkedLeftoverFirstPin(pathname) &&
          hasPersistedBrowserSupabaseSession() &&
          !liveAuthSessionMarkProtectsFingerprint(sessionKey);
        if (refuseMismatchedLiveMark || refuseUnmarkedLeftoverPersist) {
          if (refuseUnmarkedLeftoverPersist) {
            rememberAccessToken(persistHardLeftoverAccessTokensRef.current, nextSession);
          }
          if (typeof window !== "undefined") {
            try {
              clearBrowserSupabaseSessionStorage(window.localStorage);
            } catch {
              // best-effort
            }
            try {
              clearBrowserSupabaseSessionStorage(window.sessionStorage);
            } catch {
              // best-effort
            }
          }
          if (typeof client.auth.signOut === "function") {
            void Promise.resolve(client.auth.signOut.call(client.auth, { scope: "local" })).catch(
              () => undefined,
            );
          }
          return false;
        }
      }
      if (
        nextSession !== null &&
        hasHardLeftoverAccessToken(
          hardLeftoverAccessTokensRef.current,
          persistHardLeftoverAccessTokensRef.current,
          nextSession,
        )
      ) {
        return false;
      }
      if (
        nextSession !== null &&
        !options?.bypassStaleDenylist &&
        hasAccessToken(softQuarantineAccessTokensRef.current, nextSession)
      ) {
        return false;
      }
      const guard = residualSessionGuardRef.current;
      if (nextSession === null) {
        // R1/C1: pin mismatch cleanup の signOut による SIGNED_OUT は React pin を落とさない。
        // client から B JWT を消すための一時 null。UI は pin A + degraded のまま data plane 閉鎖。
        // refcount で 1 回ずつ消費し、二重 cleanup の 2 回目 null でも pin を落とさない。
        // 期待が尽きた後の真の soft 失効 null は通常どおり pin 解除する。
        if (expectPinMismatchSignedOutCountRef.current > 0 && guard.pinnedUserId !== null) {
          expectPinMismatchSignedOutCountRef.current -= 1;
          setAccessTokenPinDataPlaneBlocked(true);
          setSessionProbeDegraded(true);
          return false;
        }
        if (pinRestoreRetryTimerRef.current !== null) {
          window.clearTimeout(pinRestoreRetryTimerRef.current);
          pinRestoreRetryTimerRef.current = null;
        }
        clearResidualSessionGuard(guard);
        // C1: pin 解除と同時に Function Bearer ゲートも閉じる
        setAccessTokenPinnedUserId(null);
        setAccessTokenPinDataPlaneBlocked(false);
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
          // C1/R1: pin user は setAccessTokenPinnedUserId 済みのまま。client が B のまま残ると
          // PostgREST/RPC が B で動く（R1）。先に data plane を閉じ、可能なら pin A を restore する。
          // R2: requireAccessToken は PinMismatch（isAuthSessionFailure 外）で草稿 wipe しない。
          const rejectGeneration = ++pinRejectGenerationRef.current;
          setAccessTokenPinDataPlaneBlocked(true);
          setSessionProbeDegraded(true);
          const pinned = guard.pinnedSession;
          const restore = client.auth.setSession;
          const schedulePinRestoreRetry = (pinnedSession: Session): void => {
            // C12: 窓上限で restore を見送ったあと、窓明けに 1 回だけ再試行する。
            // 永続 thrash を避けるためタイマーは 1 本。成功しなければ degraded UX + 手動再ログイン。
            if (typeof window === "undefined") return;
            if (pinRestoreRetryTimerRef.current !== null) {
              window.clearTimeout(pinRestoreRetryTimerRef.current);
            }
            pinRestoreRetryTimerRef.current = window.setTimeout(() => {
              pinRestoreRetryTimerRef.current = null;
              if (rejectGeneration !== pinRejectGenerationRef.current) return;
              const g = residualSessionGuardRef.current;
              if (g.pinnedUserId === null || g.pinnedSession === null) return;
              const retryRestore = client.auth.setSession;
              if (typeof retryRestore !== "function") return;
              if (!shouldAttemptPinSessionRestore(g, Date.now())) return;
              void (async () => {
                try {
                  const result = await retryRestore.call(client.auth, {
                    access_token: pinnedSession.access_token,
                    refresh_token: pinnedSession.refresh_token,
                  });
                  if (rejectGeneration !== pinRejectGenerationRef.current) return;
                  if (result.error !== null) {
                    setAccessTokenPinDataPlaneBlocked(true);
                    setSessionProbeDegraded(true);
                    return;
                  }
                  setAccessTokenPinDataPlaneBlocked(false);
                } catch {
                  if (rejectGeneration !== pinRejectGenerationRef.current) return;
                  setAccessTokenPinDataPlaneBlocked(true);
                  setSessionProbeDegraded(true);
                }
              })();
            }, PIN_RESTORE_WINDOW_MS);
          };
          void (async () => {
            // R1: まず B を data plane から落とす（shopping/planner が auth.uid()=B で動く窓を閉じる）
            await clearMismatchedClientSessionBestEffort();
            // 後続 clobber が新しい世代を立てていたら、この restore 結果で UX を上書きしない
            if (rejectGeneration !== pinRejectGenerationRef.current) return;
            if (
              pinned === null ||
              typeof restore !== "function" ||
              typeof pinned.access_token !== "string" ||
              typeof pinned.refresh_token !== "string" ||
              pinned.access_token.length === 0 ||
              pinned.refresh_token.length === 0
            ) {
              return;
            }
            if (!shouldAttemptPinSessionRestore(guard, Date.now())) {
              // cooldown / 窓上限: client は既に clear 済み。React pin + blocked のまま。
              // C12: 窓明けに再 probe し、固着 UX を緩和する
              schedulePinRestoreRetry(pinned);
              return;
            }
            try {
              const result = await restore.call(client.auth, {
                access_token: pinned.access_token,
                refresh_token: pinned.refresh_token,
              });
              if (rejectGeneration !== pinRejectGenerationRef.current) return;
              if (result.error !== null) {
                setAccessTokenPinDataPlaneBlocked(true);
                setSessionProbeDegraded(true);
                // C12: 失敗後も窓明け再試行（token 一時不整合の回復余地）
                schedulePinRestoreRetry(pinned);
                return;
              }
              // restore 成功: data plane block は必ず下ろす（client は A に戻った）。
              // degraded UX は onAuthStateChange の apply または後続 clobber に任せる。
              // 連続 clobber で後発世代が degraded を立てたあと、先発成功が degraded を消さないよう
              // degraded はここでは触らない（C-R2/C-R7）。
              setAccessTokenPinDataPlaneBlocked(false);
            } catch {
              if (rejectGeneration !== pinRejectGenerationRef.current) return;
              // 復元失敗でも React 状態は pin 維持。data plane は閉じたまま（C-R7 / R1）
              setAccessTokenPinDataPlaneBlocked(true);
              setSessionProbeDegraded(true);
              schedulePinRestoreRetry(pinned);
            }
          })();
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
      // C1: 適用成功時だけ Function 向け pin を同期（拒否経路では勝者 pin を維持）
      setAccessTokenPinnedUserId(guard.pinnedUserId);
      // R1: 一致する session を適用できたので data plane を再開
      setAccessTokenPinDataPlaneBlocked(false);
      expectPinMismatchSignedOutCountRef.current = 0;
      if (pinRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(pinRestoreRetryTimerRef.current);
        pinRestoreRetryTimerRef.current = null;
      }
      setSessionProbeDegraded(false);
      // C4/R3: 認証成功で soft residual の共有 residual recovery suppress を解除
      clearSoftResidualRecoverySuppressed();
      // C2: 確立済み session があるのでタブ局所の「今開始した flow」印は不要
      clearActiveLoginFlowId();
      // C14 / C21: 成功 apply で soft leftover と pending を閉じる。
      // C31 / C32: hard leftover は残す（persist leftover A を後続 getSession / SIGNED_IN で拒否）。
      softQuarantineAccessTokensRef.current.clear();
      pendingLoginEraAccessTokenRef.current = null;
      // C16–C18: 非 stale の成功 apply で quarantine を解除
      sessionQuarantineRef.current = false;
      // C2: 正規 session 適用後は fail-closed signOut 成功旗を下ろす。
      // 残すと focus getSession の同一 user refresh 回転（T2）まで leftover 扱いになる。
      localSignOutClearedSdkRef.current = false;
      setSession(nextSession);
      // C5: 既存 live 印があるときだけ userId を埋める。印なし leftover を live に昇格しない。
      if (
        typeof window !== "undefined" &&
        shouldCommitLiveAuthSessionMark(window.location.pathname) &&
        readLiveAuthSessionMark() !== null
      ) {
        writeLiveAuthSessionMark(nextSession.user.id);
      }
      return true;
    },
    [clearMismatchedClientSessionBestEffort, client],
  );

  /**
   * C26 / C29: fail-closed 後の local signOut。UI 解放は待たない。
   * pin mismatch expect は立てない（SIGNED_OUT で soft residual / pin 維持に誤接続しない）。
   * C30: fail-closed expect を開始時に +1 し、後着 SIGNED_OUT を in-flight 外でも 1 回捨てる。
   * 成功時だけ localSignOutClearedSdkRef を立て、C23 / leftover pending を外す。
   */
  const requestLocalSignOutOnColdStartFailClosed = useCallback((): void => {
    const signOut = client.auth.signOut;
    if (typeof signOut !== "function") {
      return;
    }
    failClosedLocalSignOutInFlightRef.current = true;
    expectFailClosedSignedOutCountRef.current += 1;
    void (async () => {
      try {
        const result = await withTimeout(
          Promise.resolve(signOut.call(client.auth, { scope: "local" })),
          SIGN_OUT_TIMEOUT_MS,
        );
        if (isFailedAuthSignOutResult(result)) {
          return;
        }
        localSignOutClearedSdkRef.current = true;
      } catch {
        // timeout / throw — quarantine / C23 を残す
      } finally {
        failClosedLocalSignOutInFlightRef.current = false;
      }
    })();
  }, [client]);

  /**
   * C5 / C16–C18: cold-start deadline の fail-closed。UI を先に解放し、local signOut は待たない。
   * 二重発火では世代を上げない（C18 の login-era を stale にしない）。
   * C15: C5 の 401 と同じ origin 共有 suppress を立て、/login residual が leftover 全件を回さない。
   * C37: abandoned の active-login-flow pin は両方消す（applyAuthSession(null) では消えない）。
   * flow / pending / PKCE / callback-owner は焼かない（RR1 / R3）。
   * 解除は createAuthFlow（local pin 成功時） / session 適用（既存 clear + R4 re-arm）。
   */
  const failClosedColdStartSession = useCallback((): void => {
    if (hasResolvedSessionOnce.current) return;
    if (coldStartFailClosedRef.current) return;
    sessionProbeGenerationRef.current += 1;
    failClosedGenerationRef.current = sessionProbeGenerationRef.current;
    coldStartFailClosedRef.current = true;
    sessionQuarantineRef.current = true;
    // C31: persist clear 前に leftover access_token を persist-hard へ。parse 失敗は無視。
    rememberPersistedAccessTokensAsHardLeftover(persistHardLeftoverAccessTokensRef.current);
    clearPersistedAuthOnColdStartFailClosed();
    applyAuthSession(null);
    setLoaded(true);
    // C15: UI 解放を待たず、C5 と同じ origin 共有 suppress。sibling secret は残す。
    markSoftResidualRecoverySuppressed();
    // C37: abandoned の origin 共有 pin を両方消す。残すと後続 B の local 書込失敗で remount が A を restrict する。
    // leftover / pending / secret は焼かない（RR1 / R3）。
    clearActiveLoginFlowId();
    requestLocalSignOutOnColdStartFailClosed();
  }, [applyAuthSession, requestLocalSignOutOnColdStartFailClosed]);

  /**
   * C12: authenticated+degraded 固着から再ログイン可能な未認証へ落とす。
   * data plane は既に fail-closed。権限昇格はせず pin/expect を破棄して soft residual 経路へ。
   * client 残留 JWT も best-effort で落とし、pin 解除後に B のまま data plane が開かないようにする。
   */
  const recoverDegradedSession = useCallback((): void => {
    if (pinRestoreRetryTimerRef.current !== null) {
      window.clearTimeout(pinRestoreRetryTimerRef.current);
      pinRestoreRetryTimerRef.current = null;
    }
    // in-flight restore / expect null を無効化し、次の null を真の soft 失効として適用する
    pinRejectGenerationRef.current += 1;
    expectPinMismatchSignedOutCountRef.current = 0;
    applyAuthSession(null);
    // pin 解除後の client JWT 掃除。expect は立てない（既に unauthenticated）。
    void (async () => {
      const signOut = client.auth.signOut;
      if (typeof signOut === "function") {
        try {
          await withTimeout(
            Promise.resolve(signOut.call(client.auth, { scope: "local" })).catch(() => undefined),
            SIGN_OUT_TIMEOUT_MS,
          );
        } catch {
          // ignore
        }
        return;
      }
      if (typeof window !== "undefined") {
        try {
          clearBrowserSupabaseSessionStorage(window.localStorage);
        } catch {
          // ignore
        }
      }
    })();
  }, [applyAuthSession, client]);

  const refreshSession = useCallback(async (): Promise<void> => {
    const beganAt = coldStartBeganAtMs.current ?? Date.now();
    coldStartBeganAtMs.current = beganAt;
    const probeGeneration = sessionProbeGenerationRef.current;
    // residual onComplete の 1 回だけ quarantine を通過させる。interval/focus と共有しない。
    const trustThisRefresh = trustNextRefreshRef.current;
    if (trustThisRefresh) {
      trustNextRefreshRef.current = false;
    }
    const trackedProbe: PendingRawSessionProbe = { generation: probeGeneration };
    try {
      const sessionPromise = client.auth.getSession();
      pendingRawSessionProbesRef.current.push(trackedProbe);
      // C14 / C18: withTimeout 後の遅延 settle。stale-era だけ hard leftover（login-era 世代ずれは捨てるだけ）
      void Promise.resolve(sessionPromise).then(
        (result) => {
          if (probeGeneration === sessionProbeGenerationRef.current) return;
          if (!isStaleEraProbe(probeGeneration, failClosedGenerationRef.current)) return;
          if (result.error === null) {
            rememberAccessToken(hardLeftoverAccessTokensRef.current, result.data.session);
          }
        },
        () => undefined,
      );
      // C16: withTimeout で外れても raw が pending なら配列に残す。settle してから外す。
      void Promise.resolve(sessionPromise).finally(() => {
        releasePendingRawSessionProbe(pendingRawSessionProbesRef.current, trackedProbe);
      });
      const { data, error } = await withTimeout(sessionPromise, COLD_START_GET_SESSION_TIMEOUT_MS);
      // B-I6: getSession の一時エラーで直前 session を捨てない。
      // クリアは error === null かつ session === null、または SIGNED_OUT のみ。
      if (error === null) {
        // C14 / C18: 世代ずれ。stale-era だけ hard leftover。login-era は結果を捨てるだけ（正規 B を焼かない）
        if (probeGeneration !== sessionProbeGenerationRef.current) {
          if (isStaleEraProbe(probeGeneration, failClosedGenerationRef.current)) {
            rememberAccessToken(hardLeftoverAccessTokensRef.current, data.session);
          }
          return;
        }
        // C4: fail-closed 後の遅延成功は非 null を捨てる（hasResolved も立てない）
        // C14 / C25: hard leftover は trust でも apply しない
        if (data.session !== null && coldStartFailClosedRef.current) {
          rememberAccessToken(hardLeftoverAccessTokensRef.current, data.session);
          return;
        }
        if (
          data.session !== null &&
          hasHardLeftoverAccessToken(
            hardLeftoverAccessTokensRef.current,
            persistHardLeftoverAccessTokensRef.current,
            data.session,
          )
        ) {
          return;
        }
        if (
          data.session !== null &&
          !trustThisRefresh &&
          hasAccessToken(softQuarantineAccessTokensRef.current, data.session)
        ) {
          return;
        }
        // C21: quarantine 中の世代一致 login-era getSession は apply せず leftover にも入れない。
        // pending に残し、後続 SIGNED_IN が同じ token なら hard が無いとき apply できる。
        // C20: residual onComplete の trust は soft leftover だけ通過する（hard は上で拒否済み）。
        // C26: signOut 成功後は leftover A を pending に載せない（hard leftover。後続 SIGNED_IN A を閉じる）。
        // signOut 成功後の trust getSession 非 null は正規完了として apply する（C29 拒否枝は置かない）。
        if (data.session !== null && sessionQuarantineRef.current && !trustThisRefresh) {
          if (localSignOutClearedSdkRef.current) {
            rememberAccessToken(hardLeftoverAccessTokensRef.current, data.session);
            return;
          }
          const token = readAccessToken(data.session);
          if (token !== null) {
            pendingLoginEraAccessTokenRef.current = token;
          }
          return;
        }
        // C32: persist-hard / fail-closed 観測 token は上の hasHardLeftoverAccessToken で拒否済み。
        // 同一 user の正規 refresh 回転は denylist しない（認証成功で flag を下ろす）。
        applyAuthSession(
          data.session,
          trustThisRefresh ? { bypassStaleDenylist: true } : undefined,
        );
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
      // C22: re-arm 後（login 開始済み）は世代を上げず fail-closed を再武装しない。
      // 初回 cold-start の deadline 枝だけが世代境界を決める。
      if (
        Date.now() - beganAt >= COLD_START_SESSION_DEADLINE_MS &&
        !(failClosedGenerationRef.current >= 0 && !coldStartFailClosedRef.current)
      ) {
        failClosedColdStartSession();
      }
    } catch {
      // C12: timeout / never-settle。storage は焼かず、authenticated なら degraded UX のみ。
      // 初回成功前は loading 継続。全体上限は deadline タイマーが担当。
      if (hasResolvedSessionOnce.current && residualSessionGuardRef.current.pinnedUserId !== null) {
        setSessionProbeDegraded(true);
      }
    }
  }, [applyAuthSession, client, failClosedColdStartSession]);

  useEffect(() => {
    coldStartBeganAtMs.current = Date.now();
    // C-R11: AuthProvider マウントで dismiss BC を eager 購読（auth-flow module load の保険）
    startAuthFlowDismissBroadcastListener();
    void refreshSession();
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      // fail-closed local signOut の SIGNED_OUT。pin expect は立てていないのでここで捨てる。
      // C30: in-flight だけでなく expect カウントでも消費する（finally 後の後着 null）。
      // hasResolved も立てない（C4）。soft residual も走らせない（apply しない）。
      if (nextSession === null && failClosedLocalSignOutInFlightRef.current) {
        if (expectFailClosedSignedOutCountRef.current > 0) {
          expectFailClosedSignedOutCountRef.current -= 1;
        }
        return;
      }
      if (nextSession === null && expectFailClosedSignedOutCountRef.current > 0) {
        expectFailClosedSignedOutCountRef.current -= 1;
        return;
      }
      // C4: fail-closed 中の遅延 session は無視（hasResolved も立てない）
      // C14 / C25: fail-closed 中に見た token は hard leftover。re-arm 後も trust でも apply しない。
      if (nextSession !== null && coldStartFailClosedRef.current) {
        rememberAccessToken(hardLeftoverAccessTokensRef.current, nextSession);
        return;
      }
      if (
        nextSession !== null &&
        hasHardLeftoverAccessToken(
          hardLeftoverAccessTokensRef.current,
          persistHardLeftoverAccessTokensRef.current,
          nextSession,
        )
      ) {
        return;
      }
      if (
        nextSession !== null &&
        hasAccessToken(softQuarantineAccessTokensRef.current, nextSession)
      ) {
        return;
      }
      if (nextSession !== null && sessionQuarantineRef.current) {
        // C19 / C24: 非 SIGNED_IN は hard/soft が既に空でないときだけ soft remember。
        // 空の先着 TOKEN_REFRESHED B は焼かない。hard に T1 がある C19 は T2 を remember し続ける。
        if (event !== "SIGNED_IN") {
          if (
            leftoverSetsNonEmpty(
              hardLeftoverAccessTokensRef.current,
              softQuarantineAccessTokensRef.current,
            )
          ) {
            rememberAccessToken(softQuarantineAccessTokensRef.current, nextSession);
          }
          return;
        }
        // C21: login-era getSession が先に見た token の SIGNED_IN は leftover に落とさず apply
        const pendingToken = pendingLoginEraAccessTokenRef.current;
        const incomingToken = readAccessToken(nextSession);
        if (pendingToken !== null && incomingToken === pendingToken) {
          applyAuthSession(nextSession);
          hasResolvedSessionOnce.current = true;
          setLoaded(true);
          return;
        }
        // C14 / C16 / C18: SIGNED_IN。hard/soft ヒットは上で拒否済み。
        // 既に別 leftover があるなら正規 IdP（C16 後半 / C17 後半 / C4/C14 の fresh）。
        if (
          leftoverSetsNonEmpty(
            hardLeftoverAccessTokensRef.current,
            softQuarantineAccessTokensRef.current,
          )
        ) {
          applyAuthSession(nextSession);
          hasResolvedSessionOnce.current = true;
          setLoaded(true);
          return;
        }
        // C16: stale-era raw が未 settle なら prior SIGNED_IN を soft 学習して拒否。
        // login-era が同時に pending でも例外にしない（両方 pending の prior を apply しない）。
        if (
          hasPendingStaleEraRawProbe(
            pendingRawSessionProbesRef.current,
            failClosedGenerationRef.current,
          )
        ) {
          rememberAccessToken(softQuarantineAccessTokensRef.current, nextSession);
          return;
        }
        // C23: quarantine 中・hard/soft 空・stale pending 無しの SIGNED_IN は leftover。
        // pending login-era token 一致はこの枝に来ない（C21）。
        // C28: signOut 成功後は SDK 空とみなし、正規 SIGNED_IN B を通す。失敗時は C23 を残す。
        if (localSignOutClearedSdkRef.current) {
          applyAuthSession(nextSession);
          hasResolvedSessionOnce.current = true;
          setLoaded(true);
          return;
        }
        rememberAccessToken(softQuarantineAccessTokensRef.current, nextSession);
        return;
      }
      applyAuthSession(nextSession);
      hasResolvedSessionOnce.current = true;
      setLoaded(true);
    });
    const onFocus = (): void => void refreshSession();
    window.addEventListener("focus", onFocus);
    // 初回 getSession が一時失敗したまま loading で固まらないよう、未解決中だけ再試行する
    const retryTimer = window.setInterval(() => {
      // C4: fail-closed 後は interval を止める（hasResolved は立てず ref だけで判定）
      if (!hasResolvedSessionOnce.current && !coldStartFailClosedRef.current) {
        void refreshSession();
      }
    }, COLD_START_SESSION_RETRY_MS);
    // C5: hang/一時失敗の再試行を打ち切り、未ログインとして UI を解放する全体上限
    // persist token も同期 clear し、focus 復活で「いつの間にかログイン」を防ぐ
    const coldStartDeadlineTimer = window.setTimeout(() => {
      // C14 / C16–C18: in-flight を stale-era にするため世代を上げる。
      // persist 同期 clear + UI 解放を先に。local signOut は待たない（C26 / C29）。
      failClosedColdStartSession();
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(retryTimer);
      window.clearTimeout(coldStartDeadlineTimer);
    };
  }, [applyAuthSession, client, failClosedColdStartSession, refreshSession]);

  // C5/C6/C4/R3: authenticated → unauthenticated（SIGNED_OUT / refresh 失効の getSession null 等）で
  // 共有端末に free-form 草稿・feedback fingerprint・session を残さない。
  // C4: soft 失効後の /login residual recovery silent complete を閉じる
  // （R3: flow secret は sibling mid-login のため温存し、origin 共有 localStorage suppress で
  //  新タブ含む residual recovery を抑止。/auth/callback target recovery は対象外）。
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

  // R4: createAuthFlow / clearSoftResidualRecoverySuppressed が suppress を落としたあと、
  // residual effect を同一マウントで再評価する（storage 変更だけでは deps が動かない）。
  // C4: suppress 中はイベントが来ない（clear 時のみ re-arm）。prior-user silent complete は閉じたまま。
  useEffect(() => {
    const onRearm = (): void => {
      // C4: 明示 login 開始（createAuthFlow）で fail-closed を解除し、正規 session を受け付ける
      // C14 / C18: fail-closed は下ろすが leftover 集合と quarantine は残す。
      // 世代は fail-closed 時点で上げ済み。re-arm で上げると正当な login-era probe が stale になる。
      coldStartFailClosedRef.current = false;
      setResidualRecoveryRearmTick((n) => n + 1);
    };
    window.addEventListener(SOFT_RESIDUAL_RECOVERY_REARM_EVENT, onRearm);
    return () => {
      window.removeEventListener(SOFT_RESIDUAL_RECOVERY_REARM_EVENT, onRearm);
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
    // C4/R3: soft residual 後は origin 共有 suppress で residual recovery を抑止
    // （secret 温存でも新タブ含む silent complete しない。解除は createAuthFlow / session 適用 + R4 re-arm）
    if (isSoftResidualRecoverySuppressed()) return undefined;
    const recoveryTtlMs =
      providedClient === undefined ? getPublicEnv().authContinuationTtlMs : 300_000;
    const storage = window.localStorage;
    const restrictToFlowId = readActiveLoginFlowId();
    // C4/C12: pin 無し idle /login では residual を始めない。
    // 期限切れ pin は read が捨てる。restrict 無し全件 claim を開かない。
    // C12: armed は start 直前だけ。早期 return で残すと residual 無しでも first-writer pin が有効。
    if (restrictToFlowId === undefined) return undefined;
    // C-R1: residual recovery 起動で arm（first session 待ち）。C2 で pin は authenticated 中ずっと有効。
    const guard = residualSessionGuardRef.current;
    guard.armed = true;
    const stopRecovery = startRecovery({
      gateway,
      storage,
      ttlMs: recoveryTtlMs,
      // C2/C12: createAuthFlow 後は今開始した flow だけを claimable に絞る。
      // targetFlowId は callback 専用（owner 必須）。マジック元は owner が無いので付けない。
      restrictToFlowId,
      onComplete: (result) => {
        publishCompletionSafely({ flowId: result.flowId, returnTo: result.returnTo });
        // C16–C20 / C25: マジック完了の refresh は soft leftover だけ通過する。hard leftover は拒否。
        trustNextRefreshRef.current = true;
        void refreshSession();
        // C14 / C1: completion listener（C16）と同型の path / waiting ガード。
        // 設定編集中などでの強制 navigate を避ける。
        // C8: residual recovery 完了はこのタブ所有。waiting 空（secret 消去後）でも returnTo へ。
        if (
          result.returnTo.startsWith("/") &&
          shouldNavigateOnAuthComplete(result.flowId, { ownedByThisTab: true })
        ) {
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
    // R4: suppress clear 後の re-arm 信号（意図的 login 開始で residual を再開）
    residualRecoveryRearmTick,
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

  // C12: pin restore 再試行タイマーをアンマウントで破棄
  useEffect(() => {
    return () => {
      if (pinRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(pinRestoreRetryTimerRef.current);
        pinRestoreRetryTimerRef.current = null;
      }
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: !loaded ? "loading" : session === null ? "unauthenticated" : "authenticated",
      session,
      refreshSession,
      // C12: probe timeout 中。session オブジェクトは残り得るが API は fail-closed。
      sessionProbeDegraded,
      recoverDegradedSession,
    }),
    [loaded, recoverDegradedSession, refreshSession, session, sessionProbeDegraded],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
