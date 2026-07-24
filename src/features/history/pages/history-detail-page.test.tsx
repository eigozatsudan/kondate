import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ShoppingDiff,
  ShoppingList,
  ShoppingListSafetyData,
} from "@shared/contracts/shopping";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import { pendingShoppingCommandStorageKey } from "@/features/shopping/api/shopping-api";
import type { RevalidationResult } from "../api/revalidation-api";
import { HistoryDetailPage, type HistoryDetailRevalidationView } from "./history-detail-page";

const revalidateMenuMock = vi.hoisted(() => vi.fn());
const getMenuResultMock = vi.hoisted(() => vi.fn());
const getUsageTodayMock = vi.hoisted(() => vi.fn());
const acceptMenuVersionMock = vi.hoisted(() => vi.fn());
const confirmLabelConfirmationMock = vi.hoisted(() => vi.fn());
const deletePantryItemMock = vi.hoisted(() => vi.fn());
const updatePantryItemMock = vi.hoisted(() => vi.fn());
const createPantryItemMock = vi.hoisted(() => vi.fn());
// revalidation と shopping safety gate の両方が channel を購読するため、
// 後勝ち上書きせず全 callback を保持する（Realtime シグナルの偽グリーン防止）。
const channelHandlers = vi.hoisted(() => ({
  members: [] as Array<() => void>,
  allergies: [] as Array<() => void>,
}));
// hoisted mock から参照する固定 UUID（下の const より前に置く）
const MOCK_USER_ID = "31000000-0000-4000-8000-000000000001";

type ShoppingApiModule = typeof import("@/features/shopping/api/shopping-api");
const shoppingApi = vi.hoisted(() => ({
  fetchActiveShoppingList: vi.fn<ShoppingApiModule["fetchActiveShoppingList"]>(),
  revalidateActiveShoppingList: vi.fn<ShoppingApiModule["revalidateActiveShoppingList"]>(),
  createShoppingList: vi.fn<ShoppingApiModule["createShoppingList"]>(),
  reconcileShoppingListRequest: vi.fn<ShoppingApiModule["reconcileShoppingListRequest"]>(),
  previewShoppingDiff: vi.fn<ShoppingApiModule["previewShoppingDiff"]>(),
  fetchReconcilableMenuSource: vi.fn<ShoppingApiModule["fetchReconcilableMenuSource"]>(),
}));

vi.mock("../api/revalidation-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/revalidation-api")>();
  return { ...original, revalidateMenu: revalidateMenuMock };
});
vi.mock("@/features/generation/api/menu-result-api", () => ({
  getMenuResult: getMenuResultMock,
}));
vi.mock("@/features/generation/api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));
vi.mock("@/features/generation/api/confirm-label-api", () => ({
  confirmLabelConfirmation: confirmLabelConfirmationMock,
}));
vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return { ...original, acceptMenuVersion: acceptMenuVersionMock };
});
vi.mock("@/features/generation/model/pending-generation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/model/pending-generation")>();
  return { ...original, clearPendingGeneration: vi.fn() };
});
// 買い物は API 層だけ差し替え。persistedShoppingCommand / clearShoppingCommand /
// useResumeShoppingCommand は実体のまま動かし、送信・resume を偽グリーンにしない。
vi.mock("@/features/shopping/api/shopping-api", async (importOriginal) => {
  const original = await importOriginal<ShoppingApiModule>();
  return { ...original, ...shoppingApi };
});
// 冷蔵庫 CRUD は Supabase client 境界を mock し、actions 到達だけを固定する。
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return {
    ...original,
    deletePantryItem: deletePantryItemMock,
    updatePantryItem: updatePantryItemMock,
    createPantryItem: createPantryItemMock,
  };
});
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = {
        on: (_event: string, filter: { table?: string }, callback: () => void) => {
          if (filter.table === "household_members") channelHandlers.members.push(callback);
          if (filter.table === "member_allergies") channelHandlers.allergies.push(callback);
          return api;
        },
        subscribe: (statusCallback?: (status: string) => void) => {
          // 買い物安全ゲートが SUBSCRIBED を受けて refresh できるようにする
          if (typeof statusCallback === "function") statusCallback("SUBSCRIBED");
          return api;
        },
        unsubscribe: vi.fn(),
      };
      return api;
    },
    removeChannel: vi.fn(),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      // 買い物ゲートは getUser 失敗で閉じる。履歴 household でも所有者を返す。
      getUser: () => Promise.resolve({ data: { user: { id: MOCK_USER_ID } }, error: null }),
    },
  }),
}));

