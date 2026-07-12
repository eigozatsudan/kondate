import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { getProfile } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { useAuth } from "./auth-provider";
import { sanitizeReturnPath } from "./auth-flow";

export function RequireSession() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") {
    return <main className="page-frame">ログイン状態を確認しています…</main>;
  }
  if (auth.status === "unauthenticated" || auth.session === null) {
    const returnTo = sanitizeReturnPath(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <Outlet />;
}

export function RequireCompletedOnboarding() {
  const auth = useAuth();
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
    return <main className="page-frame">初回設定を確認しています…</main>;
  }
  if (profileQuery.isError) {
    return (
      <main className="page-frame">
        <p className="error-message" role="alert">
          初回設定を確認できませんでした。通信を確認して再読み込みしてください。
        </p>
      </main>
    );
  }
  if (profileQuery.data.onboarding_status !== "complete") {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
