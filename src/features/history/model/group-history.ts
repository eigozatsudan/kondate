/** 派生グループ単位で履歴カードに載せる代表献立。 */
export type HistoryGroup = {
  derivationGroupId: string;
  versionCount: number;
  representative: {
    id: string;
    title: string;
    createdAt: string;
    selectedAt: string | null;
    isFavorite: boolean;
  };
};

/** menus + dishes 埋め込みの行形（API 生データ）。 */
export type HistoryMenuRow = {
  id: string;
  derivation_group_id: string;
  version: number;
  created_at: string;
  is_selected: boolean;
  selected_at: string | null;
  is_favorite: boolean;
  dishes: Array<{ name: string; position: number }>;
};

/**
 * 同一 derivation_group_id を1カードにまとめ、
 * is_selected があればそれを、なければ最新 version を代表として返す。
 * グループ同士は代表の createdAt 降順。
 */
export function groupMenuRows(rows: readonly HistoryMenuRow[]): HistoryGroup[] {
  const grouped = new Map<string, HistoryMenuRow[]>();
  for (const row of rows) {
    grouped.set(row.derivation_group_id, [...(grouped.get(row.derivation_group_id) ?? []), row]);
  }
  const groups: HistoryGroup[] = [];
  for (const [derivationGroupId, versions] of grouped.entries()) {
    if (versions.length === 0) continue;
    const newestFirst = versions.toSorted((left, right) => right.version - left.version);
    const selected = newestFirst.find((row) => row.is_selected);
    const chosen = selected ?? newestFirst[0];
    if (chosen === undefined) continue;
    const title = chosen.dishes
      .toSorted((left, right) => left.position - right.position)
      .map((dish) => dish.name)
      .join("・");
    groups.push({
      derivationGroupId,
      versionCount: versions.length,
      representative: {
        id: chosen.id,
        title,
        createdAt: chosen.created_at,
        selectedAt: chosen.selected_at,
        isFavorite: chosen.is_favorite,
      },
    });
  }
  return groups.toSorted((left, right) =>
    right.representative.createdAt.localeCompare(left.representative.createdAt),
  );
}
