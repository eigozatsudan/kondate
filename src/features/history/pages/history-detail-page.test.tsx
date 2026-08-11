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
const getGenerationStatusMock = vi.hoisted(() => vi.fn());
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
// G-R1: 履歴詳細の成功読込後 status 照合。既定 reject で keep（hung 回避）
vi.mock("@/features/generation/api/generation-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/api/generation-api")>();
  return {
    ...original,
    getGenerationStatus: getGenerationStatusMock,
  };
});
vi.mock("@/features/generation/api/confirm-label-api", () => ({
  confirmLabelConfirmation: confirmLabelConfirmationMock,
}));
const listDerivationVersionsMock = vi.hoisted(() => vi.fn());
vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return {
    ...original,
    acceptMenuVersion: acceptMenuVersionMock,
    listDerivationVersions: listDerivationVersionsMock,
  };
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
// HR-I1: listPantryItems も success に固定し、再生成 CTA が pending/error で塞がらないようにする。
const listPantryItemsMock = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return {
    ...original,
    listPantryItems: listPantryItemsMock,
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

/** HR5: 再生成 CTA を開くための最小 submission（pantry 欠落なし） */
const regenerableSubmission = {
  mealType: "dinner" as const,
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese" as const,
  targetMode: "household" as const,
  targetMemberIds: ["10000000-0000-4000-8000-000000000001"],
  servings: null,
  timeLimitMinutes: 30 as const,
  budgetPreference: "economy" as const,
  ingredientPreference: null,
  avoidIngredients: [] as string[],
  memo: "",
  pantrySelections: [] as { pantryItemId: string; priority: "prefer_use" | "must_use" }[],
};

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
    sessionProbeDegraded: false,
  };
}

