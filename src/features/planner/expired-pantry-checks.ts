import type { PantryItem } from "@shared/contracts/pantry";
import type { ExpiredPantryCheck } from "@shared/safety/generation-context";
import { getJstDateKey } from "@shared/time/jst";

export type PlannerAttempt = {
  idempotencyKey: string;
  expiredPantryChecks: readonly ExpiredPantryCheck[];
};

export function createPlannerAttempt(): PlannerAttempt {
  return { idempotencyKey: crypto.randomUUID(), expiredPantryChecks: [] };
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
    expiredPantryChecks: [
      ...attempt.expiredPantryChecks.filter((item) => item.pantryItemId !== pantryItemId),
      { pantryItemId, checkedAt: now.toISOString() },
    ],
  };
}