const MENU_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "31000000-0000-4000-8000-000000000001";
const SHOPPING_LIST_ID = "32000000-0000-4000-8000-000000000001";
const SHOPPING_ITEM_ID = "32000000-0000-4000-8000-000000000002";
const SHOPPING_FINGERPRINT = "f".repeat(64);
const CREATE_IDEMPOTENCY_KEY = "40000000-0000-4000-8000-0000000000aa";

const validRevalidation: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

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
  checkedSourceMenuIds: [MENU_ID],
  currentLabelWarnings: [],
  issues: [],
};

const invalidShoppingSafety: ShoppingListSafetyData = {
  status: "invalid",
  safetyFingerprint: null,
  checkedSourceMenuIds: [MENU_ID],
  currentLabelWarnings: [],
  issues: [
    {
      code: "current_safety_invalid",
      message: "現在の家族設定ではこのリストを使えません",
      sourceMenuId: MENU_ID,
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

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function authValue(userId: string): AuthContextValue {
  return {
    status: "authenticated",
    session: { user: { id: userId } } as AuthContextValue["session"],
    refreshSession: vi.fn(),
  };
}

function renderHistoryDetail(
  options: {
    revalidate?: () => Promise<RevalidationResult>;
    revalidation?: HistoryDetailRevalidationView;
    queryClient?: QueryClient;
  } = {},
) {
  if (options.revalidate !== undefined) {
    revalidateMenuMock.mockImplementation(options.revalidate);
  }
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/history/:menuId",
        element:
          options.revalidation !== undefined ? (
            <HistoryDetailPage revalidation={options.revalidation} />
          ) : (
            <HistoryDetailPage />
          ),
      },
      { path: "/history", element: <h1>履歴</h1> },
      { path: "/generation", element: <h1>作成状況</h1> },
      { path: "/shopping", element: <h1>買い物リスト</h1> },
    ],
    { initialEntries: [`/history/${MENU_ID}`] },
  );
  render(
    <AuthContext.Provider value={authValue(USER_ID)}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
  return router;
}

function renderMenuResultPage(
  options: {
    initialRevalidation?: RevalidationResult;
    nextRevalidation?: Promise<RevalidationResult>;
  } = {},
) {
  // 多段応答が必要なときだけ mockImplementation を上書きする。
  // 単発の mockResolvedValue / mockRejectedValue を壊さない。
  if (options.initialRevalidation !== undefined || options.nextRevalidation !== undefined) {
    let call = 0;
    revalidateMenuMock.mockImplementation(() => {
      call += 1;
      if (call === 1 && options.initialRevalidation !== undefined) {
        return Promise.resolve(options.initialRevalidation);
      }
      if (options.nextRevalidation !== undefined) return options.nextRevalidation;
      return Promise.resolve(options.initialRevalidation ?? validRevalidation);
    });
  }
  const router = createMemoryRouter(
    [
      { path: "/menus/:menuId", element: <MenuResultPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/history", element: <h1>履歴</h1> },
    ],
    { initialEntries: [`/menus/${MENU_ID}`] },
  );
  render(
    <AuthContext.Provider value={authValue(USER_ID)}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
  return router;
}

function dispatchHouseholdSafetyStorageEvent(): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: householdSafetyRevisionStorageKey,
      newValue: crypto.randomUUID(),
    }),
  );
}

