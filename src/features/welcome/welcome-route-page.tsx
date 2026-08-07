import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { OnboardingStatus } from "@shared/contracts/domain";
import { withTimeout } from "@/features/auth/async-timeout";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";
import { useAuth } from "@/features/auth/use-auth";
import { getProfile, setOnboardingStatus } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useProfilePendingDeadline } from "@/features/household/use-profile-pending-deadline";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { WelcomePage } from "./welcome-page";

/** 別タブ同時開始の last-write-wins を抑える（L4）。Web Locks 未対応環境は直列フォールバックなしで実行。 */
const ONBOARDING_START_LOCK = "kondate:welcome-onboarding-start";

/**
 * L1: C5 timeout 後の reconcile 再読込。既に C5 を待っているため短い grace に留め、
 * getProfile hang の二重待ちで失敗 UI を塞がない。
 * テストから fake timer 進み幅を合わせるため export する。
 */
export const WELCOME_START_RECONCILE_GRACE_MS = 3_000;

/**
 * L1: lock 内 getProfile / CAS が never-settle でも auth C5 同尺で打ち切る。
 * timeout は **lock コールバック内**でかけ、reject で lock を解放し dual-tab 閉塞を防ぐ。
 * withTimeout は元 Promise を cancel しないため、onTimeout で generation を無効化する。
 * 遅延 CAS の DB 書き込み自体は止められないが、route 側で re-read / ゾンビ CAS を reconcile する。
 */
async function withOnboardingStartLock<T>(
  run: () => Promise<T>,
  onTimeout?: () => void,
): Promise<T> {
  const execute = (): Promise<T> => withTimeout(run(), COLD_START_SESSION_DEADLINE_MS, onTimeout);
  // DOM 型は locks を常置するが、未対応 UA では runtime で欠けることがある
  const locks = Reflect.get(globalThis.navigator, "locks") as LockManager | undefined;
  if (locks === undefined || typeof locks.request !== "function") {
    return execute();
  }
  return locks.request(ONBOARDING_START_LOCK, execute);
}

/** 開始後ナビは履歴トラップ防止のため replace（L4。terminal 直アクセス / RootEntry と同型）。 */
const welcomeStartNavigateOptions = { replace: true } as const;

/**
 * L2: CAS / 既存 status 確定後の invalidate は best-effort。
 * hang しても開始成功を「失敗」と誤表示しない（await せず fire-and-forget）。
 */
function softInvalidateProfile(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
}

/**
 * L4 + R1: 別タブが先に進めた terminal status を尊重する。
 * skipped/complete は /planner へ。in_progress は呼び出し側で分岐
 * （idea の意図的 skip と household 継続 / dual-tab first-writer で扱いが異なる）。
 */
function navigateForTerminalStatus(
  status: OnboardingStatus,
  navigate: ReturnType<typeof useNavigate>,
): boolean {
  if (status === "skipped" || status === "complete") {
    void navigate("/planner", welcomeStartNavigateOptions);
    return true;
  }
  return false;
}

/**
 * welcome 開始: CAS 後の実 status へ遷移（書き込み成功 / first-writer 負けの両方）。
 * L5: 遷移しない経路は throw し、WelcomePage が pending を解除して再試行可能にする。
 */
function navigateAfterWelcomeStart(
  status: OnboardingStatus,
  navigate: ReturnType<typeof useNavigate>,
): void {
  if (navigateForTerminalStatus(status, navigate)) return;
  if (status === "in_progress") {
    void navigate("/onboarding", welcomeStartNavigateOptions);
    return;
  }
  // not_started のまま = CAS 未進行。成功扱いで pending を固着させない
  throw new Error("onboarding start did not advance");
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "timeout";
}

