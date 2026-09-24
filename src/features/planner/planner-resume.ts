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
 *   開いている間は URL に残す（`review` と同じく、再読み込みでもウィザードのまま）。
 *
 * 端末の戻るは履歴エントリで表さない。ウィザードが開いている間の戻る（POP）は
 * PlannerRoutePage の useBlocker が止め、ウィザードを閉じてホームを出す。そのとき
 * `?resume=` 付きの URL は `/planner` に置き換え、ホームと URL を一致させる。
 *
 * `?resume=` の深リンクは履歴 entry ごとに一度だけ効く。同じ画面の読み込み中（JS の
 * セッション）に一度ウィザードを開くのに使った entry へ、別画面（生成・結果・privacy など）
 * から戻る操作で戻ってきたときは、ウィザードを開き直さずホームを出して `/planner` に置き換える
 * （開き直すと、戻るたびに質問が出て「ホームへ戻る」ための戻るが 1 回増えるため）。
 * 再読み込みでは覚えが消えるので、再読み込みした `?resume=` はこれまでどおりウィザードを開く。
 */
export const PLANNER_RESUME_START = "start";

// 一度ウィザードを開くのに使った `?resume=` の履歴 entry（location.key）。
// location.key は entry ごとの乱数で個人情報を含まない。モジュール内だけに置き、保存しない。
const usedResumeEntryKeys = new Set<string>();

/** `?resume=` の entry でウィザードを開いたことを覚える */
export function markPlannerResumeEntryUsed(locationKey: string): void {
  usedResumeEntryKeys.add(locationKey);
}

/** テスト用: 使用済み entry の覚えを消す（モジュールの状態がテスト間で残るため） */
export function resetPlannerResumeEntriesForTests(): void {
  usedResumeEntryKeys.clear();
}

/** この `?resume=` の entry が、すでにウィザードを開くのに使われたか */
export function isPlannerResumeEntryUsed(locationKey: string): boolean {
  return usedResumeEntryKeys.has(locationKey);
}

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
