import { plannerSteps, type PlannerStep } from "./model/planner-wizard";

/**
 * `/planner?resume=` の値の契約。
 *
 * 既存（意味を変えない）:
 * - `review`: 下書きが確認まで揃っていれば確認画面、揃っていなければ最初の未回答の質問を開く。
 * - 上記以外の既存値（`audience` など）: 最初の未回答の質問を開く。
 *
 * 追加（UX フォローアップ B-1 / B-3）:
 * - `start`: 別の画面から「質問を始める」深リンク。最初の未回答の質問を開く。
 *   端末の戻るでホームへ戻れるよう、開いたあと自分の履歴エントリをホーム（`/planner`）に
 *   置き換え、その上にウィザードの印（`home`）を積む。
 * - `home`: ホームのボタン（続きから・最初から・今日の献立をつくる）でウィザードを開いたときに
 *   積む履歴エントリの印。同じ画面の中ではボタンが開く質問を決める。戻る・進むで同じ画面の
 *   このエントリへ来たときは「続きから」と同じ質問で開き直す。再読み込みや別の画面から
 *   戻って新しく開いたときはホームを出し、URL を `/planner` に置き換える
 *   （生成画面などから戻ったときに、確認や空の 1 問目へいきなり入らないため）。
 */
export const PLANNER_RESUME_START = "start";
export const PLANNER_RESUME_HOME = "home";

/** B-1: 緊急献立などから、ホームを経由せず最初の未回答の質問を開くリンク先 */
export const PLANNER_START_QUESTIONS_PATH = `/planner?resume=${PLANNER_RESUME_START}`;
/** B-3: ホームからウィザードを開いたときに積む履歴エントリ */
export const PLANNER_WIZARD_HOME_ENTRY_PATH = `/planner?resume=${PLANNER_RESUME_HOME}`;

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
