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
  // H6: 旧 ["current-safety"] は src 内に RQ 消費者が無く死んだ DiD だったため削除。
  // history 再検証は historyRevalidation（menu-revalidation）。server current-safety は Function 側。
  menuResult: ["menu-result"],
  history: ["history"],
  // 実キーは use-menu-revalidation の ["menu-revalidation", menuId]。
  // 旧名 "history-revalidation" はリポジトリ内に消費者なし（HR3: 死んだ DiD 配線の修正）。
  historyRevalidation: ["menu-revalidation"],
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

/**
 * 家族安全条件の変更後に依存 cache を無効化し、他タブ／履歴ゲートへ revision+event を届ける。
 * H3: revision/event は query invalidate より先に発火する。invalidate が throw しても
 * Realtime 欠落時の hard recheck 窓（最大〜60s soft poll）を縮める。
 * 呼び出し側は query 失敗を soft 扱いにしてよいが、成功コピーは invalidate 成否と分ける（H4）。
 */
export async function invalidateHouseholdSafetyDependents(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  try {
    localStorage.setItem(householdSafetyRevisionKey(userId), crypto.randomUUID());
  } catch {
    // storage 不可でも event と query invalidate は続ける
  }
  window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
  await invalidateHouseholdSafetyQueries(queryClient, userId);
}
