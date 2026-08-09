import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import type { PlannerSubmission } from "@shared/contracts/planner";
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
const acceptMenuVersionMock = vi.hoisted(() => vi.fn());
const listDerivationVersionsMock = vi.hoisted(() => vi.fn());

vi.mock("../api/menu-result-api", () => ({ getMenuResult: getMenuResultMock }));
vi.mock("@/features/history/api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/history/api/history-api")>();
  return {
    ...original,
    acceptMenuVersion: acceptMenuVersionMock,
    listDerivationVersions: listDerivationVersionsMock,
  };
});
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

// F-U07-1 / HR-I1: listPantryItems を success に固定し、再生成 CTA が pantry 未取得で塞がらないようにする。
const listPantryItemsMock = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return {
    ...original,
    listPantryItems: listPantryItemsMock,
  };
});

const VALID_MENU_ID = "30000000-0000-4000-8000-000000000001";
const USER_A_ID = "31000000-0000-4000-8000-000000000001";
const USER_B_ID = "31000000-0000-4000-8000-000000000002";

/** idea 再生成 CTA を開くための最小 sourceSubmission（null だと pantryGate で disabled） */
const ideaSourceSubmission = {
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "idea",
  targetMemberIds: [],
  servings: 2,
  timeLimitMinutes: 30,
  budgetPreference: "economy",
  ingredientPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
} satisfies PlannerSubmission;

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
  listPantryItemsMock.mockResolvedValue([]);
  // jsdom 向け native dialog ポリフィル（再生成理由ダイアログ用）
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
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
  acceptMenuVersionMock.mockResolvedValue(undefined);
  // 既定は単一案（スイッチャー非表示・採用は副操作）
  listDerivationVersionsMock.mockResolvedValue([]);
  getUsageTodayMock.mockResolvedValue({
    plan: "free" as const,
    plusEntitled: false,
    success: { consumed: 1, limit: 3, remaining: 2 },
    attempts: { sent: 0, limit: 6, remaining: 6 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    quality: {
      day: { consumed: 0, limit: 3, remaining: 3 },
      month: { consumed: 0, limit: 20, remaining: 20 },
      available: false,
    },
    flyerWeekly: {
      successConsumed: 0,
      successLimit: 2,
      successRemaining: 2,
      triesConsumed: 0,
      triesLimit: 6,
      triesRemaining: 6,
      weekStartJst: "2026-07-27",
    },
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

  it("読み込み中は中立なステータス表示とインジケータを返す", () => {
    getMenuResultMock.mockReturnValue(new Promise(() => undefined));

    renderPage(`/menus/${VALID_MENU_ID}`);

    // Skeleton 化後も role="status" とアクセシブル名（文言）は維持する。
    // 実装クラス .gen-status-indicator は Skeleton に置き換わったため、
    // 同じ意図を role / 文言で固定する（revalidation 側の indicator 契約は別テスト）。
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("献立を読み込んでいます");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(clearPendingGenerationMock).not.toHaveBeenCalled();
  });

  it("読み込みが成功したら結果を表示し、復旧用の保存内容を後始末する", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    renderPage(`/menus/${VALID_MENU_ID}`);

    expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
    // A-I7: 結果画面では苦手 soft gap を含めて取得する
    expect(getMenuResultMock).toHaveBeenCalledWith(VALID_MENU_ID, {
      includePreferenceGaps: true,
    });
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
        "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
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
    expect(await screen.findByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
    expect(screen.getByText("現在の家族設定で確認しています")).toBeVisible();
    expect(document.querySelector(".revalidation-checking-overlay")).not.toBeNull();
    expect(document.querySelector(".gen-status-indicator")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
    // 本文が閉じている間もラベル確認の免責文は常時表示する
    expect(
      screen.getByText(
        "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
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
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeEnabled();

    await userEvent.click(
      screen.getByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    );

    // invalidate 完了を待たず、同一ターン相当で checking に戻る
    expect(await screen.findByText("現在の家族設定で確認しています")).toBeVisible();
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
  });

  it("allows create while the shopping safety gate stays closed, but keeps reconcile closed", async () => {
    // D-C1: 新規作成は active リストの安全ゲートと独立。差分確認だけゲートに従う。
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);

    renderPage(`/menus/${VALID_MENU_ID}`);

    await waitFor(() => {
      expect(shoppingApi.revalidateActiveShoppingList).toHaveBeenCalledWith(SHOPPING_LIST_ID);
    });
    // 案一覧確定後に主/副が入れ替わるため、有効化された時点のボタンを取り直す
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    expect(screen.queryByRole("button", { name: "買い物リストの差分を見る" })).toBeNull();
  });

  it("auto-opens create sheet when for=shopping and can create", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  });

  it("shows idea rejection without shopping network when for=shopping", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));
    renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
    expect(await screen.findByText(/アイデア献立は買い物リストに使えません/u)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
    expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
    expect(shoppingApi.createShoppingList).not.toHaveBeenCalled();
  });

  it("passes forceNewMode copy when shopping gate is blocked and for=shopping", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);
    renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
    expect(
      screen.getByText("今のリストは家族設定で確認できないため、新しいリストを作ります。"),
    ).toBeInTheDocument();
  });

  it("does not auto-open while pending create envelope exists", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", VALID_MENU_ID),
      JSON.stringify({
        createdAtMs: Date.now(),
        command: {
          menuId: VALID_MENU_ID,
          mode: "new",
          activeListId: null,
          expectedListVersion: null,
          idempotencyKey: "00000000-0000-4000-8000-000000000099",
        },
      }),
    );
    renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
    await screen.findByRole("button", { name: "材料の買い物リストを作る" });
    expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
  });

  it("uses non-removed item count on create sheet", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    shoppingApi.fetchActiveShoppingList.mockResolvedValue({
      ...activeShoppingList,
      items: [
        {
          id: SHOPPING_ITEM_ID,
          listId: SHOPPING_LIST_ID,
          displayName: "にんじん",
          normalizedName: "にんじん",
          storeSection: "produce",
          quantityValue: 1,
          quantityText: "1本",
          unit: "本",
          isChecked: false,
          isManual: false,
          isManuallyEdited: false,
          isRemovedByUser: true,
          pantryCheckRequired: false,
          labelWarnings: [],
        },
      ],
    });
    renderPage(`/menus/${VALID_MENU_ID}?for=shopping`);
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
    expect(screen.getByText(/今のリストへ追加（0件）/u)).toBeInTheDocument();
  });

  it("opens the create sheet, sends the exact active list id and version, and moves to the list", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    const router = renderPage(`/menus/${VALID_MENU_ID}`);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole("button", { name: "材料の買い物リストを作る" }));
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

  it("submits create mode=new with the active list id and version for archive OCC", async () => {
    // active がある「新しいリストにする」は SQL が id/version を要求する。
    // 親が null へ落とすと list_version_conflict になる回帰を固定する。
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());

    renderPage(`/menus/${VALID_MENU_ID}`);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole("button", { name: "材料の買い物リストを作る" }));
    await userEvent.click(screen.getByRole("radio", { name: "新しいリストにする" }));
    await userEvent.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(shoppingApi.createShoppingList).toHaveBeenCalledTimes(1);
    });
    const command = shoppingApi.createShoppingList.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      menuId: VALID_MENU_ID,
      mode: "new",
      activeListId: SHOPPING_LIST_ID,
      expectedListVersion: 4,
    });
  });

  it("previews the diff for display only and opens the reconcile sheet", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
    shoppingApi.fetchReconcilableMenuSource.mockResolvedValue({
      sourceMenuId: VALID_MENU_ID,
      sourceMenuVersion: 2,
    });

    renderPage(`/menus/${VALID_MENU_ID}`);

    const reconcile = await screen.findByRole("button", { name: "買い物リストの差分を見る" });
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

    const reconcile = await screen.findByRole("button", { name: "買い物リストの差分を見る" });
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
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", sourceSubmission: ideaSourceSubmission }),
      );

      renderPage(`/menus/${VALID_MENU_ID}`);

      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      // idea 注意: 設計 §5.4 必須2文は常時表示。AI/ラベル長文はダイアログ
      expect(screen.getByText("ご確認ください")).toBeVisible();
      expect(screen.getByRole("button", { name: "注意事項を見る" })).toBeVisible();
      expect(screen.getAllByRole("note")).toHaveLength(1);
      expect(
        screen.getAllByText("家族条件を使用していません").find((node) => !node.closest("dialog")),
      ).toBeVisible();
      expect(
        screen
          .getAllByText("年齢・アレルギーへの適合は確認されていません")
          .find((node) => !node.closest("dialog")),
      ).toBeVisible();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "注意事項を見る" }));
      const dialog = screen.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });
      expect(dialog).toBeVisible();
      expect(dialog).toHaveTextContent("家族条件を使用していません");
      expect(dialog).toHaveTextContent("年齢・アレルギーへの適合は確認されていません");
      expect(dialog).toHaveTextContent("AIが作成した献立です。");
      expect(dialog).toHaveTextContent(
        "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
      );
      // 家族 revalidation / shopping は mount しない
      expect(revalidateMenuMock).not.toHaveBeenCalled();
      expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
      expect(shoppingApi.fetchReconcilableMenuSource).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "材料の買い物リストを作る" })).toBeNull();
      expect(screen.queryByRole("button", { name: "買い物リストの差分を見る" })).toBeNull();
      // 許可操作: 採用・お気に入り・冷蔵庫・whole/dish 再生成
      expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "お気に入りに追加" })).toBeEnabled();
      // idea では sessionStorage に再送用の shopping 記録を一切作らない
      expect(
        Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
      ).toHaveLength(0);
    });

    it("hides child_friendly when opening idea regeneration dialog", async () => {
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", sourceSubmission: ideaSourceSubmission }),
      );
      renderPage(`/menus/${VALID_MENU_ID}`);
      await userEvent.click(
        await screen.findByRole("button", { name: "この案を元に別の献立を作り直す" }),
      );
      const dialog = screen.getByRole("dialog", { name: "どのように変えますか？" });
      expect(dialog).toBeVisible();
      expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "もっと簡単に" })).toBeInTheDocument();
    });

    it("does not show retarget when sourceSubmission is null", async () => {
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", sourceSubmission: null }),
      );
      renderPage(`/menus/${VALID_MENU_ID}`);
      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "条件を変えて作り直す" })).toBeNull();
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
            ingredientPreference: null,
            avoidIngredients: [],
            memo: "",
            pantrySelections: [],
          },
        }),
      );
      renderPage(`/menus/${VALID_MENU_ID}`);
      expect(await screen.findByRole("button", { name: "条件を変えて作り直す" })).toBeEnabled();
    });

    it("after accept, promotes history link as the primary next step", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));
      renderPage(`/menus/${VALID_MENU_ID}`);
      // 案一覧確定で採用が副操作へ移るため、有効な現在のボタンを取り直す
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
      });
      await userEvent.click(screen.getByRole("button", { name: "この献立にする" }));
      expect(await screen.findByText(/履歴の「作った献立」から/u)).toBeVisible();
      expect(screen.queryByRole("button", { name: "この献立にする" })).toBeNull();
      expect(screen.queryByRole("button", { name: "この献立にしました" })).toBeNull();
      const historyLink = screen.getByRole("link", { name: "作った献立を見る" });
      expect(historyLink).toHaveAttribute("href", "/history");
      expect(historyLink).toHaveClass("primary-button");
    });

    it("shows version switcher and primary accept when multiple sibling versions exist", async () => {
      const groupId = "c1000000-0000-4000-8000-000000000001";
      const otherId = "c1000000-0000-4000-8000-000000000002";
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({
          targetMode: "idea",
          derivationGroupId: groupId,
          version: 2,
          isSelected: false,
        }),
      );
      listDerivationVersionsMock.mockResolvedValue([
        {
          id: otherId,
          version: 1,
          title: "最初の案・副菜",
          isSelected: true,
          createdAt: "2026-07-11T09:00:00Z",
          parentMenuId: null,
        },
        {
          id: VALID_MENU_ID,
          version: 2,
          title: "二案目・副菜",
          isSelected: false,
          createdAt: "2026-07-11T10:00:00Z",
          parentMenuId: otherId,
        },
      ]);
      renderPage(`/menus/${VALID_MENU_ID}`);
      expect(await screen.findByText(/別案を見比べる（2案）/u)).toBeVisible();
      // 複数案では採用が主操作
      const accept = await screen.findByRole("button", { name: "この献立にする" });
      expect(accept).toHaveClass("primary-button");
      expect(screen.getByRole("link", { name: /案1/u })).toHaveAttribute(
        "href",
        `/menus/${otherId}`,
      );
    });

    it("applies the guided-planner-theme class to the idea body root", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

      renderPage(`/menus/${VALID_MENU_ID}`);

      expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
      expect(document.querySelector(".guided-planner-theme")).not.toBeNull();
    });

    it("after household accept, promotes shopping as primary next step", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
      renderPage(`/menus/${VALID_MENU_ID}`);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
      });
      await userEvent.click(screen.getByRole("button", { name: "この献立にする" }));
      expect(await screen.findByText(/材料の買い物リストを作ると/u)).toBeVisible();
      expect(screen.queryByRole("button", { name: "この献立にする" })).toBeNull();
      const shopping = screen.getByRole("button", { name: "材料の買い物リストを作る" });
      expect(shopping).toHaveClass("primary-button");
      expect(shopping).toBeEnabled();
    });

    it("keeps household mode mounting revalidation and shopping as before", async () => {
      getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));

      renderPage(`/menus/${VALID_MENU_ID}`);

      await waitFor(() => {
        expect(revalidateMenuMock).toHaveBeenCalled();
      });
      expect(screen.queryByText("家族条件を使用していません")).toBeNull();
    });

    it("hydrates favorite button from result.isFavorite on idea mount", async () => {
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", isFavorite: true }),
      );

      renderPage(`/menus/${VALID_MENU_ID}`);

      const favorite = await screen.findByRole("button", { name: "お気に入りを外す" });
      expect(favorite).toHaveAttribute("aria-pressed", "true");
    });

    it("syncs favorite chrome when result.isFavorite changes for the same menuId", async () => {
      // query 再取得で favorite だけ変わるケースを useEffect 経路でカバーする
      // （key={menuId} のみに頼ると同一 route では state が古いまま残る）
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      getMenuResultMock.mockResolvedValue(
        makeMenuResultViewModel({ targetMode: "idea", isFavorite: false }),
      );

      renderPage(`/menus/${VALID_MENU_ID}`, queryClient);

      expect(await screen.findByRole("button", { name: "お気に入りに追加" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      act(() => {
        queryClient.setQueryData(
          ["menu-result", USER_A_ID, VALID_MENU_ID, "generation"],
          makeMenuResultViewModel({ targetMode: "idea", isFavorite: true }),
        );
      });

      expect(await screen.findByRole("button", { name: "お気に入りを外す" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
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
