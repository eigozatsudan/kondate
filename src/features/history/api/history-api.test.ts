import { beforeEach, describe, expect, it, vi } from "vitest";
import { listDerivationVersions, listHistoryGroups } from "./history-api";

const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

function mockClient(options: { data: readonly Record<string, unknown>[] | null; error?: unknown }) {
  const chain = {
    order: vi.fn(() => Promise.resolve({ data: options.data, error: options.error ?? null })),
    eq: vi.fn(() => chain),
  };
  // eq 後も order で解決する（listDerivationVersions）。listHistoryGroups は order のみ。
  chain.eq = vi.fn(() => chain);
  const select = vi.fn<(columns: string) => typeof chain>(() => chain);
  const from = vi.fn(() => ({ select }));
  return { from, select, chain };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listHistoryGroups", () => {
  it("includes target_mode in the select so the authoritative mode reaches the group model", async () => {
    const { from, select, chain } = mockClient({
      data: [
        {
          id: "menu-1",
          derivation_group_id: "group-1",
          version: 1,
          created_at: "2026-07-11T09:00:00Z",
          is_selected: true,
          selected_at: "2026-07-11T09:05:00Z",
          is_favorite: false,
          target_mode: "idea",
          dishes: [{ name: "アイデア献立", position: 1 }],
        },
      ],
    });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    const groups = await listHistoryGroups();

    const selectCall = select.mock.calls[0]?.[0] as string;
    expect(selectCall).toContain("target_mode");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    // DB row の target_mode がそのまま group モデルの representative.targetMode へ写る。
    expect(groups[0]?.representative.targetMode).toBe("idea");
  });

  it("maps household rows through to the group model unchanged", async () => {
    const { from } = mockClient({
      data: [
        {
          id: "menu-2",
          derivation_group_id: "group-2",
          version: 1,
          created_at: "2026-07-11T09:00:00Z",
          is_selected: true,
          selected_at: "2026-07-11T09:05:00Z",
          is_favorite: true,
          target_mode: "household",
          dishes: [{ name: "家族の献立", position: 1 }],
        },
      ],
    });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    const groups = await listHistoryGroups();

    expect(groups[0]?.representative).toMatchObject({
      id: "menu-2",
      title: "家族の献立",
      targetMode: "household",
      isFavorite: true,
    });
  });

  it("throws a Japanese error when the query fails", async () => {
    const { from } = mockClient({ data: null, error: { message: "boom" } });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    await expect(listHistoryGroups()).rejects.toThrow("履歴を読み込めませんでした");
  });
});

describe("listDerivationVersions", () => {
  it("returns version-ordered summaries with dish titles and parent", async () => {
    const { from, select, chain } = mockClient({
      data: [
        {
          id: "menu-1",
          version: 1,
          created_at: "2026-07-11T09:00:00Z",
          is_selected: true,
          parent_menu_id: null,
          dishes: [
            { name: "副菜", position: 2 },
            { name: "主菜", position: 1 },
          ],
        },
        {
          id: "menu-2",
          version: 2,
          created_at: "2026-07-11T10:00:00Z",
          is_selected: false,
          parent_menu_id: "menu-1",
          dishes: [{ name: "別案", position: 1 }],
        },
      ],
    });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    const versions = await listDerivationVersions("group-1");

    expect(select.mock.calls[0]?.[0] as string).toContain("parent_menu_id");
    expect(chain.eq).toHaveBeenCalledWith("derivation_group_id", "group-1");
    expect(chain.order).toHaveBeenCalledWith("version", { ascending: true });
    expect(versions).toEqual([
      {
        id: "menu-1",
        version: 1,
        title: "主菜・副菜",
        isSelected: true,
        createdAt: "2026-07-11T09:00:00Z",
        parentMenuId: null,
      },
      {
        id: "menu-2",
        version: 2,
        title: "別案",
        isSelected: false,
        createdAt: "2026-07-11T10:00:00Z",
        parentMenuId: "menu-1",
      },
    ]);
  });

  it("throws a Japanese error when the query fails", async () => {
    const { from } = mockClient({ data: null, error: { message: "boom" } });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    await expect(listDerivationVersions("group-1")).rejects.toThrow(
      "案の一覧を読み込めませんでした",
    );
  });

  it("returns empty array when data is null without error", async () => {
    const { from } = mockClient({ data: null });
    getBrowserSupabaseClientMock.mockReturnValue({ from });
    await expect(listDerivationVersions("group-1")).resolves.toEqual([]);
  });
});
