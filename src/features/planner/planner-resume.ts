import { plannerSteps, type PlannerStep } from "./model/planner-wizard";

/**
 * `/planner?resume=` の値の契約。
 *
 * 既存（意味を変えない）:
 * - `review`: 下書きが確認まで揃っていれば確認画面、揃っていなければ最初の未回答の質問を開く。
 * - 上記以外の既存値（`audience` など）: 最初の未回答の質問を開く。
 *
 * 追加（UX フォローアップ B-1）:
 * - `start`: 別の画面（緊急献立など）から、ホームを経由せず最初の未回答の質問を開く深リンク。
 *   扱いは `audience` などと同じ（最初の未回答の質問）。名前で用途を示すために分けた。
 *
 * `?resume=` はマウント時（mount 済みなら付いた時）に一度だけ読んで消す。開く step を決めて
 * ウィザードを開いたら、URL を `/planner` へ replace する（開いている step は state で持つ）。
 * - 履歴に `?resume=` 付きの entry は残らない。再読み込みや、privacy・生成・結果などから
 *   端末の戻るで戻ったときはホームになる。ホームの「続きから答える」と、最後に開いていた
 *   step の記憶（下の B-2）で 1 手で戻れる。
 * - 端末の戻るは履歴エントリで表さない。ウィザードが開いている間の戻る（POP）は
 *   PlannerRoutePage の useBlocker が止め、ウィザードを閉じてホームを出す。URL は触らない。
 */
export const PLANNER_RESUME_START = "start";

/** B-1: 緊急献立などから、ホームを経由せず最初の未回答の質問を開くリンク先 */
export const PLANNER_START_QUESTIONS_PATH = `/planner?resume=${PLANNER_RESUME_START}`;

/**
 * B-2: 利用者が最後に開いていた質問の step 名だけを覚える（回答の中身や個人情報は入れない）。
 * タブを閉じれば消える sessionStorage に、利用者ごとに分けて置く。
 */
export function plannerLastStepSessionKey(userId: string): string {
  return `kondate:planner-last-step:v1:${userId}`;
}

function isPlannerStep(value: string): value is PlannerStep {
  return (plannerSteps as readonly string[]).includes(value);
}

/** 覚えている step を読む。無い・壊れている・読めないときは null */
export function readPlannerLastStep(userId: string): PlannerStep | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(plannerLastStepSessionKey(userId));
  } catch {
    return null;
  }
  return raw !== null && isPlannerStep(raw) ? raw : null;
}

/** 開いている step を覚える。保存できない環境では何もしない（続きからは最初の未回答へ戻る） */
export function writePlannerLastStep(userId: string, step: PlannerStep): void {
  try {
    sessionStorage.setItem(plannerLastStepSessionKey(userId), step);
  } catch {
    // 容量超過・無効化された storage は既定の再開先へ戻すだけなので握りつぶす
  }
}

/**
 * 「続きから答える」で開く質問。
 * 覚えている step が、まだ答えていない必須の質問より先でなければそれを使う
 * （任意の質問を見ていた途中や、戻って答え直していた質問へ戻れる）。
 * 覚えが無い・無効・先へ飛んでしまう（別タブで下書きが変わった等）ときは最初の未回答の質問。
 */
export function resolvePlannerContinueStep(
  firstIncomplete: PlannerStep,
  lastStep: PlannerStep | null,
): PlannerStep {
  if (lastStep === null) return firstIncomplete;
  return plannerSteps.indexOf(lastStep) <= plannerSteps.indexOf(firstIncomplete)
    ? lastStep
    : firstIncomplete;
}
