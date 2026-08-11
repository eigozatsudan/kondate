import { Navigate, Outlet, useLocation } from "react-router";
import { LivePendingMain } from "@/shared/ui/feedback";
import { useAuthLoadingDeadline } from "./use-auth-loading-deadline";
import { useAuth } from "./use-auth";
import { sanitizeReturnPath } from "./auth-flow";

export function RequireSession() {
  const auth = useAuth();
  const location = useLocation();
  const { showLoading, loadingTimedOut } = useAuthLoadingDeadline(auth.status);

  if (showLoading) {
    // L6/L10: RootGate / Welcome / RootEntry の pending と同型。保護 deep-link の C5 待ちを SR に通知
    return <LivePendingMain message="ログイン状態を確認しています…" />;
  }
  // L1: C5 15s 超過の loading も未ログインとして login へ（AuthProvider 主経路の二次防衛）
  if (loadingTimedOut || auth.status === "unauthenticated" || auth.session === null) {
    const returnTo = sanitizeReturnPath(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return (
    <>
      {/* C12: probe timeout 中は shell を維持しつつ再試行を促す（storage clear しない） */}
      {auth.sessionProbeDegraded ? (
        <p className="page-frame type-small" role="status">
          接続の確認に時間がかかっています。画面をそのままにするか、再読み込みしてからもう一度お試しください。
        </p>
      ) : null}
      <Outlet />
    </>
  );
}

// RequireCompletedOnboarding は Plan 7 Task 6 で撤去した。
// 家族設定は任意になり、主要 route は RequireSession だけを通る。
// 公開 "/" は RootGatePage（未ログイン: 無料 LP / ログイン済み: RootEntryPage）。
// welcome / planner 等の振り分けは RootEntryPage と Welcome が担う。
