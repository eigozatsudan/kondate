import type { QueryClient } from "@tanstack/react-query";

export const householdKeys = {
  all: ["household"] as const,
  profile: (userId: string) => ["household", "profile", userId] as const,
  members: (userId: string) => ["household", "members", userId] as const,
  allergies: (userId: string, memberId: string) =>
    ["household", "allergies", userId, memberId] as const,
  dislikes: (userId: string, memberId: string) =>
    ["household", "dislikes", userId, memberId] as const,
};

export const householdSafetyChangedEvent = "kondate:household-safety-changed" as const;
/** レガシー固定キー（移行中読取互換）。新規書込は householdSafetyRevisionKey(userId) を使う。 */
export const householdSafetyRevisionStorageKey = "kondate:household-safety-revision" as const;
/** U4-003: 端末共有時の cross-user 誤無効化を避ける user-scoped key */
export function householdSafetyRevisionKey(userId: string): string {
  return `${householdSafetyRevisionStorageKey}:${userId}`;
}
/**
 * storage キーが安全 revision 系か（固定 or 任意 user-scoped prefix）。
 * ログアウト掃除など「全 user キーを対象にしたい」経路専用。
 * 他タブの invalidate 判定には isHouseholdSafetyRevisionStorageKeyForUser を使う（H12）。
 */
export function isHouseholdSafetyRevisionStorageKey(key: string | null): boolean {
  if (key === null) return false;
  return (
    key === householdSafetyRevisionStorageKey ||
    key.startsWith(`${householdSafetyRevisionStorageKey}:`)
  );
}

/**
 * 自 user の revision 書込だけを受理する（レガシー固定キーは移行互換で許可）。
 * 共有端末で別アカウントの user-scoped キーによる誤 invalidate を防ぐ（H12）。
 */
export function isHouseholdSafetyRevisionStorageKeyForUser(
  key: string | null,
  userId: string,
): boolean {
  if (key === null || userId.length === 0) return false;
  return key === householdSafetyRevisionStorageKey || key === householdSafetyRevisionKey(userId);
}
export const householdSafetyQueryPrefixes = {
  currentSafety: ["current-safety"],
  menuResult: ["menu-result"],
  history: ["history"],
  historyRevalidation: ["history-revalidation"],
  generation: ["generation"],
  shopping: ["shopping"],
  // 緊急献立候補は家族安全条件に依存するため、settings/onboarding 更新時に必ず無効化する。
  emergencyMenus: ["emergency-menus"],
} as const;
export async function invalidateHouseholdSafetyQueries(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  // allergies / dislikes は memberId 付きキー。user 単位 prefix で dual-tab 一覧も追随させる（H8）。
  // members と同様 userId 束縛し、共有端末で他アカウントの cache を誤って落とさない。
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: householdKeys.members(userId) }),
    queryClient.invalidateQueries({ queryKey: ["household", "allergies", userId] }),
    queryClient.invalidateQueries({ queryKey: ["household", "dislikes", userId] }),
    ...Object.values(householdSafetyQueryPrefixes).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  ]);
}

export async function invalidateHouseholdSafetyDependents(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  await invalidateHouseholdSafetyQueries(queryClient, userId);
  try {
    localStorage.setItem(householdSafetyRevisionKey(userId), crypto.randomUUID());
  } catch {
    // Current-tab query invalidation still prevents a stale action when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
}
