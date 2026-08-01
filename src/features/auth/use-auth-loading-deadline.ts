import { useEffect, useState } from "react";
import { COLD_START_SESSION_DEADLINE_MS } from "./auth-provider";

/**
 * L1 / C5: auth.status が loading のまま C5 全体上限を超えたら fail-closed する。
 * AuthProvider の 15s deadline が主経路。ここは shell（RootGate / RequireSession）の
 * 二次防衛で、provider 側タイマーが武装できなかった場合でも LP / login へ進める。
 */
export function useAuthLoadingDeadline(status: "loading" | "authenticated" | "unauthenticated"): {
  /** true のあいだは「確認中」UI を出す */
  showLoading: boolean;
  /** deadline 超過で loading を打ち切った */
  loadingTimedOut: boolean;
} {
  const isLoading = status === "loading";
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    setLoadingTimedOut(false);
    const timerId = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [isLoading]);

  return {
    showLoading: isLoading && !loadingTimedOut,
    loadingTimedOut: isLoading && loadingTimedOut,
  };
}
