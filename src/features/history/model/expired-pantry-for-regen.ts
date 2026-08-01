import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerSubmission } from "@shared/contracts/planner";
import { isPastEnteredExpiry } from "@/features/planner/expired-pantry-checks";

export type ExpiredPantryForRegen = {
  pantryItemId: string;
  name: string;
};

/**
 * design §269: 再生成では元の期限確認を引き継がず、選択済みかつ期限経過の
 * 在庫を今回の実物確認対象として列挙する。
 *
 * live に無い selection は列挙しない（欠落は hasMissingPantrySelectionsForRegeneration
 * で別途ゲートする。HR5: 黙って continue したまま送信すると server 422）。
 */
export function listExpiredPantryForRegeneration(
  sourceSubmission: PlannerSubmission | null,
  livePantry: readonly PantryItem[],
  now: Date,
): readonly ExpiredPantryForRegen[] {
  if (sourceSubmission === null) return [];
  const byId = new Map(livePantry.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: ExpiredPantryForRegen[] = [];
  for (const selection of sourceSubmission.pantrySelections) {
    if (seen.has(selection.pantryItemId)) continue;
    seen.add(selection.pantryItemId);
    const item = byId.get(selection.pantryItemId);
    if (item === undefined) continue;
    if (!isPastEnteredExpiry(item, now)) continue;
    result.push({ pantryItemId: item.id, name: item.name });
  }
  return result;
}

/**
 * HR5: source submission の pantrySelections が live に欠けるとき true。
 * server loadPantryForSubmission は件数一致必須のため、欠落のまま開始すると 422。
 * UI は再生成を閉じ、「条件を変えて作り直す」へ誘導する。
 */
export function hasMissingPantrySelectionsForRegeneration(
  sourceSubmission: PlannerSubmission | null,
  livePantry: readonly PantryItem[],
): boolean {
  if (sourceSubmission === null) return false;
  if (sourceSubmission.pantrySelections.length === 0) return false;
  const liveIds = new Set(livePantry.map((item) => item.id));
  const seen = new Set<string>();
  for (const selection of sourceSubmission.pantrySelections) {
    if (seen.has(selection.pantryItemId)) continue;
    seen.add(selection.pantryItemId);
    if (!liveIds.has(selection.pantryItemId)) return true;
  }
  return false;
}
