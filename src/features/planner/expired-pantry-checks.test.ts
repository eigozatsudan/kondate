import { afterEach, beforeEach, expect, it } from "vitest";
import {
  confirmExpiredPantryItem,
  createPlannerAttempt,
  currentlyExpiredPantryItemIds,
  expiredPantryConfirmSessionKey,
  filterExpiredPantryChecksForSelections,
  hasCurrentExpiredConfirmation,
  hasExpiredPantryConfirmation,
  hasSessionExpiredPantryConfirmation,
  loadSessionExpiredPantryChecks,
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
  const now = new Date("2026-07-11T03:00:00.000Z");
  const attempt = createPlannerAttempt();
  const withChecks = confirmExpiredPantryItem(
    confirmExpiredPantryItem(attempt, "a", now),
    "b",
    now,
  );
  // 選択中でも現在期限切れでない ID は surplus として落とす（expiresOn soft 更新後）
  expect(
    filterExpiredPantryChecksForSelections(
      withChecks.expiredPantryChecks,
      [{ pantryItemId: "a" }, { pantryItemId: "b" }],
      new Set(["b"]),
      now,
    ),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
  // 非選択は期限切れでも落とす
  expect(
    filterExpiredPantryChecksForSelections(
      withChecks.expiredPantryChecks,
      [{ pantryItemId: "b" }],
      new Set(["a", "b"]),
      now,
    ),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
  expect(
    filterExpiredPantryChecksForSelections(
      withChecks.expiredPantryChecks,
      [],
      new Set(["a", "b"]),
      now,
    ),
  ).toEqual([]);
});

it("P8: filterExpiredPantryChecksForSelections は JST 当日以外の checkedAt を落とす", () => {
  const today = new Date("2026-07-11T03:00:00.000Z"); // JST 2026-07-11
  const checks = [
    { pantryItemId: "a", checkedAt: "2026-07-10T03:00:00.000Z" }, // 昨日
    { pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }, // 当日
    { pantryItemId: "c", checkedAt: "not-a-date" },
  ];
  expect(
    filterExpiredPantryChecksForSelections(
      checks,
      [{ pantryItemId: "a" }, { pantryItemId: "b" }, { pantryItemId: "c" }],
      new Set(["a", "b", "c"]),
      today,
    ),
  ).toEqual([{ pantryItemId: "b", checkedAt: "2026-07-11T03:00:00.000Z" }]);
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

it("P7: session の不正 checkedAt は drop し getJstDateKey throw せず未確認扱い", () => {
  const now = new Date("2026-07-11T03:00:00.000Z");
  const userId = "72000000-0000-4000-8000-000000000001";
  sessionStorage.setItem(
    expiredPantryConfirmSessionKey(userId),
    JSON.stringify({
      dayKey: "2026-07-11",
      checks: [
        { pantryItemId: "bad", checkedAt: "nope" },
        { pantryItemId: "good", checkedAt: "2026-07-11T03:00:00.000Z" },
      ],
    }),
  );
  // 例外にならず、不正件は落として有効件だけ残る（サーバ Number.isNaN 同型 fail-closed）
  expect(loadSessionExpiredPantryChecks(userId, now)).toEqual([
    { pantryItemId: "good", checkedAt: "2026-07-11T03:00:00.000Z" },
  ]);
  expect(hasExpiredPantryConfirmation(null, userId, "bad", now)).toBe(false);
  expect(hasExpiredPantryConfirmation(null, userId, "good", now)).toBe(true);
});

it("P7: attempt 上の不正 checkedAt も hasCurrentExpiredConfirmation が false（throw しない）", () => {
  const now = new Date("2026-07-11T03:00:00.000Z");
  const attempt = {
    ...createPlannerAttempt(),
    expiredPantryChecks: [{ pantryItemId: "x", checkedAt: "not-a-date" }],
  };
  expect(hasCurrentExpiredConfirmation(attempt, "x", now)).toBe(false);
  expect(hasExpiredPantryConfirmation(attempt, undefined, "x", now)).toBe(false);
});

it("P7: persistSessionExpiredPantryChecks は不正 checkedAt を session に書かない", () => {
  const now = new Date("2026-07-11T03:00:00.000Z");
  const userId = "72000000-0000-4000-8000-000000000001";
  persistSessionExpiredPantryChecks(
    userId,
    [
      { pantryItemId: "bad", checkedAt: "x" },
      { pantryItemId: "good", checkedAt: "2026-07-11T03:00:00.000Z" },
    ],
    now,
  );
  expect(loadSessionExpiredPantryChecks(userId, now)).toEqual([
    { pantryItemId: "good", checkedAt: "2026-07-11T03:00:00.000Z" },
  ]);
});
