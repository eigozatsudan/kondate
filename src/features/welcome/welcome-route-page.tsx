import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { OnboardingStatus } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import { getProfile, setOnboardingStatus } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { useProfilePendingDeadline } from "@/features/household/use-profile-pending-deadline";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { WelcomePage } from "./welcome-page";

/** 別タブ同時開始の last-write-wins を抑える（L4）。Web Locks 未対応環境は直列フォールバックなしで実行。 */
const ONBOARDING_START_LOCK = "kondate:welcome-onboarding-start";

async function withOnboardingStartLock<T>(run: () => Promise<T>): Promise<T> {
  // DOM 型は locks を常置するが、未対応 UA では runtime で欠けることがある
  const locks = Reflect.get(globalThis.navigator, "locks") as LockManager | undefined;
  if (locks === undefined || typeof locks.request !== "function") {
    return run();
  }
  return locks.request(ONBOARDING_START_LOCK, run);
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
    void navigate("/planner");
    return true;
  }
  return false;
}

/**
 * 家族導線: terminal は planner、in_progress は onboarding へ（書き込み不要）。
 * dual-tab で live が in_progress になった場合も first-writer を尊重して onboarding。
 */
function navigateForHouseholdExistingStatus(
  status: OnboardingStatus,
  navigate: ReturnType<typeof useNavigate>,
): boolean {
  if (navigateForTerminalStatus(status, navigate)) return true;
  if (status === "in_progress") {
    void navigate("/onboarding");
    return true;
  }
  return false;
}

/** welcome 開始: CAS 後の実 status へ遷移（書き込み成功 / first-writer 負けの両方） */
function navigateAfterWelcomeStart(
  status: OnboardingStatus,
  navigate: ReturnType<typeof useNavigate>,
): void {
  if (navigateForTerminalStatus(status, navigate)) return;
  if (status === "in_progress") {
    void navigate("/onboarding");
    return;
  }
  // not_started のまま返った場合は CAS も遷移も起きていない。再試行を促すより現状維持。
}

// router層の結線だけをここへ切り出し、WelcomePage自体はDB/APIを直接呼ばない
// 表示専用コンポーネントのまま保つ（brief の WelcomePageProps 契約を保持するため）。
// idea開始はsetOnboardingStatus(...,"skipped")成功後に/planner、
// 家族導線はsetOnboardingStatus(...,"in_progress")成功後に/onboardingへ遷移する。
export function WelcomeRoutePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  if (showPending) {
    return <main className="page-frame">状態を確認しています…</main>;
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
        if (userId === undefined) return;
        await withOnboardingStartLock(async () => {
          const client = getBrowserSupabaseClient();
          // ロック内で最新 status を再読込し、別タブの確定を上書きしない
          const latest = await getProfile(client, userId);
          const live = latest.onboarding_status;
          if (navigateForTerminalStatus(live, navigate)) {
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            return;
          }
          // dual-tab first-writer: 表示は not_started のまま live が in_progress なら
          // 家族導線の先勝ちを尊重し skipped で上書きしない（既存 L4 契約）。
          if (displayStatus === "not_started" && live === "in_progress") {
            void navigate("/onboarding");
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            return;
          }
          // L1: 表示が in_progress の「設定せず…」は expected=in_progress で skipped CAS。
          // not_started は従来どおり expected=not_started。RPC は両遷移を合法とする。
          if (live === "not_started" || live === "in_progress") {
            const written = await setOnboardingStatus(client, userId, "skipped", {
              expectedStatus: live,
            });
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            navigateAfterWelcomeStart(written.onboarding_status, navigate);
          }
        });
      }}
      onStartHousehold={async () => {
        if (userId === undefined) return;
        await withOnboardingStartLock(async () => {
          const client = getBrowserSupabaseClient();
          const latest = await getProfile(client, userId);
          if (navigateForHouseholdExistingStatus(latest.onboarding_status, navigate)) {
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            return;
          }
          // R1: expected=not_started の CAS。locks 無し dual-tab でも skipped/in_progress/complete を上書きしない
          const written = await setOnboardingStatus(client, userId, "in_progress", {
            expectedStatus: "not_started",
          });
          await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
          navigateAfterWelcomeStart(written.onboarding_status, navigate);
        });
      }}
    />
  );
}
