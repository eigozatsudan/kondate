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
      {/* C12: probe/pin 乖離中は shell を維持しつつ再試行・再ログインを促す（自動 privilege 昇格はしない） */}
      {auth.sessionProbeDegraded ? (
        <div className="page-frame type-small stack" role="status">
          <p>
            ログイン状態の確認に時間がかかっているか、別の状態と食い違っています。安全のため一部の操作を止めています。画面をそのままにするか、再読み込みするか、下のボタンからログインし直してください。
          </p>
          {auth.recoverDegradedSession !== undefined ? (
            <p>
              <button
                type="button"
                className="text-button min-h-11 min-w-11"
                onClick={auth.recoverDegradedSession}
              >
                ログインし直す
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      <Outlet />
    </>
  );
}

// RequireCompletedOnboarding は Plan 7 Task 6 で撤去した。
// 家族設定は任意になり、主要 route は RequireSession だけを通る。
// 公開 "/" は RootGatePage（未ログイン: 無料 LP / ログイン済み: RootEntryPage）。
// welcome / planner 等の振り分けは RootEntryPage と Welcome が担う。
