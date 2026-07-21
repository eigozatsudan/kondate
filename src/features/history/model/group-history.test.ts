import { describe, expect, it } from "vitest";
import { groupMenuRows, type HistoryMenuRow } from "./group-history";

function row(partial: Partial<HistoryMenuRow> & Pick<HistoryMenuRow, "id">): HistoryMenuRow {
  return {
    derivation_group_id: "group-1",
    version: 1,
    created_at: "2026-07-11T09:00:00Z",
    is_selected: false,
    selected_at: null,
    is_favorite: false,
    dishes: [{ name: "鶏の照り焼き", position: 1 }],
    ...partial,
  };
}

describe("groupMenuRows", () => {
  it("derivation group ごとに1件にまとめ、採用版を代表にする", () => {
    const groups = groupMenuRows([
      row({
        id: "menu-1",
        version: 1,
        created_at: "2026-07-11T09:00:00Z",
        dishes: [{ name: "古い案", position: 1 }],
      }),
      row({
        id: "menu-2",
        version: 2,
        created_at: "2026-07-11T10:00:00Z",
        is_selected: true,
        selected_at: "2026-07-11T10:05:00Z",
        is_favorite: true,
        dishes: [
          { name: "副菜", position: 2 },
          { name: "採用した献立", position: 1 },
        ],
      }),
      row({
        id: "menu-3",
        version: 3,
        created_at: "2026-07-11T11:00:00Z",
        dishes: [{ name: "最新未採用", position: 1 }],
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      derivationGroupId: "group-1",
      versionCount: 3,
      representative: {
        id: "menu-2",
        title: "採用した献立・副菜",
        createdAt: "2026-07-11T10:00:00Z",
        selectedAt: "2026-07-11T10:05:00Z",
        isFavorite: true,
      },
    });
  });

  it("未採用なら最新 version を代表にし、グループは代表 createdAt 降順", () => {
    const groups = groupMenuRows([
      row({
        id: "old-group",
        derivation_group_id: "group-old",
        version: 1,
        created_at: "2026-07-10T08:00:00Z",
        dishes: [{ name: "古いグループ", position: 1 }],
      }),
      row({
        id: "new-v1",
        derivation_group_id: "group-new",
        version: 1,
        created_at: "2026-07-11T08:00:00Z",
        dishes: [{ name: "新グループ旧版", position: 1 }],
      }),
      row({
        id: "new-v2",
        derivation_group_id: "group-new",
        version: 2,
        created_at: "2026-07-11T12:00:00Z",
        dishes: [{ name: "新グループ最新", position: 1 }],
      }),
    ]);

    expect(groups.map((group) => group.derivationGroupId)).toEqual(["group-new", "group-old"]);
    expect(groups[0]?.representative).toMatchObject({
      id: "new-v2",
      title: "新グループ最新",
    });
  });
});
