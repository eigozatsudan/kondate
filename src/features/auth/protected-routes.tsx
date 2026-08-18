import { Navigate, Outlet, useLocation } from "react-router";
import { LivePendingMain } from "@/shared/ui/feedback";
import { DegradedSessionRecovery } from "./degraded-session-recovery";
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
  // C4: pin/probe 乖離中は Outlet を出さない。history / household 等が JWT-B で動く窓を閉じる。
  if (auth.sessionProbeDegraded) {
    return <DegradedSessionRecovery recoverDegradedSession={auth.recoverDegradedSession} />;
  }
  return <Outlet />;
}

// RequireCompletedOnboarding は Plan 7 Task 6 で撤去した。
// 家族設定は任意になり、主要 route は RequireSession だけを通る。
// 公開 "/" は RootGatePage（未ログイン: 無料 LP / ログイン済み: RootEntryPage）。
// welcome / planner 等の振り分けは RootEntryPage と Welcome が担う。
