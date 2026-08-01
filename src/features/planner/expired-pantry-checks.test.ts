import { expect, it } from "vitest";
import {
  confirmExpiredPantryItem,
  createPlannerAttempt,
  filterExpiredPantryChecksForSelections,
} from "./expired-pantry-checks";

it("filterExpiredPantryChecksForSelections は選択中 ID だけを残す (P1)", () => {
  const attempt = createPlannerAttempt();
  const withChecks = confirmExpiredPantryItem(
    confirmExpiredPantryItem(attempt, "a", new Date("2026-07-11T03:00:00.000Z")),
    "b",
    new Date("2026-07-11T03:00:00.000Z"),
  );
  expect(
    filterExpiredPantryChecksForSelections(withChecks.expiredPantryChecks, [
      { pantryItemId: "b" },
    ]),
  ).toEqual([
    { pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" },
  ]);
  expect(
    filterExpiredPantryChecksForSelections(withChecks.expiredPantryChecks, []),
  ).toEqual([]);
});
