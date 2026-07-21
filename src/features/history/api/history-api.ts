import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { groupMenuRows, type HistoryGroup, type HistoryMenuRow } from "../model/group-history";

export type { HistoryGroup, HistoryMenuRow } from "../model/group-history";

export const historyKeys = {
  all: ["history"] as const,
  groups: (userId: string) => ["history", "groups", userId] as const,
};

function historyError(message: string): Error {
  return new Error(message);
}

/** 所有者 RLS 下の menus を派生グループ単位へ畳み込む。 */
export async function listHistoryGroups(): Promise<HistoryGroup[]> {
  const supabase = getBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("menus")
    .select(
      "id,derivation_group_id,version,created_at,is_selected,selected_at,is_favorite,dishes(name,position)",
    )
    .order("created_at", { ascending: false });
  if (error !== null) throw historyError("履歴を読み込めませんでした");
  const rows: HistoryMenuRow[] = data.map((row) => ({
    id: row.id,
    derivation_group_id: row.derivation_group_id,
    version: row.version,
    created_at: row.created_at,
    is_selected: row.is_selected,
    selected_at: row.selected_at,
    is_favorite: row.is_favorite,
    // 埋め込みは配列。欠落時は空として扱いタイトルを壊さない
    dishes: Array.isArray(row.dishes)
      ? row.dishes.map((dish) => ({ name: dish.name, position: dish.position }))
      : [],
  }));
  return groupMenuRows(rows);
}

/** グループ内の採用版を差し替える RPC。 */
export async function acceptMenuVersion(menuId: string): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  const { error } = await supabase.rpc("accept_menu_version", { p_menu_id: menuId });
  if (error !== null) throw historyError("採用状態を更新できませんでした");
}

/** 派生グループごと履歴を削除する RPC。 */
export async function deleteMenuGroup(derivationGroupId: string): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  const { error } = await supabase.rpc("delete_menu_group", {
    p_derivation_group_id: derivationGroupId,
  });
  if (error !== null) throw historyError("履歴を削除できませんでした");
}

/**
 * 代表献立のお気に入りを付け外しする。
 * is_favorite は authenticated に UPDATE 許可された列（menu_core）。
 */
export async function setMenuFavorite(menuId: string, isFavorite: boolean): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  const { error } = await supabase
    .from("menus")
    .update({ is_favorite: isFavorite })
    .eq("id", menuId);
  if (error !== null) throw historyError("お気に入りを更新できませんでした");
}