/** test専用。DOM / Realtime / 60s の各シグナルを再現する。 */
function fireSafetySignal(
  signal:
    | "focus"
    | "visible-visibilitychange"
    | "online"
    | "realtime-household-member"
    | "realtime-member-allergy"
    | "sixty-second-poll"
    | "same-tab-event",
): void {
  if (signal === "focus") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    window.dispatchEvent(new Event("focus"));
    return;
  }
  if (signal === "visible-visibilitychange") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    return;
  }
  if (signal === "online") {
    window.dispatchEvent(new Event("online"));
    return;
  }
  if (signal === "realtime-household-member") {
    for (const handler of channelHandlers.members) handler();
    return;
  }
  if (signal === "realtime-member-allergy") {
    for (const handler of channelHandlers.allergies) handler();
    return;
  }
  if (signal === "same-tab-event") {
    window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    return;
  }
  // sixty-second-poll は vi.advanceTimers 側で扱う
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  channelHandlers.members = [];
  channelHandlers.allergies = [];
  revalidateMenuMock.mockResolvedValue(validRevalidation);
  getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
  getUsageTodayMock.mockResolvedValue({
    success: { consumed: 2, limit: 5, remaining: 3 },
    attempts: { sent: 0, limit: 12, remaining: 12 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  });
  acceptMenuVersionMock.mockResolvedValue(undefined);
  confirmLabelConfirmationMock.mockResolvedValue(undefined);
  deletePantryItemMock.mockResolvedValue({ id: "66000000-0000-4000-8000-000000000001" });
  updatePantryItemMock.mockResolvedValue({
    id: "66000000-0000-4000-8000-000000000001",
    name: "しょうゆ",
    quantity: 50,
    unit: "ml",
    expiresOn: "2026-12-01",
    expirationType: "best_before",
    openedState: "opened",
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  createPantryItemMock.mockResolvedValue({
    id: "66000000-0000-4000-8000-000000000099",
    name: "しょうゆ",
    quantity: 200,
    unit: "ml",
    expiresOn: "2026-12-01",
    expirationType: "best_before",
    openedState: "opened",
    updatedAt: "2026-07-11T00:00:00.000Z",
  });
  // 結果画面テストと同型: active list + valid gate を既定にし、送信・resume を到達させる
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
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("HistoryDetailPage safety gate", () => {
  it("revalidates on mount and blocks actions while current safety is loading", async () => {
    const revalidate = deferredPromise<RevalidationResult>();
    renderHistoryDetail({ revalidate: () => revalidate.promise });
    expect(await screen.findByText("現在の家族設定で確認しています")).toBeVisible();
    expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();
    act(() => {
      revalidate.resolve(validRevalidation);
    });
    expect(await screen.findByText("現在の家族設定で確認しました")).toBeVisible();
  });

  it("allows regeneration after a changed but valid current-safety result", async () => {
    renderHistoryDetail({
      revalidation: {
        phase: "checked",
        result: {
          ...validRevalidation,
          status: "changed",
          issues: [],
          changedDetails: ["preference_changed"],
        },
      },
    });
    expect(
      await screen.findByText("現在の家族設定で確認しました。作成時から条件が変わっています"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled();
  });

  it("disables これに決めた while checking and enables when revalidation is actionable", async () => {
    const revalidate = deferredPromise<RevalidationResult>();
    renderHistoryDetail({ revalidate: () => revalidate.promise });
    expect(await screen.findByRole("button", { name: "これに決めた" })).toBeDisabled();
    act(() => {
      revalidate.resolve(validRevalidation);
    });
    expect(await screen.findByRole("button", { name: "これに決めた" })).toBeEnabled();
  });

  it("calls acceptMenuVersion when これに決めた is clicked while actionable", async () => {
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });
    const button = await screen.findByRole("button", { name: "これに決めた" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(acceptMenuVersionMock).toHaveBeenCalledTimes(1);
    expect(acceptMenuVersionMock).toHaveBeenCalledWith(MENU_ID);
  });

  it("keeps これに決めた disabled when revalidation is invalid", async () => {
    renderHistoryDetail({
      revalidation: {
        phase: "checked",
        result: {
          ...validRevalidation,
          status: "invalid",
          issues: [
            { code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" },
          ],
        },
      },
    });
    expect(await screen.findByRole("button", { name: "これに決めた" })).toBeDisabled();
    expect(acceptMenuVersionMock).not.toHaveBeenCalled();
  });

  it("wires shopping create sheet and fridge tip when household actions are enabled", async () => {
    // シート表示と冷蔵庫 tip は残す。送信・resume・actions 到達は後続テストで固定する。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    const shopping = await screen.findByRole("button", { name: "買い物リストを作る" });
    await waitFor(() => {
      expect(shopping).toBeEnabled();
    });
    await user.click(shopping);
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "冷蔵庫へ反映" }));
    expect(
      screen.getByText("調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。"),
    ).toBeVisible();
  });

  it("submits create shopping list command after sheet confirm", async () => {
    // sheet が開くだけでは不合格。CreateShoppingListRequest 相当の実送信を固定する。
    const user = userEvent.setup();
    const router = renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    const shopping = await screen.findByRole("button", { name: "買い物リストを作る" });
    await waitFor(() => {
      expect(shopping).toBeEnabled();
    });
    await user.click(shopping);
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(shoppingApi.createShoppingList).toHaveBeenCalledTimes(1);
    });
    // TanStack Query は mutationFn へ第2引数（内部 context）も渡すため、コマンド本体だけ比較する。
    const command = shoppingApi.createShoppingList.mock.calls[0]?.[0];
    expect(Object.keys(command ?? {}).sort()).toEqual([
      "activeListId",
      "expectedListVersion",
      "idempotencyKey",
      "menuId",
      "mode",
    ]);
    expect(command).toMatchObject({
      menuId: MENU_ID,
      mode: "append",
      activeListId: SHOPPING_LIST_ID,
      expectedListVersion: 4,
    });
    expect(typeof command?.idempotencyKey).toBe("string");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/shopping");
    });
    expect(sessionStorage.getItem(pendingShoppingCommandStorageKey("create", MENU_ID))).toBeNull();
  });

  it("resumes persisted create shopping command on mount", async () => {
    // pending create が session にあるとき、クリックなしで submit が再実行される
    const pendingCommand = {
      menuId: MENU_ID,
      mode: "new" as const,
      activeListId: null,
      expectedListVersion: null,
      idempotencyKey: CREATE_IDEMPOTENCY_KEY,
    };
    sessionStorage.setItem(
      pendingShoppingCommandStorageKey("create", MENU_ID),
      JSON.stringify({ createdAtMs: Date.now(), command: pendingCommand }),
    );

    const router = renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await waitFor(() => {
      expect(shoppingApi.createShoppingList).toHaveBeenCalledTimes(1);
    });
    expect(shoppingApi.createShoppingList.mock.calls[0]?.[0]).toEqual(pendingCommand);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/shopping");
    });
    expect(sessionStorage.getItem(pendingShoppingCommandStorageKey("create", MENU_ID))).toBeNull();
  });

  it("disables shopping controls while safety gate is blocked", async () => {
    shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);

    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    const create = await screen.findByRole("button", { name: "買い物リストを作る" });
    await waitFor(() => {
      expect(shoppingApi.revalidateActiveShoppingList).toHaveBeenCalledWith(SHOPPING_LIST_ID);
    });
    expect(create).toBeDisabled();
    expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
  });

  it("invokes pantry delete through MenuResult actions on household history detail", async () => {
    // tip 文だけでは不合格。MenuResult actions 経由で onDeletePantry が実到達すること。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    expect(await screen.findByRole("heading", { name: "調理後の冷蔵庫" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "使い切った" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => {
      expect(deletePantryItemMock).toHaveBeenCalledTimes(1);
    });
    expect(deletePantryItemMock).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      "66000000-0000-4000-8000-000000000001",
      "2026-07-11T00:00:00.000Z",
    );
  });

  it("label confirm through MenuResult actions triggers beginRecheck", async () => {
    // ラベル確認成功/失敗の後に beginRecheck が走り、ゲートが checking へ戻ること。
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
    const afterConfirm = deferredPromise<RevalidationResult>();
    revalidateMenuMock.mockImplementation(() => {
      revalidateCalls += 1;
      if (revalidateCalls === 1) {
        return Promise.resolve({ ...validRevalidation, currentLabelWarnings: [warning] });
      }
      return afterConfirm.promise;
    });
    confirmLabelConfirmationMock.mockRejectedValue(new Error("not_found"));

    // 注入 revalidation だと beginRecheck が no-op になるため live gate を使う
    renderHistoryDetail();

    expect(
      await screen.findByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    );

    expect(await screen.findByText("現在の家族設定で確認しています")).toBeVisible();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
    expect(confirmLabelConfirmationMock).toHaveBeenCalledWith(
      MENU_ID,
      warning.confirmationId,
      "current",
    );
  });

  it("previews reconcile when active list source exists", async () => {
    shoppingApi.fetchReconcilableMenuSource.mockResolvedValue({
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 2,
    });
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    const reconcile = await screen.findByRole("button", { name: "買い物リストとの差分を確認" });
    await waitFor(() => {
      expect(reconcile).toBeEnabled();
    });
    await user.click(reconcile);

    await waitFor(() => {
      expect(shoppingApi.previewShoppingDiff).toHaveBeenCalledWith(MENU_ID, 2, activeShoppingList);
    });
    expect(await screen.findByRole("heading", { name: "献立変更の差分" })).toBeVisible();
  });
});

