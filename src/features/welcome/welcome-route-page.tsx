import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import { getProfile, setOnboardingStatus } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { WelcomePage } from "./welcome-page";

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
      <main className="page-frame">
        <p className="error-message" role="alert">
          初回設定の状態を確認できませんでした。通信を確認して再読み込みしてください。
        </p>
      </main>
    );
  }

  return (
    <WelcomePage
      onboardingStatus={profileQuery.data.onboarding_status}
      onStartIdea={async () => {
        if (userId === undefined) return;
        await setOnboardingStatus(getBrowserSupabaseClient(), userId, "skipped");
        await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
        void navigate("/planner");
      }}
      onStartHousehold={async () => {
        if (userId === undefined) return;
        await setOnboardingStatus(getBrowserSupabaseClient(), userId, "in_progress");
        await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
        void navigate("/onboarding");
      }}
    />
  );
}
