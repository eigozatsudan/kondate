import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/use-auth";
import {
  acceptMenuVersion,
  deleteMenuGroup,
  historyKeys,
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

/** 代表献立のお気に入り付け外し。成功後に一覧を無効化する。 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: (command: { menuId: string; isFavorite: boolean }) =>
      setMenuFavorite(command.menuId, command.isFavorite),
    onSuccess: async () => {
      if (userId === undefined) return;
      await queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) });
    },
    retry: false,
  });
}

/** 「これに決めた」採用版切替。詳細画面からも再利用する。 */
export function useAcceptMenuVersion() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: (menuId: string) => acceptMenuVersion(menuId),
    onSuccess: async () => {
      if (userId === undefined) return;
      await queryClient.invalidateQueries({ queryKey: historyKeys.groups(userId) });
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