// router層の結線だけをここへ切り出し、WelcomePage自体はDB/APIを直接呼ばない
// 表示専用コンポーネントのまま保つ（brief の WelcomePageProps 契約を保持するため）。
// idea開始はsetOnboardingStatus(...,"skipped")成功後に/planner、
// 家族導線はsetOnboardingStatus(...,"in_progress")成功後に/onboardingへ遷移する。
export function WelcomeRoutePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // L1/L2: withTimeout 後も run() が続行するゾンビと、unmount 後の遅延 navigate を抑止する generation。
  // - timeout: onTimeout で +1（クライアント副作用を止める）
  // - unmount: cleanup で +1（離脱後の router yank を止める）
  // 遅延 CAS の DB 書き込みは cancel 不能。timeout のみで無効化された flight
  // （ref === generation+1 かつ mounted）は L1 reconcile で遷移する。
  const startGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const userId = auth.session?.user.id;
  const profileQuery = useQuery({
    queryKey: householdKeys.profile(userId ?? "none"),
    queryFn: () => {
      if (userId === undefined) throw new Error("ログインが必要です");
      return getProfile(getBrowserSupabaseClient(), userId);
    },
    enabled: userId !== undefined,
  });
  // L2: profile hang は isError にならない。auth C5 と同尺で pending を打ち切り再試行 UI へ。
  const { showPending, pendingTimedOut } = useProfilePendingDeadline(profileQuery.isPending);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // L2: 離脱後のゾンビ navigate を timeout 無効化と同型で止める
      mountedRef.current = false;
      startGenerationRef.current += 1;
    };
  }, []);

  /**
   * L1: timeout でちょうど 1 回だけ無効化された flight の遅延確定を reconcile。
   * unmount（mounted=false）や新 flight（ref !== generation+1）では no-op。
   */
  function tryReconcileZombieWrite(generation: number, status: OnboardingStatus): boolean {
    if (!mountedRef.current || userId === undefined) return false;
    if (startGenerationRef.current !== generation + 1) return false;
    if (status === "not_started") return false;
    softInvalidateProfile(queryClient, userId);
    if (!mountedRef.current || startGenerationRef.current !== generation + 1) return false;
    navigateAfterWelcomeStart(status, navigate);
    return true;
  }

  /**
   * L1: C5 timeout 後、in-flight CAS / 他タブ先行を短い grace の再読込で確認。
   * status が進んでいれば失敗表示せず遷移。true hang のみ timeout を再 throw。
   */
  async function reconcileAfterStartTimeout(generation: number): Promise<void> {
    if (!mountedRef.current || userId === undefined) {
      throw new Error("timeout");
    }
    if (startGenerationRef.current !== generation + 1) {
      throw new Error("timeout");
    }
    try {
      const latest = await withTimeout(
        getProfile(getBrowserSupabaseClient(), userId),
        WELCOME_START_RECONCILE_GRACE_MS,
      );
      if (!mountedRef.current || startGenerationRef.current !== generation + 1) {
        throw new Error("timeout");
      }
      if (latest.onboarding_status === "not_started") {
        throw new Error("timeout");
      }
      softInvalidateProfile(queryClient, userId);
      if (!mountedRef.current || startGenerationRef.current !== generation + 1) {
        return;
      }
      navigateAfterWelcomeStart(latest.onboarding_status, navigate);
    } catch (inner) {
      if (isTimeoutError(inner)) {
        throw inner;
      }
      // re-read 失敗や navigate 契約違反も開始失敗 UI へ
      throw new Error("timeout");
    }
  }

  /**
   * 1 開始 flight 分の generation を発行し、timeout 時に無効化する。
   * body 内の await 後は isCurrent() で副作用をガードする。
   * timeout 後は L1 reconcile を挟み、status 進行済みなら失敗にしない。
   */
  async function runWelcomeStart(
    body: (isCurrent: () => boolean, generation: number) => Promise<void>,
  ): Promise<void> {
    const generation = ++startGenerationRef.current;
    const isCurrent = (): boolean => startGenerationRef.current === generation;
    const invalidateGeneration = (): void => {
      // timeout 発火時点で同期的に破棄（catch より前に通常 navigate を止める）
      if (startGenerationRef.current === generation) {
        startGenerationRef.current += 1;
      }
    };
    try {
      await withOnboardingStartLock(async () => {
        await body(isCurrent, generation);
      }, invalidateGeneration);
    } catch (error) {
      if (!isTimeoutError(error)) {
        throw error;
      }
      await reconcileAfterStartTimeout(generation);
    }
  }

  if (showPending) {
    // L10: 待ち UI は SR に busy/live を通知（timeout 後の alert と対称）
    return (
      <main className="page-frame" aria-busy="true" aria-live="polite">
        状態を確認しています…
      </main>
    );
  }
  if (profileQuery.isError || pendingTimedOut || profileQuery.data == null) {
    return (
      <main className="page-frame stack">
        <p className="error-message" role="alert">
          初回設定の状態を確認できませんでした。通信を確認して再試行してください。
        </p>
        {/* WELCOME-M1: RootEntry と同様の再試行導線 */}
        <button
          className="secondary-button min-h-11"
          type="button"
          onClick={() => {
            void profileQuery.refetch();
          }}
        >
          再試行
        </button>
      </main>
    );
  }

  // 表示中 status。L1 idea の intentional skip と dual-tab first-writer の分岐に使う
  // （ロック内 re-read の live と一致しない場合がある）。
  const displayStatus = profileQuery.data.onboarding_status;

  return (
    <WelcomePage
      onboardingStatus={displayStatus}
      onStartIdea={async () => {
        // L5: 未ログインは return せず throw し、pending 解除 + 再試行 UI へ
        if (userId === undefined) throw new Error("ログインが必要です");
        await runWelcomeStart(async (isCurrent, generation) => {
          const client = getBrowserSupabaseClient();
          // ロック内で最新 status を再読込し、別タブの確定を上書きしない
          const latest = await getProfile(client, userId);
          if (!isCurrent()) {
            // L1: timeout 後の遅延 re-read。進んでいれば reconcile、未進行なら no-op
            tryReconcileZombieWrite(generation, latest.onboarding_status);
            return;
          }
          const live = latest.onboarding_status;
          if (live === "skipped" || live === "complete") {
            // L2: invalidate hang を開始失敗にしない（navigate を優先）
            softInvalidateProfile(queryClient, userId);
            if (!isCurrent()) return;
            void navigate("/planner", welcomeStartNavigateOptions);
            return;
          }
          // dual-tab first-writer: 表示は not_started のまま live が in_progress なら
          // 家族導線の先勝ちを尊重し skipped で上書きしない（既存 L4 契約）。
          if (displayStatus === "not_started" && live === "in_progress") {
            softInvalidateProfile(queryClient, userId);
            if (!isCurrent()) return;
            void navigate("/onboarding", welcomeStartNavigateOptions);
            return;
          }
          // L1: skipped|complete 以外は not_started|in_progress のみ。
          // 表示が in_progress の「設定せず…」は expected=in_progress で skipped CAS。
          // not_started は従来どおり expected=not_started。RPC は両遷移を合法とする。
          const written = await setOnboardingStatus(client, userId, "skipped", {
            expectedStatus: live,
          });
          // L1: timeout 後のゾンビ CAS は generation+1 かつ mounted なら reconcile 遷移
          if (!isCurrent()) {
            tryReconcileZombieWrite(generation, written.onboarding_status);
            return;
          }
          // L2: CAS 成功後は invalidate hang を失敗扱いにしない
          softInvalidateProfile(queryClient, userId);
          if (!isCurrent()) return;
          navigateAfterWelcomeStart(written.onboarding_status, navigate);
        });
      }}
      onStartHousehold={async () => {
        if (userId === undefined) throw new Error("ログインが必要です");
        await runWelcomeStart(async (isCurrent, generation) => {
          const client = getBrowserSupabaseClient();
          const latest = await getProfile(client, userId);
          if (!isCurrent()) {
            tryReconcileZombieWrite(generation, latest.onboarding_status);
            return;
          }
          const live = latest.onboarding_status;
          if (live === "skipped" || live === "complete") {
            softInvalidateProfile(queryClient, userId);
            if (!isCurrent()) return;
            void navigate("/planner", welcomeStartNavigateOptions);
            return;
          }
          if (live === "in_progress") {
            softInvalidateProfile(queryClient, userId);
            if (!isCurrent()) return;
            void navigate("/onboarding", welcomeStartNavigateOptions);
            return;
          }
          // R1: expected=not_started の CAS。locks 無し dual-tab でも skipped/in_progress/complete を上書きしない
          const written = await setOnboardingStatus(client, userId, "in_progress", {
            expectedStatus: "not_started",
          });
          if (!isCurrent()) {
            tryReconcileZombieWrite(generation, written.onboarding_status);
            return;
          }
          softInvalidateProfile(queryClient, userId);
          if (!isCurrent()) return;
          navigateAfterWelcomeStart(written.onboarding_status, navigate);
        });
      }}
    />
  );
}
