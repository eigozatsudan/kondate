import { expect, it } from "vitest";
import {
  householdSafetyRevisionKey,
  householdSafetyRevisionStorageKey,
  isHouseholdSafetyRevisionStorageKey,
  isHouseholdSafetyRevisionStorageKeyForUser,
} from "./household-queries";

it("accepts legacy fixed key and any user-scoped prefix for cleanup (broad matcher)", () => {
  expect(isHouseholdSafetyRevisionStorageKey(householdSafetyRevisionStorageKey)).toBe(true);
  expect(isHouseholdSafetyRevisionStorageKey(householdSafetyRevisionKey("user-a"))).toBe(true);
  expect(isHouseholdSafetyRevisionStorageKey(householdSafetyRevisionKey("user-b"))).toBe(true);
  expect(isHouseholdSafetyRevisionStorageKey("other")).toBe(false);
  expect(isHouseholdSafetyRevisionStorageKey(null)).toBe(false);
});

it("binds storage invalidate to own userId only (H12)", () => {
  const userA = "user-a";
  const userB = "user-b";
  // レガシー固定は移行互換で許可
  expect(isHouseholdSafetyRevisionStorageKeyForUser(householdSafetyRevisionStorageKey, userA)).toBe(
    true,
  );
  expect(isHouseholdSafetyRevisionStorageKeyForUser(householdSafetyRevisionKey(userA), userA)).toBe(
    true,
  );
  // 他 user の key は受理しない（共有端末の誤 invalidate を防ぐ）
  expect(isHouseholdSafetyRevisionStorageKeyForUser(householdSafetyRevisionKey(userB), userA)).toBe(
    false,
  );
  expect(isHouseholdSafetyRevisionStorageKeyForUser(null, userA)).toBe(false);
  expect(isHouseholdSafetyRevisionStorageKeyForUser(householdSafetyRevisionKey(userA), "")).toBe(
    false,
  );
});