describe("HistoryDetailPage idea permitted actions boundary", () => {
  it("renders a permanent notice and permitted actions without mounting revalidation or shopping", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

    renderHistoryDetail();

    expect(await screen.findByText("家族条件を使用していません")).toBeVisible();
    expect(screen.getByText("年齢・アレルギーへの適合は確認されていません")).toBeVisible();
    // idea では家族 revalidation と買い物 hooks/API を mount しない
    expect(revalidateMenuMock).not.toHaveBeenCalled();
    expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
    expect(shoppingApi.fetchReconcilableMenuSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "買い物リストを作る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
    // 許可操作: 採用・お気に入り・冷蔵庫・whole/dish 再生成
    expect(screen.getByRole("button", { name: "これに決めた" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "お気に入りに追加" })).toBeEnabled();
    expect(acceptMenuVersionMock).not.toHaveBeenCalled();
    // idea では sessionStorage に再送用 shopping 記録を一切作らない
    expect(
      Object.keys(sessionStorage).filter((key) => key.startsWith("kondate:shopping:")),
    ).toHaveLength(0);
  });

  it("does not interpret the stored snapshot as a family safety confirmation on the idea child root", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

    renderHistoryDetail();

    expect(await screen.findByText("家族条件を使用していません")).toBeVisible();
    const themedRoot = document.querySelector(".guided-planner-theme");
    expect(themedRoot).not.toBeNull();
    expect(themedRoot?.textContent).not.toMatch(/確認済み|安全に配慮|アレルギー対応済み/u);
  });

  it("hides child_friendly in idea regeneration sheet", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));
    renderHistoryDetail();
    await userEvent.click(await screen.findByRole("button", { name: "献立をまるごと別案にする" }));
    expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
  });

  it("keeps household mode mounting revalidation and the family action bar as before", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));

    renderHistoryDetail({ revalidate: () => Promise.resolve(validRevalidation) });

    await waitFor(() => {
      expect(revalidateMenuMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("家族条件を使用していません")).toBeNull();
  });

  it("hydrates favorite button from result.isFavorite on idea mount", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "idea", isFavorite: true }),
    );

    renderHistoryDetail();

    const favorite = await screen.findByRole("button", { name: "お気に入りを外す" });
    expect(favorite).toHaveAttribute("aria-pressed", "true");
  });

  it("syncs favorite chrome when result.isFavorite changes for the same menuId", async () => {
    // query 再取得で favorite だけ変わるケースを useEffect 経路でカバーする
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "idea", isFavorite: false }),
    );

    renderHistoryDetail({ queryClient });

    expect(await screen.findByRole("button", { name: "お気に入りに追加" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    act(() => {
      queryClient.setQueryData(
        ["menu-result", USER_ID, MENU_ID],
        makeMenuResultViewModel({ targetMode: "idea", isFavorite: true }),
      );
    });

    expect(await screen.findByRole("button", { name: "お気に入りを外す" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("MenuResultPage shared revalidation gate", () => {
  it("hides an already open result immediately when safety changes in another tab", async () => {
    const revalidate = deferredPromise<RevalidationResult>();
    renderMenuResultPage({
      initialRevalidation: validRevalidation,
      nextRevalidation: revalidate.promise,
    });
    expect(await screen.findByRole("heading", { name: /献立/u })).toBeVisible();
    act(() => {
      dispatchHouseholdSafetyStorageEvent();
    });
    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent.includes("現在の家族設定で確認しています")),
    ).toBe(true);
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
  });

  it.each([
    "focus",
    "visible-visibilitychange",
    "online",
    "realtime-household-member",
    "realtime-member-allergy",
    "sixty-second-poll",
  ] as const)("fails closed and starts a fresh current-safety check for %s", async (signal) => {
    if (signal === "sixty-second-poll") vi.useFakeTimers({ shouldAdvanceTime: true });
    const revalidate = deferredPromise<RevalidationResult>();
    renderMenuResultPage({
      initialRevalidation: validRevalidation,
      nextRevalidation: revalidate.promise,
    });
    expect(await screen.findByRole("heading", { name: /献立/u })).toBeVisible();
    if (signal === "sixty-second-poll") {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    } else {
      act(() => {
        fireSafetySignal(signal);
      });
    }
    // MenuResult 内の status と競合し得るため、文言で絞る
    expect(
      screen
        .getAllByRole("status")
        .some((node) => node.textContent.includes("現在の家族設定で確認しています")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
    act(() => {
      revalidate.resolve(validRevalidation);
    });
    expect(await screen.findByRole("button", { name: "冷蔵庫へ反映" })).toBeEnabled();
  });

  it("lists invalid issues and keeps content closed", async () => {
    revalidateMenuMock.mockResolvedValue({
      ...validRevalidation,
      status: "invalid",
      issues: [{ code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" }],
    });
    renderMenuResultPage({});
    expect(await screen.findByText("アレルゲンが含まれます")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
  });

  it("shows もう一度確認 on network failure without a manual-success escape", async () => {
    revalidateMenuMock.mockRejectedValue(new Error("network"));
    renderMenuResultPage({});
    expect(await screen.findByRole("button", { name: "もう一度確認" })).toBeVisible();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
  });

  it("shows revalidation currentLabelWarnings and hides obsolete stored-only warnings", async () => {
    const view = makeMenuResultViewModel();
    getMenuResultMock.mockResolvedValue(view);
    revalidateMenuMock.mockResolvedValue({
      ...validRevalidation,
      currentLabelWarnings: [
        {
          confirmationId: "48000000-0000-4000-8000-000000000099",
          sourceType: "ingredient",
          sourceId:
            view.menu.dishes[0]?.ingredients[0]?.id ?? "53000000-0000-4000-8000-000000000001",
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "RPCが返したスナップショット",
          allergenId: "egg",
          allergenName: "卵",
          anonymousMemberRef: "member_1",
          memberLabel: "子ども",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
        },
      ],
    });
    renderMenuResultPage({});
    expect(await screen.findByText(/RPCが返したスナップショット/u)).toBeVisible();
    expect(screen.getByText(/卵/u)).toBeVisible();
    expect(screen.queryByText("乳成分入りドレッシング")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    ).toBeVisible();
  });
});
