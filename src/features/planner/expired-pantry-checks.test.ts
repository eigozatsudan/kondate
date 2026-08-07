import { afterEach, beforeEach, expect, it } from "vitest";
import {
  confirmExpiredPantryItem,
  createPlannerAttempt,
  filterExpiredPantryChecksForSelections,
  hasExpiredPantryConfirmation,
  hasSessionExpiredPantryConfirmation,
  persistSessionExpiredPantryChecks,
  persistSessionExpiredPantryConfirmation,
} from "./expired-pantry-checks";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

it("filterExpiredPantryChecksForSelections は選択中 ID だけを残す (P1)", () => {
  const attempt = createPlannerAttempt();
  const withChecks = confirmExpiredPantryItem(
    confirmExpiredPantryItem(attempt, "a", new Date("2026-07-11T03:00:00.000Z")),
    "b",
    new Date("2026-07-11T03:00:00.000Z"),
  );
  expect(
    filterExpiredPantryChecksForSelections(withChecks.expiredPantryChecks, [{ pantryItemId: "b" }]),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
  expect(filterExpiredPantryChecksForSelections(withChecks.expiredPantryChecks, [])).toEqual([]);
});

it("PE8: session 当日確認は attempt 無しでも hasExpiredPantryConfirmation が true", () => {
  const now = new Date("2026-07-11T03:00:00.000Z");
  const userId = "72000000-0000-4000-8000-000000000001";
  expect(hasExpiredPantryConfirmation(null, userId, "pantry-a", now)).toBe(false);
  persistSessionExpiredPantryConfirmation(userId, "pantry-a", now);
  expect(hasSessionExpiredPantryConfirmation(userId, "pantry-a", now)).toBe(true);
  expect(hasExpiredPantryConfirmation(null, userId, "pantry-a", now)).toBe(true);
  expect(hasExpiredPantryConfirmation(null, userId, "pantry-b", now)).toBe(false);
});

it("PE8: persistSessionExpiredPantryChecks merges attempt checks for CTA handoff", () => {
  const now = new Date("2026-07-11T03:00:00.000Z");
  const userId = "72000000-0000-4000-8000-000000000001";
  const attempt = confirmExpiredPantryItem(createPlannerAttempt(), "x", now);
  persistSessionExpiredPantryChecks(userId, attempt.expiredPantryChecks, now);
  expect(hasSessionExpiredPantryConfirmation(userId, "x", now)).toBe(true);
});
