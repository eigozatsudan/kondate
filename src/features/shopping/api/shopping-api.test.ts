import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReconcilableMenuSource } from "./shopping-api";

const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

const MENU_ID = "40000000-0000-4000-8000-000000000001";
const LIST_ID = "41000000-0000-4000-8000-000000000001";

/**
 * menus クエリの eq チェーンに渡された (column, value) の呼び出し順序を
 * そのまま記録するモック。Task 5 の HTTP/DB 拒否に対する防御層として、
 * target_mode='household' がクエリへ必ず含まれることを固定する
 * （brief step 11: 「fetchReconcilableMenuSourceのmenu queryにも
 * target_mode='household'を加える」）。
 */
function mockClient(options: {
  menuRow: { id: string; derivation_group_id: string; version: number } | null;
  sourceRows?: readonly { source_derivation_group_id: string; source_menu_version: number }[];
}) {
  const eqCalls: [string, unknown][] = [];
  const menuChain = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return menuChain;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: options.menuRow, error: null })),
  };
  const sourcesChain = {
    eq: vi.fn(() => Promise.resolve({ data: options.sourceRows ?? [], error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "shopping_list_sources") {
      return { select: vi.fn(() => sourcesChain) };
    }
    return { select: vi.fn(() => menuChain) };
  });
  return { from, eqCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchReconcilableMenuSource", () => {
  it("filters the menu query to target_mode='household' as a defense-in-depth layer", async () => {
    const { from, eqCalls } = mockClient({
      menuRow: { id: MENU_ID, derivation_group_id: "group-1", version: 2 },
      sourceRows: [{ source_derivation_group_id: "group-1", source_menu_version: 1 }],
    });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    const result = await fetchReconcilableMenuSource(MENU_ID, LIST_ID);

    expect(eqCalls).toEqual([
      ["id", MENU_ID],
      ["target_mode", "household"],
    ]);
    expect(result).toEqual({ sourceMenuId: MENU_ID, sourceMenuVersion: 2 });
  });

  it("returns null when the menu row is not visible under the household filter (e.g. idea menu)", async () => {
    const { from } = mockClient({ menuRow: null });
    getBrowserSupabaseClientMock.mockReturnValue({ from });

    const result = await fetchReconcilableMenuSource(MENU_ID, LIST_ID);

    expect(result).toBeNull();
  });
});
