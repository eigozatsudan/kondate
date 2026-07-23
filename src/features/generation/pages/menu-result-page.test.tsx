import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import type {
  ShoppingDiff,
  ShoppingList,
  ShoppingListSafetyData,
} from "@shared/contracts/shopping";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import type { RevalidationResult } from "@/features/history/api/revalidation-api";
import { pendingShoppingCommandStorageKey } from "@/features/shopping/api/shopping-api";
import { MenuResultPage } from "./menu-result-page";

const getMenuResultMock = vi.hoisted(() => vi.fn());
const clearPendingGenerationMock = vi.hoisted(() => vi.fn());
const revalidateMenuMock = vi.hoisted(() => vi.fn());
const getUsageTodayMock = vi.hoisted(() => vi.fn());
const confirmLabelConfirmationMock = vi.hoisted(() => vi.fn());

vi.mock("../api/menu-result-api", () => ({ getMenuResult: getMenuResultMock }));
vi.mock("../model/pending-generation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/pending-generation")>();
  return {
    ...original,
    clearPendingGeneration: clearPendingGenerationMock,
  };
});
vi.mock("@/features/history/api/revalidation-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/history/api/revalidation-api")>();
  return { ...original, revalidateMenu: revalidateMenuMock };
});
vi.mock("../api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));
vi.mock("../api/confirm-label-api", () => ({
  confirmLabelConfirmation: confirmLabelConfirmationMock,
}));
type ShoppingApiModule = typeof import("@/features/shopping/api/shopping-api");

const shoppingApi = vi.hoisted(() => ({
  fetchActiveShoppingList: vi.fn<ShoppingApiModule["fetchActiveShoppingList"]>(),
  revalidateActiveShoppingList: vi.fn<ShoppingApiModule["revalidateActiveShoppingList"]>(),
  createShoppingList: vi.fn<ShoppingApiModule["createShoppingList"]>(),
  reconcileShoppingListRequest: vi.fn<ShoppingApiModule["reconcileShoppingListRequest"]>(),
  previewShoppingDiff: vi.fn<ShoppingApiModule["previewShoppingDiff"]>(),
  fetchReconcilableMenuSource: vi.fn<ShoppingApiModule["fetchReconcilableMenuSource"]>(),
}));

// 買い物リストの API 層だけを差し替える。保存領域ヘルパー（persistedShoppingCommand /
// clearShoppingCommand）は実体のまま動かし、再送記録の後始末まで検証する。
vi.mock("@/features/shopping/api/shopping-api", async (importOriginal) => {
  const original = await importOriginal<ShoppingApiModule>();
  return { ...original, ...shoppingApi };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = {
        on: () => api,
        subscribe: () => api,
        unsubscribe: vi.fn(),
      };
      return api;
    },
    removeChannel: vi.fn(),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      // 買い物リストの安全ゲートは所有者が取れないと必ず閉じる。所有者を返さない限り
      // 買い物系の操作は全テストで永久に無効のままになる。
      getUser: () => Promise.resolve({ data: { user: { id: USER_A_ID } }, error: null }),
    },
  }),
}));

const VALID_MENU_ID = "30000000-0000-4000-8000-000000000001";
const USER_A_ID = "31000000-0000-4000-8000-000000000001";
const USER_B_ID = "31000000-0000-4000-8000-000000000002";

const validRevalidation: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

const SHOPPING_LIST_ID = "32000000-0000-4000-8000-000000000001";
const SHOPPING_ITEM_ID = "32000000-0000-4000-8000-000000000002";
const SHOPPING_FINGERPRINT = "f".repeat(64);

const activeShoppingList: ShoppingList = {
  id: SHOPPING_LIST_ID,
  status: "active",
  version: 4,
  items: [],
  listLabelWarnings: [],
};

const validShoppingSafety: ShoppingListSafetyData = {
  status: "valid",
  safetyFingerprint: SHOPPING_FINGERPRINT,
  checkedSourceMenuIds: [VALID_MENU_ID],
  currentLabelWarnings: [],
  issues: [],
};

const invalidShoppingSafety: ShoppingListSafetyData = {
  status: "invalid",
  safetyFingerprint: null,
  checkedSourceMenuIds: [VALID_MENU_ID],
  currentLabelWarnings: [],
  issues: [
    {
      code: "current_safety_invalid",
      message: "現在の家族設定ではこのリストを使えません",
      sourceMenuId: VALID_MENU_ID,
    },
  ],
};

const shoppingDiff: ShoppingDiff = {
  add: [
    {
      key: "add-key-1",
      displayName: "たまねぎ",
      normalizedName: "たまねぎ",
      storeSection: "produce",
      quantityValue: 2,
      quantityText: "2個",
      unit: "個",
      pantryCheckRequired: false,
      sourceIngredients: [],
      labelWarnings: [],
    },
  ],
  replace: [],
  remove: [],
  protectedItemIds: [SHOPPING_ITEM_ID],
  listLabelWarnings: [],
};

