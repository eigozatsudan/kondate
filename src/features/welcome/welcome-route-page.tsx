import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { OnboardingStatus } from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/use-auth";
import { getProfile, setOnboardingStatus } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
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
 * L4 + R1: 別タブが先に進めた status を尊重し、skipped ↔ in_progress の上書きレースを避ける。
 * first-writer-wins: not_started のときだけ目標 status を書く（RPC CAS expected=not_started）。
 * locks 無しでも server CAS で complete/skipped/in_progress を上書きしない。
 */
function navigateForExistingStatus(
  status: OnboardingStatus,
  navigate: ReturnType<typeof useNavigate>,
): boolean {
  if (status === "skipped" || status === "complete") {
    void navigate("/planner");
    return true;
  }
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
  if (navigateForExistingStatus(status, navigate)) return;
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

  if (profileQuery.isPending) {
    return <main className="page-frame">状態を確認しています…</main>;
  }
  if (profileQuery.isError) {
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

  return (
    <WelcomePage
      onboardingStatus={profileQuery.data.onboarding_status}
      onStartIdea={async () => {
        if (userId === undefined) return;
        await withOnboardingStartLock(async () => {
          const client = getBrowserSupabaseClient();
          // ロック内で最新 status を再読込し、別タブの確定を上書きしない
          const latest = await getProfile(client, userId);
          if (navigateForExistingStatus(latest.onboarding_status, navigate)) {
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            return;
          }
          // R1: expected=not_started の CAS。locks 無し dual-tab でも skipped/in_progress/complete を上書きしない
          const written = await setOnboardingStatus(client, userId, "skipped", {
            expectedStatus: "not_started",
          });
          await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
          navigateAfterWelcomeStart(written.onboarding_status, navigate);
        });
      }}
      onStartHousehold={async () => {
        if (userId === undefined) return;
        await withOnboardingStartLock(async () => {
          const client = getBrowserSupabaseClient();
          const latest = await getProfile(client, userId);
          if (navigateForExistingStatus(latest.onboarding_status, navigate)) {
            await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
            return;
          }
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