function renderHistoryDetail(
  options: {
    path?: string;
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
  const path = options.path ?? `/history/${MENU_ID}`;
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
    { initialEntries: [path] },
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
  getGenerationStatusMock.mockRejectedValue(new Error("status_not_stubbed"));
  // jsdom 向け native dialog ポリフィル（再生成理由ダイアログ用）
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
  channelHandlers.members = [];
  channelHandlers.allergies = [];
  revalidateMenuMock.mockResolvedValue(validRevalidation);
  getMenuResultMock.mockResolvedValue(makeMenuResultViewModel());
  listPantryItemsMock.mockResolvedValue([]);
  getUsageTodayMock.mockResolvedValue({
    plan: "free" as const,
    plusEntitled: false,
    success: { consumed: 2, limit: 3, remaining: 1 },
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
  acceptMenuVersionMock.mockResolvedValue(undefined);
  // 既定は単一案（スイッチャー非表示・採用は副操作）
  listDerivationVersionsMock.mockResolvedValue([]);
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
    expect(document.querySelector(".revalidation-checking-overlay")).not.toBeNull();
    expect(document.querySelector(".gen-status-indicator")).not.toBeNull();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeDisabled();
    // HR2: gate 未開・未採用では買い物を primary に出さない（checking 中の disabled 買い物 residual を閉じる）
    expect(
      screen.queryByRole("button", { name: "材料の買い物リストを作る" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeDisabled();
    act(() => {
      revalidate.resolve(validRevalidation);
    });
    expect(await screen.findByText("現在の家族設定で確認しました")).toBeVisible();
    expect(document.querySelector(".revalidation-checking-overlay")).toBeNull();
  });

  it("allows regeneration after a changed but valid current-safety result", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "household",
        sourceSubmission: regenerableSubmission,
      }),
    );
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
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeEnabled();
  });

  it("disables この献立にする while checking and enables when revalidation is actionable", async () => {
    const revalidate = deferredPromise<RevalidationResult>();
    renderHistoryDetail({ revalidate: () => revalidate.promise });
    expect(await screen.findByRole("button", { name: "この献立にする" })).toBeDisabled();
    act(() => {
      revalidate.resolve(validRevalidation);
    });
    expect(await screen.findByRole("button", { name: "この献立にする" })).toBeEnabled();
  });

  it("disables mutation CTAs during soft recheck while keeping checked content (HR1/HR2)", async () => {
    // soft 飛行中は phase=checked のまま本文を出し、採用/再生成/買い物とラベル mutation を閉じる
    const view = makeMenuResultViewModel();
    getMenuResultMock.mockResolvedValue(view);
    const sourceId =
      view.menu.dishes[0]?.ingredients[0]?.id ?? "53000000-0000-4000-8000-000000000001";
    renderHistoryDetail({
      revalidation: {
        phase: "checked",
        result: {
          ...validRevalidation,
          // 警告を注入して soft 中でもラベル領域は出すが、確認ボタンは actions 非渡しで消える
          currentLabelWarnings: [
            {
              confirmationId: "48000000-0000-4000-8000-000000000099",
              sourceType: "ingredient",
              sourceId,
              sourcePath: "dishes.0.ingredients.0.name",
              sourceText: "しょうゆ",
              allergenId: "wheat",
              allergenName: "小麦",
              anonymousMemberRef: "member_2",
              memberLabel: "大人",
              dictionaryVersion: "jp-caa-2026-04.v1",
              confirmationStatus: "pending",
            },
          ],
        },
        isSoftRechecking: true,
      },
    });
    expect(await screen.findByText("いまの家族設定を再確認しています")).toBeVisible();
    // 本文ゲートは開いたまま（フル画面 checking オーバーレイは出さない）
    expect(document.querySelector(".revalidation-checking-overlay")).toBeNull();
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeDisabled();
    // ラベル文言は見えるが確認ボタンは出ない（HR2）。しょうゆは材料行と確認リストに重複する
    expect((await screen.findAllByText(/しょうゆ/u)).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "本人が商品の原材料表示を確認しました" }),
    ).toBeNull();
  });

  it("shows offline hold copy instead of generic checking (HR1)", async () => {
    renderHistoryDetail({
      revalidation: {
        phase: "checking",
        isOfflineHold: true,
      },
    });
    expect(await screen.findByText("ネット接続後に現在の家族設定を確認してください")).toBeVisible();
    expect(document.querySelector(".revalidation-checking-overlay")).not.toBeNull();
    expect(screen.queryByText("現在の家族設定で確認しています")).toBeNull();
  });

  it("disables regenerate when source pantry selection is missing from live (HR5)", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "household",
        sourceSubmission: {
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: ["10000000-0000-4000-8000-000000000001"],
          servings: null,
          timeLimitMinutes: 30,
          budgetPreference: "economy",
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [{ pantryItemId: "missing-pantry-id", priority: "prefer_use" }],
        },
      }),
    );
    // live は空 = selection 欠落
    listPantryItemsMock.mockResolvedValue([]);
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });
    expect(
      await screen.findByText(
        "作成時に選んだ冷蔵庫の食材がありません。条件を変えて作り直してください。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeDisabled();
    // 採用・買い物は pantry ゲートと独立（安全再検証のみ）
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
  });

  it("disables regenerate when sourceSubmission is null (HR5)", async () => {
    // factory 既定は null。server envelope 422 を UI で先回りする
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "household", sourceSubmission: null }),
    );
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });
    expect(
      await screen.findByText("作成時の条件を読み込めないため、別案を作り直せません。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeDisabled();
    // 採用は submission と独立
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
  });

  it("calls acceptMenuVersion when この献立にする is clicked while actionable", async () => {
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "この献立にする" }));
    expect(acceptMenuVersionMock).toHaveBeenCalledTimes(1);
    expect(acceptMenuVersionMock).toHaveBeenCalledWith(MENU_ID);
  });

  it("HR8: auxiliary accept is disabled during soft recheck (mirrors primary actionsEnabled)", async () => {
    // 単一案 + actionable → 買い物 primary、補助に「この献立にする」。
    // soft 中は canCreate が落ちて補助が消えるか、残っても disabled。採用 RPC は呼ばない。
    listDerivationVersionsMock.mockResolvedValue([]);
    renderHistoryDetail({
      revalidation: {
        phase: "checked",
        result: validRevalidation,
        isSoftRechecking: true,
      },
    });
    expect(await screen.findByText("いまの家族設定を再確認しています")).toBeVisible();
    const acceptButtons = screen.queryAllByRole("button", { name: "この献立にする" });
    for (const button of acceptButtons) {
      expect(button).toBeDisabled();
    }
    expect(acceptMenuVersionMock).not.toHaveBeenCalled();
  });

  it("after accept, promotes shopping list as the primary next step", async () => {
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "この献立にする" }));
    // 無効な「しました」ボタンは置かず、次の一手を primary に据える
    expect(await screen.findByText(/材料の買い物リストを作ると/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "この献立にする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "この献立にしました" })).toBeNull();
    const shopping = screen.getByRole("button", { name: "材料の買い物リストを作る" });
    // primary-button → ui-btn--primary（共有 Button プリミティブ）
    expect(shopping).toHaveClass("ui-btn", "ui-btn--primary");
    expect(shopping).toBeEnabled();
  });

  it("hides accept notice when revalidation is non-actionable even if isSelected (HR12)", async () => {
    // is_selected でも invalid 時は gate 外のため「採用しました」を出さない
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "household", isSelected: true }),
    );
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
    expect(await screen.findByText("アレルゲンが含まれます")).toBeVisible();
    // MENU_ACCEPT_NOTICE_TITLE
    expect(screen.queryByText("この献立にしました")).toBeNull();
  });

  it("HR2: invalid after accept does not keep disabled shopping as primary", async () => {
    // isSelected でも gate が閉じたら買い物 primary を外し、accept 主操作へ戻す
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "household", isSelected: true }),
    );
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
    expect(await screen.findByText("アレルゲンが含まれます")).toBeVisible();
    // 死んだ買い物 primary ではなく「この献立にする」側へ
    expect(screen.queryByRole("button", { name: "材料の買い物リストを作る" })).toBeNull();
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeDisabled();
  });

  it("keeps この献立にする disabled when revalidation is invalid", async () => {
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
    expect(await screen.findByRole("button", { name: "この献立にする" })).toBeDisabled();
    expect(acceptMenuVersionMock).not.toHaveBeenCalled();
  });

  it("disables retarget while revalidation is checking (HR4)", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "household",
        sourceSubmission: {
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: ["10000000-0000-4000-8000-000000000001"],
          servings: null,
          timeLimitMinutes: 30,
          budgetPreference: "economy",
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [],
        },
      }),
    );
    renderHistoryDetail({
      revalidation: { phase: "checking" },
    });
    expect(await screen.findByRole("button", { name: "条件を変えて作り直す" })).toBeDisabled();
  });

  it("enables retarget when revalidation is checked even if invalid (HR4 escape hatch)", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "household",
        sourceSubmission: {
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: ["10000000-0000-4000-8000-000000000001"],
          servings: null,
          timeLimitMinutes: 30,
          budgetPreference: "economy",
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [],
        },
      }),
    );
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
    expect(await screen.findByRole("button", { name: "条件を変えて作り直す" })).toBeEnabled();
    // accept は invalid で閉じたまま
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeDisabled();
  });

  it("wires shopping create sheet and fridge tip when household actions are enabled", async () => {
    // シート表示と冷蔵庫 tip は残す。送信・resume・actions 到達は後続テストで固定する。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "材料の買い物リストを作る" }));
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();

    const fridge = screen.getByRole("button", { name: "使った食材の在庫を更新" });
    // 冷蔵庫使用ありなら操作可能。クリックで在庫更新ダイアログを開く。
    expect(fridge).toBeEnabled();
    await user.click(fridge);
    expect(await screen.findByRole("dialog", { name: "使った食材の在庫を更新" })).toBeVisible();
  });

  it("submits create shopping list command after sheet confirm", async () => {
    // sheet が開くだけでは不合格。CreateShoppingListRequest 相当の実送信を固定する。
    const user = userEvent.setup();
    const router = renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "材料の買い物リストを作る" }));
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

  it("submits create mode=new with the active list id and version for archive OCC", async () => {
    // active がある「新しいリストにする」は SQL が id/version を要求する。
    // 親が null へ落とすと list_version_conflict になる回帰を固定する。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "材料の買い物リストを作る" }));
    await user.click(screen.getByRole("radio", { name: "新しいリストにする" }));
    await user.click(screen.getByRole("button", { name: "作成する" }));

    await waitFor(() => {
      expect(shoppingApi.createShoppingList).toHaveBeenCalledTimes(1);
    });
    const command = shoppingApi.createShoppingList.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      menuId: MENU_ID,
      mode: "new",
      activeListId: SHOPPING_LIST_ID,
      expectedListVersion: 4,
    });
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

  it("does not resume create shopping while soft rechecking (HR9)", async () => {
    // soft 飛行中は actionsEnabled=false のため resume を止め、pending を残す
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

    renderHistoryDetail({
      revalidation: {
        phase: "checked",
        result: validRevalidation,
        isSoftRechecking: true,
      },
    });

    await screen.findByText("いまの家族設定を再確認しています");
    await act(async () => {
      await Promise.resolve();
    });
    expect(shoppingApi.createShoppingList).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem(pendingShoppingCommandStorageKey("create", MENU_ID)),
    ).not.toBeNull();
  });

  it("disables shopping controls while safety gate is blocked", async () => {
    shoppingApi.revalidateActiveShoppingList.mockResolvedValue(invalidShoppingSafety);

    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await waitFor(() => {
      expect(shoppingApi.revalidateActiveShoppingList).toHaveBeenCalledWith(SHOPPING_LIST_ID);
    });
    // D-C1: 新規リスト作成は gate blocked でも可能なまま。差分確認は隠す。
    // 案一覧確定で主/副が入れ替わるため有効化後に取り直す
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
    });
    expect(screen.queryByRole("button", { name: "買い物リストの差分を見る" })).toBeNull();
  });

  it("invokes pantry delete through MenuResult actions on household history detail", async () => {
    // tip 文だけでは不合格。MenuResult actions 経由で onDeletePantry が実到達すること。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    await user.click(await screen.findByRole("button", { name: "使った食材の在庫を更新" }));
    expect(await screen.findByRole("dialog", { name: "使った食材の在庫を更新" })).toBeVisible();
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
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
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

    const reconcile = await screen.findByRole("button", { name: "買い物リストの差分を見る" });
    await waitFor(() => {
      expect(reconcile).toBeEnabled();
    });
    await user.click(reconcile);

    await waitFor(() => {
      expect(shoppingApi.previewShoppingDiff).toHaveBeenCalledWith(MENU_ID, 2, activeShoppingList);
    });
    expect(await screen.findByRole("heading", { name: "献立変更の差分" })).toBeVisible();
  });

  it("auto-opens create sheet from /history/:id?for=shopping when household can create", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    renderHistoryDetail({
      path: `/history/${MENU_ID}?for=shopping`,
      revalidation: { phase: "checked", result: validRevalidation },
    });
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
  });

  it("uses non-removed itemCount on create sheet", async () => {
    shoppingApi.fetchActiveShoppingList.mockResolvedValue({
      ...activeShoppingList,
      items: [
        {
          id: "40000000-0000-4000-8000-000000000002",
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
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    renderHistoryDetail({
      path: `/history/${MENU_ID}?for=shopping`,
      revalidation: { phase: "checked", result: validRevalidation },
    });
    expect(await screen.findByRole("heading", { name: "買い物リストを作る" })).toBeVisible();
    expect(screen.getByText(/今のリストへ追加（0件）/u)).toBeInTheDocument();
  });
});

describe("HistoryDetailPage idea permitted actions boundary", () => {
  it("shows idea rejection on history detail with for=shopping", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));
    renderHistoryDetail({ path: `/history/${MENU_ID}?for=shopping` });
    expect(await screen.findByText(/アイデア献立は買い物リストに使えません/u)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "買い物リストを作る" })).toBeNull();
    expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
    expect(shoppingApi.createShoppingList).not.toHaveBeenCalled();
  });

  it("renders a permanent notice and permitted actions without mounting revalidation or shopping", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "idea",
        sourceSubmission: {
          ...regenerableSubmission,
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
        },
      }),
    );

    renderHistoryDetail();

    // idea 注意: 設計 §5.4 必須2文は常時表示。AI/ラベル長文はダイアログ
    expect(await screen.findByText("ご確認ください")).toBeVisible();
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
    await userEvent.click(screen.getByRole("button", { name: "注意事項を見る" }));
    const dialog = screen.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent("家族条件を使用していません");
    expect(dialog).toHaveTextContent("年齢・アレルギーへの適合は確認されていません");
    expect(dialog).toHaveTextContent("AIが作成した献立です。");
    expect(dialog).toHaveTextContent(
      "加工品は原材料表示の確認が必要です。表示確認の記録やAI生成レシピだけでは、アレルギー対応や食べて安全であることを保証するものではありません。",
    );
    // idea では家族 revalidation と買い物 hooks/API を mount しない
    expect(revalidateMenuMock).not.toHaveBeenCalled();
    expect(shoppingApi.fetchActiveShoppingList).not.toHaveBeenCalled();
    expect(shoppingApi.fetchReconcilableMenuSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "材料の買い物リストを作る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "買い物リストの差分を見る" })).toBeNull();
    // 許可操作: 採用・お気に入り・冷蔵庫・whole/dish 再生成
    expect(screen.getByRole("button", { name: "この献立にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeEnabled();
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

    expect(await screen.findByText("ご確認ください")).toBeVisible();
    const themedRoot = document.querySelector(".guided-planner-theme");
    expect(themedRoot).not.toBeNull();
    expect(themedRoot?.textContent).not.toMatch(/確認済み|安全に配慮|アレルギー対応済み/u);
  });

  it("hides child_friendly in idea regeneration dialog", async () => {
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({
        targetMode: "idea",
        sourceSubmission: {
          ...regenerableSubmission,
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
        },
      }),
    );
    renderHistoryDetail();
    await userEvent.click(
      await screen.findByRole("button", { name: "この案を元に別の献立を作り直す" }),
    );
    expect(screen.getByRole("dialog", { name: "どのように変えますか？" })).toBeVisible();
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
        ["menu-result", USER_ID, MENU_ID, "history"],
        makeMenuResultViewModel({ targetMode: "idea", isFavorite: true }),
      );
    });

    expect(await screen.findByRole("button", { name: "お気に入りを外す" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("HR5: clears idea accepted chrome when result.isSelected becomes false", async () => {
    // 兄弟案採用で isSelected が false になったとき、household と同型で accepted を落とす。
    // 複数案時は primary が「この献立にする」に戻り、notice も消える（旧実装は residual true で残る）。
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    listDerivationVersionsMock.mockResolvedValue([
      {
        id: MENU_ID,
        version: 1,
        title: "案A",
        isSelected: true,
        createdAt: "2026-07-11T00:00:00.000Z",
        parentMenuId: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        version: 2,
        title: "案B",
        isSelected: false,
        createdAt: "2026-07-11T01:00:00.000Z",
        parentMenuId: MENU_ID,
      },
    ]);
    getMenuResultMock.mockResolvedValue(
      makeMenuResultViewModel({ targetMode: "idea", isSelected: true }),
    );

    renderHistoryDetail({ queryClient });

    expect(await screen.findByText("この献立にしました")).toBeVisible();
    expect(screen.getByRole("link", { name: "履歴一覧に戻る" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "この献立にする" })).toBeNull();

    act(() => {
      queryClient.setQueryData(
        ["menu-result", USER_ID, MENU_ID, "history"],
        makeMenuResultViewModel({ targetMode: "idea", isSelected: false }),
      );
    });

    expect(await screen.findByRole("button", { name: "この献立にする" })).toBeVisible();
    expect(screen.queryByText("この献立にしました")).toBeNull();
    expect(screen.queryByRole("link", { name: "履歴一覧に戻る" })).toBeNull();
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
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
  });

  it.each(["realtime-household-member", "realtime-member-allergy", "online"] as const)(
    "fails closed and starts a fresh current-safety check for %s",
    async (signal) => {
      const revalidate = deferredPromise<RevalidationResult>();
      renderMenuResultPage({
        initialRevalidation: validRevalidation,
        nextRevalidation: revalidate.promise,
      });
      expect(await screen.findByRole("heading", { name: /献立/u })).toBeVisible();
      act(() => {
        fireSafetySignal(signal);
      });
      // Realtime / online 復帰は hard: フルゲートで本文・操作を閉じる
      expect(
        screen
          .getAllByRole("status")
          .some((node) => node.textContent.includes("現在の家族設定で確認しています")),
      ).toBe(true);
      expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
      act(() => {
        revalidate.resolve(validRevalidation);
      });
      expect(await screen.findByRole("button", { name: "使った食材の在庫を更新" })).toBeEnabled();
    },
  );

  it.each(["focus", "visible-visibilitychange", "sixty-second-poll"] as const)(
    "soft-rechecks in background without hard overlay for %s (HR1 shared body)",
    async (signal) => {
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
      // soft: ハードオーバーレイ文言は出さず本文は維持。mutation CTA は HR1 で閉じる。
      expect(
        screen
          .queryAllByRole("status")
          .some((node) => node.textContent.includes("現在の家族設定で確認しています")),
      ).toBe(false);
      expect(await screen.findByText("いまの家族設定を再確認しています")).toBeVisible();
      expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
      expect(screen.getByRole("heading", { name: /献立/u })).toBeVisible();
      await act(async () => {
        revalidate.resolve(validRevalidation);
        await revalidate.promise;
      });
      // soft 完了後 isSoftRechecking が下りるまで RQ の isFetching 解除を待つ
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeEnabled();
      });
      if (signal === "sixty-second-poll") vi.useRealTimers();
    },
  );

  it("lists invalid issues and keeps content closed", async () => {
    revalidateMenuMock.mockResolvedValue({
      ...validRevalidation,
      status: "invalid",
      issues: [{ code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" }],
    });
    renderMenuResultPage({});
    expect(await screen.findByText("アレルゲンが含まれます")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "材料" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeDisabled();
  });

  it("shows もう一度確認 on network failure without a manual-success escape", async () => {
    revalidateMenuMock.mockRejectedValue(new Error("network"));
    renderMenuResultPage({});
    expect(await screen.findByRole("button", { name: "もう一度確認" })).toBeVisible();
    expect(screen.getByRole("button", { name: "使った食材の在庫を更新" })).toBeDisabled();
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