function authValue(userId: string | null, status: AuthContextValue["status"] = "authenticated") {
  return {
    status,
    session: userId === null ? null : ({ user: { id: userId } } as AuthContextValue["session"]),
    refreshSession: vi.fn(),
  } satisfies AuthContextValue;
}

function renderPage(
  path: string,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  auth = authValue(USER_A_ID),
) {
  const router = createMemoryRouter(
    [
      { path: "/menus/:menuId", element: <MenuResultPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/history", element: <h1>履歴</h1> },
      { path: "/generation", element: <h1>作成状況</h1> },
      { path: "/shopping", element: <h1>買い物リスト</h1> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  shoppingApi.fetchActiveShoppingList.mockResolvedValue(activeShoppingList);
  shoppingApi.revalidateActiveShoppingList.mockResolvedValue(validShoppingSafety);
  shoppingApi.fetchReconcilableMenuSource.mockResolvedValue(null);
  shoppingApi.createShoppingList.mockResolvedValue({
    listId: SHOPPING_LIST_ID,
    version: 5,
    replayed: false,
  });
  shoppingApi.reconcileShoppingListRequest.mockResolvedValue({
    listId: SHOPPING_LIST_ID,
    version: 5,
    replayed: false,
  });
  shoppingApi.previewShoppingDiff.mockResolvedValue(shoppingDiff);
  revalidateMenuMock.mockResolvedValue(validRevalidation);
  getUsageTodayMock.mockResolvedValue({
    success: { consumed: 1, limit: 5, remaining: 4 },
    attempts: { sent: 0, limit: 12, remaining: 12 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  });
});

describe("MenuResultPage", () => {
  it("不正なmenuIdは/plannerへ即座にリダイレクトし問い合わせもしない", async () => {
    const router = renderPage("/menus/not-a-uuid");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/planner");
    });
    expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
    expect(getMenuResultMock).not.toHaveBeenCalled();
  });

  it("読み込み中は中立なステータス表示を返す", () => {
    getMenuResultMock.mockReturnValue(new Promise(() => undefined));

    renderPage(`/menus/${VALID_MENU_ID}`);

    expect(screen.getByRole("status")).toHaveTextContent("献立を読み込んでいます");
    expect(clearPendingGenerationMock).not.toHaveBeenCalled();
  });

  it("読み込みが成功したら結果を表示し、復旧用の保存内容を後始末する", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    renderPage(`/menus/${VALID_MENU_ID}`);

    expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
    expect(getMenuResultMock).toHaveBeenCalledWith(VALID_MENU_ID);
    await waitFor(() => {
      expect(clearPendingGenerationMock).toHaveBeenCalledTimes(1);
    });
  });

  it("ラベル確認の免責文をページ内で1回だけ表示する", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    renderPage(`/menus/${VALID_MENU_ID}`);

    // ゲート解放後も、ページ枠と献立本文とで免責文が二重表示されないこと
    expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
    expect(
      screen.getAllByText(
        "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。",
      ),
    ).toHaveLength(1);
  });

  it("同じQueryClientでも別ユーザーへ献立キャッシュを共有しない", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const userAResult = makeMenuResultViewModel();
    const userBResult = makeMenuResultViewModel();
    const userAFirstDish = userAResult.menu.dishes[0];
    const firstDish = userBResult.menu.dishes[0];
    if (userAFirstDish === undefined || firstDish === undefined)
      throw new Error("fixture must contain a dish");
    userBResult.menu.dishes[0] = { ...firstDish, name: "利用者Bの料理" };
    getMenuResultMock.mockResolvedValueOnce(userAResult).mockResolvedValueOnce(userBResult);

    const first = renderPage(`/menus/${VALID_MENU_ID}`, queryClient, authValue(USER_A_ID));
    expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
    first.dispose();
    cleanup();
    renderPage(`/menus/${VALID_MENU_ID}`, queryClient, authValue(USER_B_ID));

    await waitFor(() => {
      expect(getMenuResultMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole("heading", { name: "利用者Bの料理" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: userAFirstDish.name })).toBeNull();
  });

  it("認証状態が未確定または未認証なら献立を問い合わせない", () => {
    const loading = renderPage(`/menus/${VALID_MENU_ID}`, undefined, authValue(null, "loading"));
    expect(getMenuResultMock).not.toHaveBeenCalled();
    loading.dispose();
    cleanup();

    renderPage(`/menus/${VALID_MENU_ID}`, undefined, authValue(null, "unauthenticated"));
    expect(getMenuResultMock).not.toHaveBeenCalled();
  });

  it("読み込みに失敗したら履歴への導線を表示し、保存内容は後始末しない", async () => {
    getMenuResultMock.mockRejectedValue(new Error("menu_not_found"));

    renderPage(`/menus/${VALID_MENU_ID}`);

    expect(await screen.findByRole("heading", { name: "献立を表示できません" })).toBeVisible();
    expect(screen.getByRole("link", { name: "履歴を見る" })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("link", { name: "履歴を見る" })).toHaveClass("min-h-11", "min-w-11");
    await userEvent.click(screen.getByRole("link", { name: "履歴を見る" }));
    expect(await screen.findByRole("heading", { name: "履歴" })).toBeVisible();
    expect(clearPendingGenerationMock).not.toHaveBeenCalled();
  });

  it("現行安全の確認中は献立本文と操作を閉じる", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    revalidateMenuMock.mockReturnValue(new Promise(() => undefined));
    renderPage(`/menus/${VALID_MENU_ID}`);
    // 献立本体の取得が終わったあとも再検証が終わるまで操作を閉じる
    expect(await screen.findByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
    expect(screen.getByText("現在の家族設定で確認しています")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
    // 本文が閉じている間もラベル確認の免責文は常時表示する
    expect(
      screen.getByText(
        "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。",
      ),
    ).toBeVisible();
  });

  it("stale label confirm failure recloses the gate synchronously", async () => {
    const view = makeMenuResultViewModel();
    getMenuResultMock.mockResolvedValue(view);
    const warning = {
      confirmationId: "48000000-0000-4000-8000-000000000099",
      sourceType: "ingredient" as const,
      sourceId: view.menu.dishes[0]?.ingredients[0]?.id ?? "53000000-0000-4000-8000-000000000001",
      sourcePath: "dishes.0.ingredients.0.name",
      sourceText: "確認対象の加工品",
      allergenId: "egg",
      allergenName: "卵",
      anonymousMemberRef: "member_1",
      memberLabel: "子ども",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending" as const,
    };
    let revalidateCalls = 0;
    const afterStale = deferredPromiseForTest<RevalidationResult>();
    revalidateMenuMock.mockImplementation(() => {
      revalidateCalls += 1;
      if (revalidateCalls === 1) {
        return Promise.resolve({ ...validRevalidation, currentLabelWarnings: [warning] });
      }
      return afterStale.promise;
    });
    confirmLabelConfirmationMock.mockRejectedValue(new Error("not_found"));

    renderPage(`/menus/${VALID_MENU_ID}`);
    expect(
      await screen.findByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeEnabled();

    await userEvent.click(
      screen.getByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    );

    // invalidate 完了を待たず、同一ターン相当で checking に戻る
    expect(await screen.findByText("現在の家族設定で確認しています")).toBeVisible();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
  });

  it("keeps the shopping affordance closed while the shopping safety gate stays closed", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);

    renderPage(`/menus/${VALID_MENU_ID}`);

    const create = await screen.findByRole("button", { name: "買い物リストを作る" });
    await waitFor(() => {
      expect(shoppingApi.revalidateActiveShoppingList).toHaveBeenCalledWith(SHOPPING_LIST_ID);
    });
    expect(create).toBeDisabled();
    expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
  });

  it("opens the create sheet, sends the exact active list id and version, and moves to the list", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    const router = renderPage(`/menus/${VALID_MENU_ID}`);

    const create = await screen.findByRole("button", { name: "買い物リストを作る" });
    await waitFor(() => {
      expect(create).toBeEnabled();
    });
    await userEvent.click(create);
    expect(screen.getByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(shoppingApi.createShoppingList).toHaveBeenCalledTimes(1);
    });
    // TanStack Query は mutationFn へ第2引数（内部 context）も渡すため、
    // 組み立てたコマンドそのものだけを比較する。
    const command = shoppingApi.createShoppingList.mock.calls[0]?.[0];
    expect(Object.keys(command ?? {}).sort()).toEqual([
      "activeListId",
      "expectedListVersion",
      "idempotencyKey",
      "menuId",
      "mode",
    ]);
    expect(command).toMatchObject({
      menuId: VALID_MENU_ID,
      mode: "append",
      activeListId: SHOPPING_LIST_ID,
      expectedListVersion: 4,
    });
    expect(typeof command?.idempotencyKey).toBe("string");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/shopping");
    });
    // 読み直しまで済んだ時点で再送用の記録は残さない
    expect(
      sessionStorage.getItem(pendingShoppingCommandStorageKey("create", VALID_MENU_ID)),
    ).toBeNull();
  });

  it("previews the diff for display only and opens the reconcile sheet", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    shoppingApi.fetchReconcilableMenuSource.mockResolvedValue({
      sourceMenuId: VALID_MENU_ID,
      sourceMenuVersion: 2,
    });

    renderPage(`/menus/${VALID_MENU_ID}`);

    const reconcile = await screen.findByRole("button", { name: "買い物リストとの差分を確認" });
    await waitFor(() => {
      expect(reconcile).toBeEnabled();
    });
    await userEvent.click(reconcile);

    await waitFor(() => {
      expect(shoppingApi.previewShoppingDiff).toHaveBeenCalledWith(
        VALID_MENU_ID,
        2,
        activeShoppingList,
      );
    });
    expect(await screen.findByRole("heading", { name: "献立変更の差分" })).toBeVisible();
  });

  it("clears the approval and asks for a new one when the reconcile fails with a code", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    shoppingApi.fetchReconcilableMenuSource.mockResolvedValue({
      sourceMenuId: VALID_MENU_ID,
      sourceMenuVersion: 2,
    });
    shoppingApi.reconcileShoppingListRequest.mockRejectedValue(
      Object.assign(new Error("買い物リストが更新されました"), { code: "list_version_conflict" }),
    );

    renderPage(`/menus/${VALID_MENU_ID}`);

    const reconcile = await screen.findByRole("button", { name: "買い物リストとの差分を確認" });
    await waitFor(() => {
      expect(reconcile).toBeEnabled();
    });
    await userEvent.click(reconcile);
    await userEvent.click(await screen.findByRole("button", { name: "選んだ変更を反映" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "買い物リストの状態が変わりました。もう一度確認してください",
    );
    expect(screen.queryByRole("heading", { name: "献立変更の差分" })).not.toBeInTheDocument();
    expect(
      sessionStorage.getItem(pendingShoppingCommandStorageKey("reconcile", SHOPPING_LIST_ID)),
    ).toBeNull();
  });

  describe("idea result boundary", () => {
    it("shows permitted actions without mounting revalidation or shopping", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

      renderPage(`/menus/${VALID_MENU_ID}`);

      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      // idea は家族条件を使わないため、常時noticeを表示する
      expect(screen.getByText("家族条件を使用していません")).toBeVisible();
      expect(screen.getByText("年齢・アレルギーへの適合は確認されていません")).toBeVisible();
      // 家族 revalidation / shopping は mount しない
      expect(revalidateMenuMock).not.toHaveBeenCalled();
      expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
      expect(shoppingApi.fetchReconcilableMenuSource).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "買い物リストを作る" })).toBeNull();
      expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
      // 許可操作: 採用・お気に入り・冷蔵庫・whole/dish 再生成
      expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "これに決めた" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "お気に入りに追加" })).toBeEnabled();
      // idea では sessionStorage に再送用の shopping 記録を一切作らない
      expect(
        Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
      ).toHaveLength(0);
    });

    it("hides child_friendly when opening idea regeneration sheet", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));
      renderPage(`/menus/${VALID_MENU_ID}`);
      await userEvent.click(
        await screen.findByRole("button", { name: "献立をまるごと別案にする" }),
      );
      expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "もっと簡単に" })).toBeInTheDocument();
    });

    it("does not show retarget when sourceSubmission is null", async () => {
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", sourceSubmission: null }),
      );
      renderPage(`/menus/${VALID_MENU_ID}`);
      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "対象を変えて新しく作る" })).toBeNull();
    });

    it("shows retarget when sourceSubmission is valid", async () => {
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({
          targetMode: "idea",
          sourceSubmission: {
            mealType: "dinner",
            mainIngredients: ["鶏肉"],
            cuisineGenre: "japanese",
            targetMode: "idea",
            targetMemberIds: [],
            servings: 2,
            timeLimitMinutes: 30,
            budgetPreference: "economy",
            avoidIngredients: [],
            memo: "",
            pantrySelections: [],
          },
        }),
      );
      renderPage(`/menus/${VALID_MENU_ID}`);
      expect(await screen.findByRole("button", { name: "対象を変えて新しく作る" })).toBeEnabled();
    });

    it("applies the guided-planner-theme class to the idea body root", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

      renderPage(`/menus/${VALID_MENU_ID}`);

      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      expect(document.querySelector(".guided-planner-theme")).not.toBeNull();
    });

    it("keeps household mode mounting revalidation and shopping as before", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));

      renderPage(`/menus/${VALID_MENU_ID}`);

      await waitFor(() => {
        expect(revalidateMenuMock).toHaveBeenCalled();
      });
      expect(screen.queryByText("家族条件を使用していません")).toBeNull();
    });
  });
});

function deferredPromiseForTest<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
