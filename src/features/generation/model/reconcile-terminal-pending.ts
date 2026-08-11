import { getGenerationStatus } from "../api/generation-api";
import { clearPendingGeneration, readPendingGeneration } from "./pending-generation";

export type ReconcileTerminalPendingResult = "none" | "kept" | "cleared";

type ReconcileOptions = {
  /**
   * 結果/履歴 URL 用。succeeded かつ status.menuId が一致するときだけ clear。
   * 省略時は planner/regenerate 入口用で、not_started/processing 以外を clear する。
   */
  matchMenuId?: string;
  now?: Date;
  /** テスト注入。省略時は generation-api の GET status。 */
  getStatus?: typeof getGenerationStatus;
};

/**
 * G-R1: terminal 済み sticky pending を片付ける。G2 の無条件 clear は戻さない。
 *
 * - `matchMenuId` あり: succeeded かつ menuId 一致のときのみ clear
 *   （結果/履歴閲覧。別献立・processing 中は keep）
 * - `matchMenuId` なし: not_started / processing 以外なら clear
 *   （planner/regenerate 入口: 完了済み key を再開専用にしない）
 * - status GET 失敗: keep（G1: processing 復旧を焼かない）
 */
export async function reconcileTerminalPendingGeneration(
  userId: string,
  options: ReconcileOptions = {},
): Promise<ReconcileTerminalPendingResult> {
  const now = options.now ?? new Date();
  const pending = readPendingGeneration(userId, now);
  if (pending === null) {
    return "none";
  }

  const getStatus = options.getStatus ?? getGenerationStatus;
  try {
    const status = await getStatus(pending.request.idempotencyKey);
    if (options.matchMenuId !== undefined) {
      if (status.status === "succeeded" && status.menuId === options.matchMenuId) {
        clearPendingGeneration();
        return "cleared";
      }
      return "kept";
    }
    // planner / regenerate: 進行中のみ再開、terminal は clear して新規作成を許す
    if (status.status === "not_started" || status.status === "processing") {
      return "kept";
    }
    clearPendingGeneration();
    return "cleared";
  } catch {
    return "kept";
  }
}
