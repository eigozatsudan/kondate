import type { PendingGeneration } from "./pending-generation";

/**
 * 生成終端（失敗・条件競合）から idle に戻るときの遷移先。
 * new_menu は planner 下書きを直す文脈。regenerate_* は元献立（menus）へ戻す。
 * menus から「この一品だけ別案にする」が失敗したあと planner に落とすと、
 * 下書き文脈がなく操作不能になるのを防ぐ。
 *
 * U4 修正ラウンド1: options.resumeReview は「条件を直してやり直す」専用。
 * new_menu（= 戻り先が素の /planner）のときだけ既存の深リンク契約
 * `?resume=review`（下書きが確認まで揃っていれば review 固定、揃っていなければ
 * firstIncomplete）を足す。regenerate_* は /menus/:id へ戻すため対象外
 * （その画面に resume クエリの契約はない）。「最初からやり直す」は options を
 * 渡さずに呼び、ホーム着地のままにする。
 */
export function generationReturnPath(
  pending: PendingGeneration | null,
  options?: { resumeReview?: boolean },
): string {
  if (pending?.kind === "regenerate_menu" || pending?.kind === "regenerate_dish") {
    return `/menus/${pending.request.sourceMenuId}`;
  }
  return options?.resumeReview === true ? "/planner?resume=review" : "/planner";
}
