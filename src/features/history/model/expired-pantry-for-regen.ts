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
