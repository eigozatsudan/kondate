import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { menuRevalidationQueryKey } from "@/features/history/hooks/use-menu-revalidation";
import {
  householdKeys,
  householdSafetyChangedEvent,
  householdSafetyQueryPrefixes,
  householdSafetyRevisionKey,
  householdSafetyRevisionStorageKey,
  invalidateHouseholdSafetyDependents,
  invalidateHouseholdSafetyQueries,
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

it("H8: soft invalidate marks allergies and dislikes for the same user as stale", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userId = "user-a";
  const otherUserId = "user-b";
  const allergiesKey = householdKeys.allergies(userId, "member-1");
  const dislikesKey = householdKeys.dislikes(userId, "member-1");
  const otherUserAllergiesKey = householdKeys.allergies(otherUserId, "member-1");

  queryClient.setQueryData(allergiesKey, [{ id: "allergy-1" }]);
  queryClient.setQueryData(dislikesKey, [{ id: "dislike-1" }]);
  queryClient.setQueryData(otherUserAllergiesKey, [{ id: "allergy-other" }]);

  await invalidateHouseholdSafetyQueries(queryClient, userId);

  expect(queryClient.getQueryState(allergiesKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(dislikesKey)?.isInvalidated).toBe(true);
  // 他 user の allergies は prefix が一致しないため触れない
  expect(queryClient.getQueryState(otherUserAllergiesKey)?.isInvalidated).toBe(false);

  queryClient.clear();
});

it("HR3: historyRevalidation prefix matches menu-revalidation query keys", async () => {
  // 実キーは menuRevalidationQueryKey(menuId) = ["menu-revalidation", menuId]。
  // 旧 "history-revalidation" では invalidate がヒットせず DiD が死んでいた。
  expect(householdSafetyQueryPrefixes.historyRevalidation).toEqual(["menu-revalidation"]);
  expect(menuRevalidationQueryKey("menu-1")).toEqual(["menu-revalidation", "menu-1"]);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userId = "user-a";
  const menuRevalidationKey = menuRevalidationQueryKey("menu-1");
  const deadLegacyKey = ["history-revalidation", "menu-1"] as const;

  queryClient.setQueryData(menuRevalidationKey, { status: "valid" });
  queryClient.setQueryData(deadLegacyKey, { status: "valid" });

  await invalidateHouseholdSafetyQueries(queryClient, userId);

  expect(queryClient.getQueryState(menuRevalidationKey)?.isInvalidated).toBe(true);
  // 旧プレフィックスはもう invalidate 対象外（消費者なし）
  expect(queryClient.getQueryState(deadLegacyKey)?.isInvalidated).toBe(false);

  queryClient.clear();
});

it("H6: does not include dead current-safety prefix", () => {
  // 死んだ DiD キーを再導入しない（消費者は menu-revalidation / emergency-menus 等）
  expect(householdSafetyQueryPrefixes).not.toHaveProperty("currentSafety");
  expect(Object.values(householdSafetyQueryPrefixes)).not.toContainEqual(["current-safety"]);
});

it("H3: fires revision and event even when query invalidate throws", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userId = "user-h3";
  const eventSpy = vi.fn();
  window.addEventListener(householdSafetyChangedEvent, eventSpy);

  // invalidateQueries を throw させる（RQ 本体は通常 throw しないが soft 失敗経路を固定）
  const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    await originalInvalidate(filters);
    throw new Error("invalidate failed");
  });

  await expect(invalidateHouseholdSafetyDependents(queryClient, userId)).rejects.toThrow(
    "invalidate failed",
  );

  expect(eventSpy).toHaveBeenCalled();
  expect(localStorage.getItem(householdSafetyRevisionKey(userId))).toMatch(
    /^[0-9a-f-]{36}$/iu,
  );

  window.removeEventListener(householdSafetyChangedEvent, eventSpy);
  queryClient.clear();
});
