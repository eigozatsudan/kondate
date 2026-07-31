import { useEffect, useRef, useState } from "react";
import { selectGenerationProgressStageIndex, stageMessageAt } from "../model/progress-stages";

/** 経過再評価間隔（L12）。「約」ではない。 */
export const GENERATION_PROGRESS_TICK_MS = 1_000 as const;

export type GenerationProgressMessageArgs = {
  active: boolean;
  /**
   * finite な epoch ms、または null。
   * null = sticky クライアント now を 1 回 capture（tick 差し替え禁止・V-C1）。
   * processing は panel が resolveProcessingAnchorMs 済みの値を渡す。
   */
  anchorMs: number | null;
};

export type GenerationProgressView = {
  message: string;
  /** L1 適用後の表示 index */
  stageIndex: number;
};

function isUsableAnchor(anchorMs: number, nowMs: number): boolean {
  return Number.isFinite(anchorMs) && anchorMs <= nowMs + 5_000;
}

/**
 * 献立作成待ちの体感用進捗文言。
 * 同期初期評価（V-C2）・sticky null（V-C1）・前進のみ（L1）。
 */
export function useGenerationProgressMessage(
  args: GenerationProgressMessageArgs,
): GenerationProgressView {
  const { active, anchorMs } = args;
  const resolvedAnchorMsRef = useRef<number | null>(null);
  const maxStageIndexSeenRef = useRef(0);
  const [, setTick] = useState(0);

  // 描画ごとに同期計算する（初回を stage0 固定にしない・V-C2）
  let stageIndex = 0;
  let message = stageMessageAt(0);

  if (!active) {
    resolvedAnchorMsRef.current = null;
    maxStageIndexSeenRef.current = 0;
    // 非表示時の戻り値。失敗/完了後に古い stage 文言が残って誤認されないよう中立句へ（G12）。
    message = "確認できませんでした";
  } else {
    const nowMs = Date.now();
    // usable な anchor は毎回採用。null / 不正は sticky capture を維持（V-C1）。
    let resolved: number;
    if (anchorMs !== null && isUsableAnchor(anchorMs, nowMs)) {
      resolved = anchorMs;
      resolvedAnchorMsRef.current = anchorMs;
    } else if (resolvedAnchorMsRef.current !== null) {
      resolved = resolvedAnchorMsRef.current;
    } else {
      resolved = nowMs;
      resolvedAnchorMsRef.current = nowMs;
    }
    const elapsedMs = Math.max(0, nowMs - resolved);
    const calculated = selectGenerationProgressStageIndex(elapsedMs);
    stageIndex = Math.max(calculated, maxStageIndexSeenRef.current);
    maxStageIndexSeenRef.current = stageIndex;
    message = stageMessageAt(stageIndex);
  }

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, GENERATION_PROGRESS_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [active]);

  return { message, stageIndex };
}
