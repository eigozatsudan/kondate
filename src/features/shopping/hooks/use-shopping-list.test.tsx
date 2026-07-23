import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShoppingList, useShoppingSafetyGate } from "./use-shopping-list";

const fetchActiveShoppingListMock = vi.hoisted(() => vi.fn());
const revalidateActiveShoppingListMock = vi.hoisted(() => vi.fn());

vi.mock("../api/shopping-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/shopping-api")>();
  return {
    ...original,
    fetchActiveShoppingList: fetchActiveShoppingListMock,
    revalidateActiveShoppingList: revalidateActiveShoppingListMock,
  };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = { on: () => api, subscribe: () => api, unsubscribe: vi.fn() };
      return api;
    },
    removeChannel: vi.fn(),
    auth: {
      // 所有者が取れない場合は必ず閉じる契約（fail closed）。
      // ここでは所有者を返し、gateがreadyへ進めることだけを確認する。
      getUser: () => Promise.resolve({ data: { user: { id: "owner-1" } }, error: null }),
    },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchActiveShoppingListMock.mockResolvedValue(null);
  revalidateActiveShoppingListMock.mockResolvedValue({
    status: "valid",
    safetyFingerprint: "current",
    checkedSourceMenuIds: [],
    currentLabelWarnings: [],
    issues: [],
  });
});

/**
 * useShoppingList / useShoppingSafetyGate は menuId や targetMode を一切
 * 受け取らないユーザースコープの hook である。idea献立からの家族安全情報
 * 漏洩を防ぐ境界は「これらの hook を mount しないこと」自体（brief step 11:
 * 「household bodyだけがuseMenuRevalidation、active-list/reconcilable query、
 * shopping pending replay hookをmountする」）であり、hook側にmenu/mode引数を
 * 追加しない設計を型シグネチャで固定する。
 */
describe("useShoppingList / useShoppingSafetyGate boundary", () => {
  it("useShoppingList takes no arguments (menu-agnostic, caller decides whether to mount)", () => {
    expect(useShoppingList.length).toBe(0);
  });

  it("useShoppingSafetyGate takes no arguments (menu-agnostic, caller decides whether to mount)", () => {
    expect(useShoppingSafetyGate.length).toBe(0);
  });

  it("mounting useShoppingList fetches the user's single active list without a menu filter", async () => {
    const { result } = renderHook(() => useShoppingList(), { wrapper });
    await vi.waitFor(() => {
      expect(fetchActiveShoppingListMock).toHaveBeenCalledTimes(1);
    });
    // queryFn は TanStack Query の内部 context だけを受け取り、呼び出し側から
    // menuId や targetMode を渡さない（境界は mount するかどうかで決まる）。
    const call = fetchActiveShoppingListMock.mock.calls[0];
    expect(call).toHaveLength(1);
    expect(result.current.isSuccess || result.current.isPending).toBe(true);
  });
});
