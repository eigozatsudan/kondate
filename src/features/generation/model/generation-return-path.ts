import type { PendingGeneration } from "./pending-generation";

/**
 * 生成終端（失敗・条件競合）から idle に戻るときの遷移先。
 * new_menu は planner 下書きを直す文脈。regenerate_* は元献立（menus）へ戻す。
 * menus から「この一品だけ別案にする」が失敗したあと planner に落とすと、
 * 下書き文脈がなく操作不能になるのを防ぐ。
 */
export function generationReturnPath(pending: PendingGeneration | null): string {
  if (pending?.kind === "regenerate_menu" || pending?.kind === "regenerate_dish") {
    return `/menus/${pending.request.sourceMenuId}`;
  }
  return "/planner";
}
