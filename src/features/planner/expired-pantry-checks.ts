import type { ExpiredPantryConfirmation } from "@shared/contracts/generation";
import type { PantryItem } from "@shared/contracts/pantry";
import { getJstDateKey } from "@shared/time/jst";

// サーバ GenerationContext の expiredPantryChecks と同形。browser は contracts を正とする。
export type ExpiredPantryCheck = ExpiredPantryConfirmation;

export type PlannerAttempt = {
  idempotencyKey: string;
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  /** Plus 品質モード「くわしく作る」。Free でも UI は出せるがサーバが 403。 */
  qualityMode: boolean;
};

export function createPlannerAttempt(): PlannerAttempt {
  return {
    idempotencyKey: crypto.randomUUID(),
    expiredPantryChecks: [],
    qualityMode: false,
  };
}

export function isPastEnteredExpiry(item: PantryItem, now: Date): boolean {
  return item.expiresOn !== null && item.expiresOn < getJstDateKey(now);
}

export function hasCurrentExpiredConfirmation(
  attempt: PlannerAttempt,
  pantryItemId: string,
  now: Date,
): boolean {
  const today = getJstDateKey(now);
  return attempt.expiredPantryChecks.some(
    (item) =>
      item.pantryItemId === pantryItemId && getJstDateKey(new Date(item.checkedAt)) === today,
  );
}

export function confirmExpiredPantryItem(
  attempt: PlannerAttempt,
  pantryItemId: string,
  now: Date,
): PlannerAttempt {
  return {
    ...attempt,
    qualityMode: attempt.qualityMode,
    expiredPantryChecks: [
      ...attempt.expiredPantryChecks.filter((item) => item.pantryItemId !== pantryItemId),
      { pantryItemId, checkedAt: now.toISOString() },
    ],
  };
}

/**
 * サーバ validateTransientChecks は「選択中 ∩ 期限切れ」と confirmation の exact-set を要求する。
 * 同一 attempt 内で確認済み→解除しても checks を attempt に残し再選択時 dialog を抑止する設計のため、
 * 送信直前に選択中 ID へ絞り込む（P1: 非選択 extra を載せない）。
 */
export function filterExpiredPantryChecksForSelections(
  checks: readonly ExpiredPantryCheck[],
  selections: readonly { pantryItemId: string }[],
): ExpiredPantryCheck[] {
  const selected = new Set(selections.map((selection) => selection.pantryItemId));
  return checks.filter((check) => selected.has(check.pantryItemId));
}
