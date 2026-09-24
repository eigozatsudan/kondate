/**
 * 入力リセット前の確認文。ウィザード下部の「入力をリセット」と
 * ホームの「最初から」（U3）で同じ文言・同じ確認手順を使うため 1 か所に置く。
 */
export const PLANNER_RESET_CONFIRM_MESSAGE =
  "入力した献立条件をすべて消して最初からやり直します。よろしいですか？";

/**
 * 誤タップで下書きを消さないよう、ブラウザ確認で同意されたときだけ true を返す。
 * window が無い環境（SSR 等）では従来のウィザード実装と同じく確認を省いて true とする。
 */
export function confirmPlannerReset(): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(PLANNER_RESET_CONFIRM_MESSAGE);
}
