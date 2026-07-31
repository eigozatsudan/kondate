/**
 * 献立作成待ちの体感用段階表。
 * サーバ工程（プロンプト / OpenRouter / repair）と一致しない。契約・status には載せない。
 */

export type GenerationProgressStage = {
  readonly afterMs: number;
  readonly message: string;
};

export const GENERATION_PROGRESS_STAGES: readonly GenerationProgressStage[] = [
  { afterMs: 0, message: "条件を確認しています" },
  { afterMs: 3_000, message: "献立の指示を組み立てています" },
  { afterMs: 8_000, message: "AI に献立案を聞いています" },
  { afterMs: 30_000, message: "組み合わせと段取りを整えています" },
  { afterMs: 45_000, message: "仕上げの確認をしています" },
] as const;

/** stage0 と同じ文言。noUncheckedIndexedAccess 用のリテラル fallback（! 禁止）。 */
const FALLBACK_PROGRESS_MESSAGE = "条件を確認しています" as const;

/**
 * 段階 index から文言を返す。範囲外は stage0 文言。
 * 本番コードでは non-null assertion を使わない（V-I1）。
 */
export function stageMessageAt(index: number): string {
  const stage = GENERATION_PROGRESS_STAGES[index] ?? GENERATION_PROGRESS_STAGES[0];
  if (stage === undefined) {
    return FALLBACK_PROGRESS_MESSAGE;
  }
  return stage.message;
}

/** 経過 ms から段階 index を返す（L1 ガードなし。表示 max はフック側）。 */
export function selectGenerationProgressStageIndex(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 0;
  }
  let index = 0;
  for (let i = 0; i < GENERATION_PROGRESS_STAGES.length; i += 1) {
    const stage = GENERATION_PROGRESS_STAGES[i];
    if (stage === undefined) {
      break;
    }
    if (elapsedMs >= stage.afterMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function selectGenerationProgressMessage(elapsedMs: number): string {
  return stageMessageAt(selectGenerationProgressStageIndex(elapsedMs));
}

/**
 * processing の startedAt を hook 向け anchor に正規化する（V-I4 / L2）。
 * NaN または now より 5s 超未来は null（hook が sticky now にフォールバック）。
 * 遠過去はそのまま（最終帯になり得る・意図的）。
 */
export function resolveProcessingAnchorMs(startedAt: string, nowMs: number): number | null {
  const parsed = Date.parse(startedAt);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed > nowMs + 5_000) {
    return null;
  }
  return parsed;
}
