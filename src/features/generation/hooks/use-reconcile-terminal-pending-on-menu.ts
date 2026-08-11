import { useEffect } from "react";

import { reconcileTerminalPendingGeneration } from "../model/reconcile-terminal-pending";

/**
 * G-R1: 献立詳細（結果/履歴）の成功読込後、pending の status が
 * 同一 menuId の succeeded なら key 照合 clear する。
 * G2: 無条件 clear はしない（processing 中の別献立閲覧では keep）。
 */
export function useReconcileTerminalPendingOnMenu(
  userId: string | undefined,
  menuId: string | null,
  menuLoaded: boolean,
): void {
  useEffect(() => {
    if (userId === undefined || menuId === null || !menuLoaded) {
      return;
    }
    void reconcileTerminalPendingGeneration(userId, { matchMenuId: menuId });
  }, [userId, menuId, menuLoaded]);
}
