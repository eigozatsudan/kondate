import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/use-auth";
import {
  acceptMenuVersion,
  deleteMenuGroup,
  historyKeys,
  listDerivationVersions,
  listHistoryGroups,
  setMenuFavorite,
} from "../api/history-api";

/** 派生グループ単位の履歴一覧。 */
export function useHistoryGroups() {
  const userId = useAuth().session?.user.id;
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
  return useMutation({
    mutationFn: (menuId: string) => acceptMenuVersion(menuId),
    onSuccess: async (_void, menuId) => {
      if (userId === undefined) return;
      // 採用直後の UI は local accepted が正。menu-result を丸ごと invalidate すると
      // isSelected:false の再取得で「採用しました」が消えるため、isSelected だけ楽観更新し
      // 一覧・案バッジ用の versions/groups を先に無効化する。
      queryClient.setQueriesData(
        { queryKey: ["menu-result", userId, menuId] },
        (previous: { isSelected?: boolean } | undefined) => {
          if (previous === undefined || typeof previous !== "object") return previous;
          return { ...previous, isSelected: true };
        },
      );
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
