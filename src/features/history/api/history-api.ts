import { targetModeSchema } from "@shared/contracts/planner";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { groupMenuRows, type HistoryGroup, type HistoryMenuRow } from "../model/group-history";

export type { HistoryGroup, HistoryMenuRow } from "../model/group-history";

export const historyKeys = {
  all: ["history"] as const,
  groups: (userId: string) => ["history", "groups", userId] as const,
  /** 派生グループ内の案一覧（結果/詳細の案スイッチャー）。 */
  versions: (userId: string, derivationGroupId: string) =>
    ["history", "versions", userId, derivationGroupId] as const,
};

/** グループ内の1案。結果画面のチップ表示と /menus/:id 遷移に使う。 */
export type DerivationVersionSummary = {
  id: string;
  version: number;
  title: string;
  isSelected: boolean;
  createdAt: string;
  /** 再生成元。初回案は null。 */
  parentMenuId: string | null;
};

function historyError(message: string): Error {
  return new Error(message);
}

/**
 * PostgREST が error なしで data:null を返す経路でも map が TypeError にならないよう
 * 空配列へ畳む（C10）。生成型は non-null でも実行時契約を優先する。
 */
function rowsOrEmpty<T>(data: T[] | null | undefined): T[] {
  if (data == null) return [];
  return data;
}

/** 所有者 RLS 下の menus を派生グループ単位へ畳み込む。 */
export async function listHistoryGroups(): Promise<HistoryGroup[]> {
  const supabase = getBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("menus")
    .select(
      "id,derivation_group_id,version,created_at,is_selected,selected_at,is_favorite,target_mode,dishes(name,position)",
    )
    .order("created_at", { ascending: false });
  if (error !== null) throw historyError("履歴を読み込めませんでした");
  const rows: HistoryMenuRow[] = data.map((row) => {
    // target_mode はDB制約で household|idea のいずれかしか入らないが、履歴一覧
    // badge・詳細分岐の権威ある判定元として使う値のため受信側でも zod で確定させる。
    // 未知の値が来た場合は household 側の安全表示を誤って外さないよう idea 側へ
    // 倒す（家族安全情報が誤って表示される方向にはfailしない）。
    const targetModeParsed = targetModeSchema.safeParse(row.target_mode);
    return {
      id: row.id,
      derivation_group_id: row.derivation_group_id,
      version: row.version,
      created_at: row.created_at,
      is_selected: row.is_selected,
      selected_at: row.selected_at,
      is_favorite: row.is_favorite,
      target_mode: targetModeParsed.success ? targetModeParsed.data : "idea",
      // 埋め込みは配列。欠落時は空として扱いタイトルを壊さない
      dishes: Array.isArray(row.dishes)
        ? row.dishes.map((dish) => ({ name: dish.name, position: dish.position }))
        : [],
    };
  });
  return groupMenuRows(rows);
}

/**
 * 同一 derivation_group 内の全案を version 昇順で返す。
 * 案スイッチャー用。2件未満なら呼び出し側は UI を出さない。
 */
export async function listDerivationVersions(
  derivationGroupId: string,
): Promise<DerivationVersionSummary[]> {
  const supabase = getBrowserSupabaseClient();
  const { data, error } = await supabase
    .from("menus")
    .select("id,version,created_at,is_selected,parent_menu_id,dishes(name,position)")
    .eq("derivation_group_id", derivationGroupId)
    .order("version", { ascending: true });
  if (error !== null) throw historyError("案の一覧を読み込めませんでした");
  return rowsOrEmpty(data).map((row) => {
    const dishes = Array.isArray(row.dishes)
      ? row.dishes.map((dish) => ({ name: dish.name, position: dish.position }))
      : [];
    const title = dishes
      .toSorted((left, right) => left.position - right.position)
      .map((dish) => dish.name)
      .join("・");
    return {
      id: row.id,
      version: row.version,
      title: title.length > 0 ? title : "献立",
      isSelected: row.is_selected,
      createdAt: row.created_at,
      parentMenuId: row.parent_menu_id,
    };
  });
}

/**
 * グループ内の採用版を差し替える RPC。
 * RPC 自体は所有権と is_selected 排他のみ（現行 safety は見ない）。
 * 呼び出し側（履歴詳細）が revalidation checked+actionable でゲートする（HR3）。
 */
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
