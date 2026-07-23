import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./use-auth";
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

// RequireCompletedOnboarding は Plan 7 Task 6 で撤去した。
// 家族設定は任意になり、主要routeはRequireSessionだけを通る。
// 完了状態に応じた振り分けは "/" のRootEntryPageとWelcomePageが担う。
