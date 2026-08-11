import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { menuRevalidationQueryKey } from "@/features/history/hooks/use-menu-revalidation";
import {
  HOUSEHOLD_SAFETY_BROADCAST_CHANNEL,
  householdKeys,
  householdSafetyChangedEvent,
  householdSafetyQueryPrefixes,
  householdSafetyRevisionKey,
  householdSafetyRevisionStorageKey,
  invalidateHouseholdSafetyDependents,
  invalidateHouseholdSafetyQueries,
  isHouseholdSafetyRevisionStorageKey,
  isHouseholdSafetyRevisionStorageKeyForUser,
  postHouseholdSafetyBroadcast,
  subscribeHouseholdSafetyBroadcast,
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
  expect(localStorage.getItem(householdSafetyRevisionKey(userId))).toMatch(/^[0-9a-f-]{36}$/iu);

  window.removeEventListener(householdSafetyChangedEvent, eventSpy);
  queryClient.clear();
});

/** テスト用: postMessage を購読者へ配送する最小 BroadcastChannel スタブ */
class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set();
    set.add(this);
    FakeBroadcastChannel.channels.set(name, set);
  }

  postMessage(data: unknown): void {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    if (peers === undefined) return;
    for (const peer of peers) {
      // 同一タブには届けない（ブラウザ仕様）
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent<unknown>);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    FakeBroadcastChannel.channels.clear();
  }
}

it("H-R3: posts BroadcastChannel even when revision setItem throws", async () => {
  FakeBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userId = "user-hr3";
  const received: unknown[] = [];
  const unsubscribe = subscribeHouseholdSafetyBroadcast(userId, () => {
    received.push("hard");
  });
  // 他 peer として直接 post を拾う検証用リスナ
  const peer = new FakeBroadcastChannel(HOUSEHOLD_SAFETY_BROADCAST_CHANNEL);
  peer.onmessage = (event) => {
    received.push(event.data);
  };

  const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });

  await invalidateHouseholdSafetyDependents(queryClient, userId);

  // setItem 失敗でも BC で他タブ相当へ届く（H-R3）
  expect(received.some((item) => item === "hard")).toBe(true);
  expect(
    received.some(
      (item) => typeof item === "object" && item !== null && Reflect.get(item, "userId") === userId,
    ),
  ).toBe(true);

  unsubscribe();
  peer.close();
  setItemSpy.mockRestore();
  FakeBroadcastChannel.reset();
  vi.unstubAllGlobals();
  queryClient.clear();
});

it("H-R3: ignores BroadcastChannel messages for other users", () => {
  FakeBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

  const onChange = vi.fn();
  const unsubscribe = subscribeHouseholdSafetyBroadcast("user-a", onChange);
  // 他 user は無視（H12 と同方向）
  postHouseholdSafetyBroadcast("user-b");
  expect(onChange).not.toHaveBeenCalled();
  // post は別 channel インスタンス経由なので購読側へ届く
  postHouseholdSafetyBroadcast("user-a");
  expect(onChange).toHaveBeenCalledTimes(1);

  unsubscribe();
  FakeBroadcastChannel.reset();
  vi.unstubAllGlobals();
});
