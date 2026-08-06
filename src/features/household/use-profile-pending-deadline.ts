import { useEffect, useState } from "react";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";

/**
 * L2: session 成立後の profile 取得 hang を auth C5 と同尺（15s）で打ち切る。
 * hang は isError にならないため、deadline 超過を再試行 UI へ落とす二次防衛。
 * not_started への推測変換はしない（呼び出し側が timeout を error 相当として扱う）。
 */
export function useProfilePendingDeadline(isPending: boolean): {
  /** true のあいだは「確認中」UI */
  showPending: boolean;
  /** deadline 超過で pending を打ち切った */
  pendingTimedOut: boolean;
} {
  const [pendingTimedOut, setPendingTimedOut] = useState(false);

  useEffect(() => {
    if (!isPending) {
      setPendingTimedOut(false);
      return;
    }
    setPendingTimedOut(false);
    const timerId = window.setTimeout(() => {
      setPendingTimedOut(true);
    }, COLD_START_SESSION_DEADLINE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [isPending]);

  return {
    showPending: isPending && !pendingTimedOut,
    pendingTimedOut: isPending && pendingTimedOut,
  };
}
