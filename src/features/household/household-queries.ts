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
/**
 * H-R3: revision setItem 失敗時に storage イベントが飛ばないため、open tabs へ hard を補う。
 * 同一タブには届けない（ブラウザ仕様）。storage 成功時も best-effort で二重 hard は無害。
 */
export const HOUSEHOLD_SAFETY_BROADCAST_CHANNEL = "kondate:household-safety" as const;
/** U4-003: 端末共有時の cross-user 誤無効化を避ける user-scoped key */
export function householdSafetyRevisionKey(userId: string): string {
  return `${householdSafetyRevisionStorageKey}:${userId}`;
}

type HouseholdSafetyBroadcastMessage = {
  userId: string;
  at: number;
};

function parseHouseholdSafetyBroadcast(data: unknown): HouseholdSafetyBroadcastMessage | null {
  if (data === null || typeof data !== "object") return null;
  const msgUserId: unknown = Reflect.get(data, "userId");
  const at: unknown = Reflect.get(data, "at");
  if (typeof msgUserId !== "string" || msgUserId.length === 0) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { userId: msgUserId, at };
}

/** revision 変更を open tabs へ best-effort 通知（H-R3）。失敗は storage / Realtime / soft poll に委ねる。 */
export function postHouseholdSafetyBroadcast(userId: string): void {
  if (userId.length === 0) return;
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(HOUSEHOLD_SAFETY_BROADCAST_CHANNEL);
    const message: HouseholdSafetyBroadcastMessage = { userId, at: Date.now() };
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel 不可環境は storage / focus / Realtime に委ねる
  }
}

/**
 * 他タブの安全条件変更を BroadcastChannel で受け取り onChange する（H-R3）。
 * 戻り値は unsubscribe。同一 user 以外は無視（H12 と同方向）。
 */
export function subscribeHouseholdSafetyBroadcast(
  userId: string,
  onChange: () => void,
): () => void {
  if (userId.length === 0) return () => {};
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(HOUSEHOLD_SAFETY_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseHouseholdSafetyBroadcast(event.data);
      if (message === null) return;
      if (message.userId !== userId) return;
      onChange();
    };
  } catch {
    return () => {};
  }
  return () => {
    channel?.close();
  };
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
 * H-R3: setItem 失敗時は storage イベントが飛ばないため BroadcastChannel で open tabs へ hard を補う。
 * 呼び出し側は query 失敗を soft 扱いにしてよいが、成功コピーは invalidate 成否と分ける（H4）。
 */
export async function invalidateHouseholdSafetyDependents(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  try {
    localStorage.setItem(householdSafetyRevisionKey(userId), crypto.randomUUID());
  } catch {
    // storage 不可でも event / BroadcastChannel / query invalidate は続ける
  }
  // H-R3: storage 成功時も best-effort。失敗時の cross-tab 欠落を BC で DiD する。
  postHouseholdSafetyBroadcast(userId);
  window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
  await invalidateHouseholdSafetyQueries(queryClient, userId);
}
