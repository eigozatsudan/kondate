import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthSessionPinMismatchError,
  resetAccessTokenPinGateForTests,
  setAccessTokenPinnedUserId,
} from "@/features/auth/session";
import {
  fetchReconcilableMenuSource,
  isReconcileShoppingStickyReusable,
  mutateShoppingItem,
} from "./shopping-api";

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
  sessionUserId?: string;
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
  const sessionUserId = options.sessionUserId ?? "user-a";
  const auth = {
    getSession: vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "token",
          user: { id: sessionUserId },
        },
      },
      error: null,
    }),
  };
  return { from, eqCalls, auth };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAccessTokenPinGateForTests();
});

afterEach(() => {
  resetAccessTokenPinGateForTests();
});

describe("fetchReconcilableMenuSource", () => {
  it("filters the menu query to target_mode='household' as a defense-in-depth layer", async () => {
    const { from, eqCalls, auth } = mockClient({
      menuRow: { id: MENU_ID, derivation_group_id: "group-1", version: 2 },
      sourceRows: [{ source_derivation_group_id: "group-1", source_menu_version: 1 }],
    });
    getBrowserSupabaseClientMock.mockReturnValue({ from, auth });

    const result = await fetchReconcilableMenuSource(MENU_ID, LIST_ID);

    expect(eqCalls).toEqual([
      ["id", MENU_ID],
      ["target_mode", "household"],
    ]);
    expect(result).toEqual({ sourceMenuId: MENU_ID, sourceMenuVersion: 2 });
  });

  it("returns null when the menu row is not visible under the household filter (e.g. idea menu)", async () => {
    const { from, auth } = mockClient({ menuRow: null });
    getBrowserSupabaseClientMock.mockReturnValue({ from, auth });

    const result = await fetchReconcilableMenuSource(MENU_ID, LIST_ID);

    expect(result).toBeNull();
  });

  it("R1: refuses PostgREST when pin user differs from client session", async () => {
    setAccessTokenPinnedUserId("user-a");
    const from = vi.fn();
    const auth = {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "token-b", user: { id: "user-b" } },
        },
        error: null,
      }),
    };
    getBrowserSupabaseClientMock.mockReturnValue({ from, auth });

    await expect(fetchReconcilableMenuSource(MENU_ID, LIST_ID)).rejects.toBeInstanceOf(
      AuthSessionPinMismatchError,
    );
    expect(from).not.toHaveBeenCalled();
  });
});

describe("mutateShoppingItem", () => {
  it("R1: refuses mutate RPC when pin user differs from client session", async () => {
    setAccessTokenPinnedUserId("user-a");
    const rpc = vi.fn();
    const auth = {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: "token-b", user: { id: "user-b" } },
        },
        error: null,
      }),
    };
    getBrowserSupabaseClientMock.mockReturnValue({ rpc, auth });

    await expect(
      mutateShoppingItem({
        listId: LIST_ID,
        expectedListVersion: 1,
        expectedSafetyFingerprint: "a".repeat(64),
        operation: "set_checked",
        itemId: "42000000-0000-4000-8000-000000000001",
        idempotencyKey: "43000000-0000-4000-8000-000000000001",
        payload: { isChecked: true },
      }),
    ).rejects.toBeInstanceOf(AuthSessionPinMismatchError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("isReconcileShoppingStickyReusable", () => {
  const base = {
    expectedListVersion: 3,
    sourceMenuId: MENU_ID,
    sourceMenuVersion: 2,
    idempotencyKey: "43000000-0000-4000-8000-000000000001",
    approval: { addKeys: ["a"], replaceItemIds: [], removeItemIds: [] },
    previewedQuantities: {
      add: [{ key: "a", quantityValue: 1, quantityText: "1本", pantryCheckRequired: false }],
      replace: [] as {
        itemId: string;
        quantityValue: number | null;
        quantityText: string;
        pantryCheckRequired: boolean;
      }[],
    },
  };

  it("rebuilds when previewed quantities change for the same approval key", () => {
    expect(
      isReconcileShoppingStickyReusable(base, {
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 2,
        approval: base.approval,
        previewedQuantities: {
          add: [{ key: "a", quantityValue: 3, quantityText: "3本", pantryCheckRequired: false }],
          replace: [],
        },
      }),
    ).toBe(false);
  });

  it("reuses sticky when only list version advanced", () => {
    expect(
      isReconcileShoppingStickyReusable(base, {
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 2,
        approval: base.approval,
        previewedQuantities: base.previewedQuantities,
      }),
    ).toBe(true);
  });
});
