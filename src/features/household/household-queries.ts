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
export const householdSafetyRevisionStorageKey = "kondate:household-safety-revision" as const;
export const householdSafetyQueryPrefixes = {
  currentSafety: ["current-safety"],
  menuResult: ["menu-result"],
  history: ["history"],
  historyRevalidation: ["history-revalidation"],
  generation: ["generation"],
  shopping: ["shopping"],
} as const;
export async function invalidateHouseholdSafetyQueries(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: householdKeys.members(userId) }),
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
    localStorage.setItem(householdSafetyRevisionStorageKey, crypto.randomUUID());
  } catch {
    // Current-tab query invalidation still prevents a stale action when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
}
