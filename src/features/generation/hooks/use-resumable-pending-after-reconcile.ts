import { useEffect, useState } from "react";

import { readPendingGeneration } from "../model/pending-generation";
import { reconcileTerminalPendingGeneration } from "../model/reconcile-terminal-pending";

export type ResumablePendingDisplay = {
  /**
   * home/review の「作成中＝再開のみ」UI を出すか。
   * G-R4: localStorage 非 null だけでは true にしない。G-R1 同型 reconcile で kept のときだけ。
   */
  hasResumablePending: boolean;
  /**
   * pending 無しは即 true。pending ありは reconcile 完了まで false。
   * init のホーム優先分岐と pending コピー表示を、照合前に確定させない。
   */
  pendingDisplayReady: boolean;
};

const READY_NONE: ResumablePendingDisplay = {
  hasResumablePending: false,
  pendingDisplayReady: true,
};

const WAITING: ResumablePendingDisplay = {
  hasResumablePending: false,
  pendingDisplayReady: false,
};

/**
 * 同期スナップショット。pending が無ければ GET 不要で表示確定。
 * pending ありは "needs-reconcile"（effect で G-R1 同型 status GET）。
 */
function syncDisplay(userId: string | undefined): ResumablePendingDisplay | "needs-reconcile" {
  if (userId === undefined) {
    return READY_NONE;
  }
  if (readPendingGeneration(userId, new Date()) === null) {
    return READY_NONE;
  }
  return "needs-reconcile";
}

/**
 * G-R4: planner home/review 表示前に G-R1 と同型の terminal reconcile を行う。
 *
 * - pending 無し → 即 ready / hasResumable=false（GET しない・render 同期）
 * - status が not_started / processing、または GET 失敗 → kept → 再開 UI（G1/G2 維持）
 * - terminal（failed / succeeded 等）→ clear 済み → 再開 UI を出さない（新規作成可と一致）
 *
 * matchMenuId は付けない（planner 入口と同型）。結果/履歴の match clear は別 hook。
 */
export function useResumablePendingAfterReconcile(
  userId: string | undefined,
): ResumablePendingDisplay {
  const snapshot = syncDisplay(userId);
  const needsReconcile = snapshot === "needs-reconcile";
  // reconcile 完了結果。pending 無し経路では使わない
  const [reconciled, setReconciled] = useState<ResumablePendingDisplay | null>(null);

  useEffect(() => {
    if (!needsReconcile || userId === undefined) {
      // sticky が消えた・user 未確定: 旧 kept を持ち越さない
      setReconciled(null);
      return;
    }
    let cancelled = false;
    // 新しい pending 照合のたびに waiting へ戻す（直前 kept の誤表示防止）
    setReconciled(null);
    void reconcileTerminalPendingGeneration(userId).then((outcome) => {
      if (cancelled) return;
      // kept のみ再開 UI。cleared / none は terminal 掃除後で新規作成可 → コピーなし
      setReconciled({
        hasResumablePending: outcome === "kept",
        pendingDisplayReady: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, needsReconcile]);

  if (!needsReconcile) {
    return snapshot;
  }
  return reconciled ?? WAITING;
}
