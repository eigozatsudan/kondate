import { afterEach, beforeEach, expect, it } from "vitest";
import {
  confirmExpiredPantryItem,
  createPlannerAttempt,
  currentlyExpiredPantryItemIds,
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

it("filterExpiredPantryChecksForSelections は選択中 ∩ 現在期限切れだけを残す (P1)", () => {
  const attempt = createPlannerAttempt();
  const withChecks = confirmExpiredPantryItem(
    confirmExpiredPantryItem(attempt, "a", new Date("2026-07-11T03:00:00.000Z")),
    "b",
    new Date("2026-07-11T03:00:00.000Z"),
  );
  // 選択中でも現在期限切れでない ID は surplus として落とす（expiresOn soft 更新後）
  expect(
    filterExpiredPantryChecksForSelections(
      withChecks.expiredPantryChecks,
      [{ pantryItemId: "a" }, { pantryItemId: "b" }],
      new Set(["b"]),
    ),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
  // 非選択は期限切れでも落とす
  expect(
    filterExpiredPantryChecksForSelections(
      withChecks.expiredPantryChecks,
      [{ pantryItemId: "b" }],
      new Set(["a", "b"]),
    ),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
  expect(
    filterExpiredPantryChecksForSelections(withChecks.expiredPantryChecks, [], new Set(["a", "b"])),
  ).toEqual([]);
});

it("currentlyExpiredPantryItemIds は入力期限が過去の ID だけを返す (P1)", () => {
  const now = new Date("2026-07-11T03:00:00.000Z"); // JST 2026-07-11
  expect(
    currentlyExpiredPantryItemIds(
      [
        { id: "past", expiresOn: "2026-07-10" },
        { id: "today", expiresOn: "2026-07-11" },
        { id: "future", expiresOn: "2026-07-12" },
        { id: "none", expiresOn: null },
      ],
      now,
    ),
  ).toEqual(new Set(["past"]));
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
