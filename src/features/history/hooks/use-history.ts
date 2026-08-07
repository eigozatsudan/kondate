import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/use-auth";
import {
  acceptMenuVersion,
  deleteMenuGroup,
  historyKeys,
  listDerivationVersions,
  listHistoryGroups,
  setMenuFavorite,
} from "../api/history-api";

/** HR4: 採用 isSelected を他タブへ伝える BroadcastChannel 名 */
export const MENU_ACCEPT_BROADCAST_CHANNEL = "kondate:menu-accept";

type MenuAcceptBroadcastMessage = {
  userId: string;
  menuId: string;
  at: number;
};

/**
 * 採用後の menu-result 楽観更新（同一 user の兄弟 isSelected を false → 採用分 true）。
 * 同一タブ onSuccess と他タブ Broadcast 受信の両方から呼ぶ（HR4 / 既存 HR1 sibling clear）。
 */
export function applyAcceptMenuVersionLocalCache(
  queryClient: QueryClient,
  userId: string,
  menuId: string,
): void {
  // HR1: 同一 user の兄弟 menu-result キャッシュに residual isSelected:true が残ると
  // 案スイッチャーで非代表案が買い物 primary に誤昇格する。先に全員 false → 採用分 true。
  queryClient.setQueriesData(
    { queryKey: ["menu-result", userId] },
    (previous: { isSelected?: boolean } | undefined) => {
      if (previous === undefined || typeof previous !== "object") return previous;
      if (previous.isSelected !== true) return previous;
      return { ...previous, isSelected: false };
    },
  );
  queryClient.setQueriesData(
    { queryKey: ["menu-result", userId, menuId] },
    (previous: { isSelected?: boolean } | undefined) => {
      if (previous === undefined || typeof previous !== "object") return previous;
      return { ...previous, isSelected: true };
    },
  );
}

function parseMenuAcceptBroadcast(data: unknown): MenuAcceptBroadcastMessage | null {
  if (data === null || typeof data !== "object") return null;
  const userId: unknown = Reflect.get(data, "userId");
  const menuId: unknown = Reflect.get(data, "menuId");
  const at: unknown = Reflect.get(data, "at");
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof menuId !== "string" || menuId.length === 0) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { userId, menuId, at };
}

function broadcastMenuAccept(userId: string, menuId: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(MENU_ACCEPT_BROADCAST_CHANNEL);
    const message: MenuAcceptBroadcastMessage = { userId, menuId, at: Date.now() };
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel 失敗は他タブの focus 再取得 / 次の versions stale に委ねる
  }
}

/**
 * 他タブの採用完了を受けて menu-result / groups / versions を同期する。
 * 一覧（useHistoryGroups）と詳細（useAcceptMenuVersion）の両方から購読する（HR4）。
 */
function useMenuAcceptCrossTabSync(userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (userId === undefined || userId.length === 0) return;
    if (typeof BroadcastChannel === "undefined") return;

    const applyFromOtherTab = (menuId: string): void => {
      applyAcceptMenuVersionLocalCache(queryClient, userId, menuId);
      void queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) });
      void queryClient.invalidateQueries({
        queryKey: ["history", "versions", userId],
      });
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(MENU_ACCEPT_BROADCAST_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = parseMenuAcceptBroadcast(event.data);
        if (message === null) return;
        if (message.userId !== userId) return;
        applyFromOtherTab(message.menuId);
      };
    } catch {
      channel = null;
    }

    return () => {
      channel?.close();
    };
  }, [queryClient, userId]);
}

/** 派生グループ単位の履歴一覧。 */
export function useHistoryGroups() {
  const userId = useAuth().session?.user.id;
  // HR4: 履歴一覧でも他タブ採用を拾い、代表バッジの 30s stale を縮める
  useMenuAcceptCrossTabSync(userId);
  return useQuery({
    queryKey: historyKeys.groups(userId ?? "missing"),
    queryFn: () => listHistoryGroups(),
    enabled: userId !== undefined && userId.length > 0,
    staleTime: 30_000,
  });
}

/**
 * 同一派生グループ内の案一覧。案が2件以上のときスイッチャー表示に使う。
 * derivationGroupId が無い（結果未ロード）間は無効。
 */
export function useDerivationVersions(derivationGroupId: string | null | undefined) {
  const userId = useAuth().session?.user.id;
  const groupId = derivationGroupId ?? "";
  return useQuery({
    queryKey: historyKeys.versions(userId ?? "missing", groupId),
    queryFn: () => listDerivationVersions(groupId),
    enabled: userId !== undefined && userId.length > 0 && groupId.length > 0,
    staleTime: 15_000,
  });
}

/** 代表献立のお気に入り付け外し。成功後に一覧と結果キャッシュを無効化する。 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: (command: { menuId: string; isFavorite: boolean }) =>
      setMenuFavorite(command.menuId, command.isFavorite),
    onSuccess: async (_data, command) => {
      if (userId === undefined) return;
      // HIST-2: menu-result を残すと 30s stale 内の再マウントで星が DB と逆に戻る
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) }),
        queryClient.invalidateQueries({ queryKey: ["menu-result", userId, command.menuId] }),
      ]);
    },
    retry: false,
  });
}

/** 「この献立にする」採用版切替。詳細画面からも再利用する。 */
export function useAcceptMenuVersion() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  // HR4: 詳細タブでも他タブ採用を受け、isSelected / 案バッジを同期する
  useMenuAcceptCrossTabSync(userId);
  return useMutation({
    mutationFn: (menuId: string) => acceptMenuVersion(menuId),
    onSuccess: async (_void, menuId) => {
      if (userId === undefined) return;
      // 採用直後の UI は local accepted が正。menu-result を丸ごと invalidate すると
      // isSelected:false の再取得で「採用しました」が消えるため、isSelected だけ楽観更新し
      // 一覧・案バッジ用の versions/groups を先に無効化する。
      applyAcceptMenuVersionLocalCache(queryClient, userId, menuId);
      // HR4: 他タブへ採用を通知（同一タブには届かない。受信側が cache + invalidate）
      broadcastMenuAccept(userId, menuId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) }),
        queryClient.invalidateQueries({
          queryKey: ["history", "versions", userId],
        }),
      ]);
    },
    retry: false,
  });
}

/** 派生グループ一括削除。失敗時は呼び出し側がカードを残して再試行する。 */
export function useDeleteMenuGroup() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: (derivationGroupId: string) => deleteMenuGroup(derivationGroupId),
    onSuccess: async () => {
      if (userId === undefined) return;
      await queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) });
    },
    retry: false,
  });
}
