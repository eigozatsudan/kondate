import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import type {
  ShoppingDiff,
  ShoppingItem,
  ShoppingLabelSnapshot,
  ShoppingItemMutationRequest,
  ShoppingList,
  ShoppingListSafetyData,
  StoreSection,
} from "@shared/contracts/shopping";
import { CreateListSheet } from "../components/create-list-sheet";
import { ReconcileListSheet } from "../components/reconcile-list-sheet";
import { shoppingKeys } from "../hooks/use-shopping-list";
import { categoryLabel, ShoppingListPage } from "./shopping-list-page";
import {
  clearShoppingCommand,
  pendingShoppingCommandStorageKey,
  pendingShoppingCommandTtlMs,
  persistedShoppingCommand,
} from "../api/shopping-api";
import { z } from "zod";

const LIST_ID = "40000000-0000-4000-8000-000000000001";
const ITEM_ID = "40000000-0000-4000-8000-000000000002";
const OTHER_ITEM_ID = "40000000-0000-4000-8000-000000000003";
const MENU_ID = "40000000-0000-4000-8000-000000000004";
const DERIVATION_ID = "40000000-0000-4000-8000-000000000005";
const SOURCE_ID = "40000000-0000-4000-8000-000000000006";
const DISH_ID = "40000000-0000-4000-8000-000000000007";
const INGREDIENT_ID = "40000000-0000-4000-8000-000000000008";
const OWNER_ID = "40000000-0000-4000-8000-0000000000ff";
const OTHER_OWNER_ID = "40000000-0000-4000-8000-0000000000fe";
const FINGERPRINT = "a".repeat(64);
const NEXT_FINGERPRINT = "b".repeat(64);
const WARNING_KEY = "c".repeat(64);
const OTHER_WARNING_KEY = "d".repeat(64);

type ShoppingApiModule = typeof import("../api/shopping-api");

const shoppingApi = vi.hoisted(() => ({
  fetchActiveShoppingList: vi.fn<ShoppingApiModule["fetchActiveShoppingList"]>(),
  revalidateActiveShoppingList: vi.fn<ShoppingApiModule["revalidateActiveShoppingList"]>(),
  mutateShoppingItem: vi.fn<ShoppingApiModule["mutateShoppingItem"]>(),
  createShoppingList: vi.fn<ShoppingApiModule["createShoppingList"]>(),
  reconcileShoppingListRequest: vi.fn<ShoppingApiModule["reconcileShoppingListRequest"]>(),
  previewShoppingDiff: vi.fn<ShoppingApiModule["previewShoppingDiff"]>(),
}));

vi.mock("../api/shopping-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/shopping-api")>();
  return { ...original, ...shoppingApi };
});

// Supabase Realtime は owner filter 付きで登録される。テストからは filter 文字列ごと
// 記録し、別 owner の payload が callback に届かないことまで検証する。
const realtime = vi.hoisted(() => ({
  ownerId: null as string | null,
  getUserError: null as { message: string } | null,
  channelNames: [] as string[],
  handlers: [] as { table: string; filter: string; callback: () => void }[],
  statusCallback: null as null | ((status: string) => void),
  removeChannel: vi.fn(),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: realtime.ownerId === null ? null : { id: realtime.ownerId } },
          error: realtime.getUserError,
        }),
    },
    channel: (name: string) => {
      realtime.channelNames.push(name);
      const channel = {
        on: (_event: string, filter: { table: string; filter: string }, callback: () => void) => {
          realtime.handlers.push({ table: filter.table, filter: filter.filter, callback });
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          realtime.statusCallback = callback;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: realtime.removeChannel,
  }),
}));

function emitRealtime(table: string, ownerId: string): void {
  for (const handler of realtime.handlers) {
    if (handler.table === table && handler.filter === `user_id=eq.${ownerId}`) handler.callback();
  }
}

function makeLabelSnapshot(overrides: Partial<ShoppingLabelSnapshot> = {}): ShoppingLabelSnapshot {
  return {
    confirmationId: null,
    warningKey: WARNING_KEY,
    sourceMenuId: MENU_ID,
    sourceDerivationGroupId: DERIVATION_ID,
    sourceType: "ingredient",
    sourceId: SOURCE_ID,
    sourcePath: "dishes.0.ingredients.0",
    allergenId: "milk",
    allergenDisplayName: "乳",
    anonymousMemberRef: "member_1",
    memberDisplayName: "はなこ",
    sourceDisplayName: "デミグラスソース",
    dictionaryVersion: "allergens-v3",
    confirmationStatus: "pending",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: ITEM_ID,
    listId: LIST_ID,
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    pantryCheckRequired: false,
    isChecked: false,
    isManual: false,
    isManuallyEdited: false,
    isRemovedByUser: false,
    labelWarnings: [],
    ...overrides,
  };
}

function makeShoppingList(
  items: ShoppingItem[],
  overrides: Partial<ShoppingList> = {},
): ShoppingList {
  return {
    id: LIST_ID,
    status: "active",
    version: 1,
    items,
    listLabelWarnings: [],
    ...overrides,
  };
}

function validSafety(safetyFingerprint = FINGERPRINT): ShoppingListSafetyData {
  return {
    status: "valid",
    safetyFingerprint,
    checkedSourceMenuIds: [MENU_ID],
    currentLabelWarnings: [],
    issues: [],
  };
}

function invalidSafety(message: string): ShoppingListSafetyData {
  return {
    status: "invalid",
    safetyFingerprint: null,
    checkedSourceMenuIds: [MENU_ID],
    currentLabelWarnings: [],
    issues: [{ code: "current_safety_invalid", message, sourceMenuId: MENU_ID }],
  };
}

function unverifiableSafety(message: string): ShoppingListSafetyData {
  return {
    status: "unverifiable",
    safetyFingerprint: null,
    checkedSourceMenuIds: [],
    issues: [{ code: "source_menu_unavailable", message, sourceMenuId: MENU_ID }],
    currentLabelWarnings: [],
  };
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const { fetchActiveShoppingList, mutateShoppingItem, revalidateActiveShoppingList } = shoppingApi;

let user: ReturnType<typeof userEvent.setup>;
let queryClient: QueryClient;

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** ゲートが ready になるまで待つ。ready 前は全ての書き込み操作が disabled のため。 */
async function waitForGateReady(): Promise<void> {
  await waitFor(() => {
    // 読み込み中は「再確認しています」も出ないため、両方の消滅を待たないと
    // ゲートが開く前に操作してしまう。
    expect(screen.queryByText("買い物リストを読み込んでいます")).not.toBeInTheDocument();
    expect(screen.queryByText("現在の家族設定で再確認しています")).not.toBeInTheDocument();
  });
}

/**
 * 設計書の verbatim テストは `renderPage(list)` と書くが、能動的な安全ゲートは
 * 非同期にしか ready にならないため await を機械的に補っている（アサーションは不変）。
 */
async function renderPage(
  list: ShoppingList | null,
  safety: ShoppingListSafetyData = validSafety(),
): Promise<void> {
  fetchActiveShoppingList.mockResolvedValue(list);
  revalidateActiveShoppingList.mockResolvedValue(safety);
  mutateShoppingItem.mockResolvedValue({
    listId: LIST_ID,
    version: 2,
    itemId: ITEM_ID,
    replayed: false,
  });
  render(
    <Providers>
      <ShoppingListPage />
    </Providers>,
  );
  await waitForGateReady();
}

/** 「家にある」後にサーバが返す除外済みリストへ差し替え、再読込を反映させる。 */
async function rerenderRemovedPage(): Promise<void> {
  fetchActiveShoppingList.mockResolvedValue(
    makeShoppingList([makeItem({ isRemovedByUser: true })], { version: 2 }),
  );
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: shoppingKeys.active });
  });
  await screen.findByRole("button", { name: "元に戻す" });
}

beforeEach(() => {
  // offline を発火するテストは TanStack Query の onlineManager（モジュール単位の
  // シングルトン）を offline のまま残し、以降の全クエリを paused にしてしまう。
  // unmount 後は window listener も外れて online イベントで戻らないため、
  // 各テストの開始時にグローバル状態だけ明示的に戻す（アサーションには影響しない）。
  onlineManager.setOnline(true);
  vi.resetAllMocks();
  realtime.ownerId = OWNER_ID;
  realtime.getUserError = null;
  realtime.channelNames = [];
  realtime.handlers = [];
  realtime.statusCallback = null;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  user = userEvent.setup();
});

afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});

describe("ShoppingListPage safety gate", () => {
  it("blocks every write control on mount until the server revalidation succeeds", async () => {
    const deferred = deferredPromise<ShoppingListSafetyData>();
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    const checkbox = await screen.findByRole("checkbox", { name: /購入済みにする/u });
    expect(checkbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "数量・単位・売り場を編集" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "＋ 項目を追加" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("現在の家族設定で再確認しています");
    await act(async () => {
      deferred.resolve(validSafety());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(checkbox).not.toBeDisabled();
    });
  });

  it("keeps controls disabled while only the active list reload resolves, then re-enables after the server revalidation", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    const checkbox = screen.getByRole("checkbox", { name: /購入済みにする/u });
    expect(checkbox).not.toBeDisabled();

    const deferred = deferredPromise<ShoppingListSafetyData>();
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const listReload = deferredPromise<ShoppingList>();
    fetchActiveShoppingList.mockReturnValueOnce(listReload.promise);

    act(() => {
      window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
    });
    // 同一 tick で閉じる
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: shoppingKeys.active, exact: true }),
    );

    // リスト再取得だけを解決してもゲートは開かない
    await act(async () => {
      listReload.resolve(makeShoppingList([makeItem()]));
      await Promise.resolve();
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();

    await act(async () => {
      deferred.resolve(validSafety(NEXT_FINGERPRINT));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).not.toBeDisabled();
    });

    // 再開後の最初の書き込みは新しい fingerprint を運ぶ
    await user.click(screen.getByRole("checkbox", { name: /購入済みにする/u }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSafetyFingerprint: NEXT_FINGERPRINT }),
    );
  });

  it("closes on the exact revision storage key and ignores unrelated storage keys", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    const before = revalidateActiveShoppingList.mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "kondate:unrelated", newValue: "x" }),
      );
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).not.toBeDisabled();
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);

    const deferred = deferredPromise<ShoppingListSafetyData>();
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: householdSafetyRevisionStorageKey,
          newValue: crypto.randomUUID(),
        }),
      );
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    await act(async () => {
      deferred.resolve(validSafety());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).not.toBeDisabled();
    });
  });

  it.each([
    ["focus", () => window.dispatchEvent(new Event("focus"))],
    ["online", () => window.dispatchEvent(new Event("online"))],
    ["visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("closes the gate synchronously on %s and starts a fresh revalidation", async (_name, fire) => {
    await renderPage(makeShoppingList([makeItem()]));
    const before = revalidateActiveShoppingList.mock.calls.length;
    const deferred = deferredPromise<ShoppingListSafetyData>();
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);

    act(() => {
      fire();
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    await act(async () => {
      deferred.resolve(validSafety());
      await Promise.resolve();
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before + 1);
  });

  it.each(["household_members", "member_allergies"])(
    "closes the gate on an owner-filtered %s realtime payload and never on another owner",
    async (table) => {
      await renderPage(makeShoppingList([makeItem()]));
      await waitFor(() => {
        expect(realtime.handlers.length).toBeGreaterThanOrEqual(2);
      });
      const before = revalidateActiveShoppingList.mock.calls.length;

      // 別 owner の payload は登録済み filter に一致せず callback に届かない
      act(() => {
        emitRealtime(table, OTHER_OWNER_ID);
      });
      expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).not.toBeDisabled();
      expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);

      const deferred = deferredPromise<ShoppingListSafetyData>();
      revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);
      act(() => {
        emitRealtime(table, OWNER_ID);
      });
      expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
      await act(async () => {
        deferred.resolve(validSafety());
        await Promise.resolve();
      });
      expect(revalidateActiveShoppingList.mock.calls.length).toBe(before + 1);
    },
  );

  it("runs a fresh check on SUBSCRIBED and disables immediately on CHANNEL_ERROR and TIMED_OUT", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    await waitFor(() => {
      expect(realtime.statusCallback).not.toBeNull();
    });
    const before = revalidateActiveShoppingList.mock.calls.length;
    await act(async () => {
      realtime.statusCallback?.("SUBSCRIBED");
      await Promise.resolve();
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before + 1);

    act(() => {
      realtime.statusCallback?.("CHANNEL_ERROR");
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "現在の家族設定の更新を確認できませんでした",
    );

    act(() => {
      realtime.statusCallback?.("TIMED_OUT");
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
  });

  it("disables immediately when the browser goes offline", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ネット接続後に現在の家族設定を確認してください",
    );
  });

  it.each([
    ["invalid", invalidSafety("現在の家族設定ではこのリストを使えません")],
    ["deleted source", unverifiableSafety("元の献立が見つかりませんでした")],
  ])("keeps the gate closed with the returned message for a %s result", async (_name, safety) => {
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockResolvedValue(safety);
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    const message = safety.issues[0]?.message ?? "";
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
  });

  it("keeps the gate closed with a human message when the revalidation rejects", async () => {
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockRejectedValue(new Error("network"));
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "現在の家族設定を確認できませんでした",
    );
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
  });

  it("does not poll before 60 seconds and revalidates at 60 seconds while visible and online", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // shouldAdvanceTime は初回描画待ちの実時間ぶんも偽クロックを進めるため、
    // 60 秒間隔の起点（mount 時刻）から数え直して 59,999ms 丁度に合わせる。
    const mountedAt = Date.now();
    await renderPage(makeShoppingList([makeItem()]));
    const before = revalidateActiveShoppingList.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999 - (Date.now() - mountedAt));
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);

    const deferred = deferredPromise<ShoppingListSafetyData>();
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before + 1);
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    await act(async () => {
      deferred.resolve(validSafety());
      await Promise.resolve();
    });
  });

  it("does not call the server from a hidden or offline poll interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderPage(makeShoppingList([makeItem()]));
    const before = revalidateActiveShoppingList.mock.calls.length;

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);
    visibility.mockRestore();

    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);
    online.mockRestore();
  });

  it("removes every listener, the interval, and the realtime channel on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockResolvedValue(validSafety());
    const view = render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    await waitForGateReady();
    await waitFor(() => {
      expect(realtime.handlers.length).toBeGreaterThanOrEqual(2);
    });
    const before = revalidateActiveShoppingList.mock.calls.length;

    view.unmount();

    const removedWindowEvents = removeWindow.mock.calls.map(([name]) => name);
    expect(removedWindowEvents).toEqual(
      expect.arrayContaining([
        householdSafetyChangedEvent,
        "storage",
        "focus",
        "online",
        "offline",
      ]),
    );
    expect(removeDocument.mock.calls.map(([name]) => name)).toContain("visibilitychange");
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(revalidateActiveShoppingList.mock.calls.length).toBe(before);
  });

  it("closes and reruns the gate without writing when the database reports a fingerprint conflict", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    // クライアント側シグナルを全て抑止した状態でも、DB の競合だけでゲートは閉じる
    mutateShoppingItem.mockRejectedValueOnce(
      Object.assign(new Error("家族設定が変わりました"), {
        code: "shopping_safety_fingerprint_changed",
      }),
    );
    const deferred = deferredPromise<ShoppingListSafetyData>();
    revalidateActiveShoppingList.mockReturnValueOnce(deferred.promise);

    await user.click(screen.getByRole("checkbox", { name: /購入済みにする/u }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
    });
    expect(mutateShoppingItem).toHaveBeenCalledTimes(1);
    expect(revalidateActiveShoppingList).toHaveBeenCalledTimes(2);
    await act(async () => {
      deferred.resolve(validSafety(NEXT_FINGERPRINT));
      await Promise.resolve();
    });
  });

  it("never writes while the gate is closed", async () => {
    fetchActiveShoppingList.mockResolvedValue(makeShoppingList([makeItem()]));
    revalidateActiveShoppingList.mockResolvedValue(invalidSafety("設定を確認できません"));
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    const checkbox = await screen.findByRole("checkbox", { name: /購入済みにする/u });
    await user.click(checkbox);
    expect(mutateShoppingItem).not.toHaveBeenCalled();
  });
});

describe("ShoppingListPage warnings and grouping", () => {
  it("labels all six store sections including seasonings", () => {
    const expected: Record<StoreSection, string> = {
      produce: "野菜",
      meat_fish: "肉・魚",
      dairy_eggs: "乳製品・卵",
      dry_goods: "乾物",
      seasonings: "調味料",
      other: "その他",
    };
    for (const [section, label] of Object.entries(expected)) {
      expect(categoryLabel(section as StoreSection)).toBe(label);
    }
    expect(categoryLabel("seasonings")).toBe("調味料");
  });

  it("groups items under their store section headings", async () => {
    await renderPage(
      makeShoppingList([
        makeItem({ id: ITEM_ID, displayName: "にんじん", storeSection: "produce" }),
        makeItem({ id: OTHER_ITEM_ID, displayName: "しょうゆ", storeSection: "seasonings" }),
      ]),
    );
    expect(screen.getByRole("heading", { name: "野菜" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "調味料" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "乾物" })).not.toBeInTheDocument();
  });

  it("renders only the current projection as authoritative warnings once the gate is ready", async () => {
    await renderPage(
      makeShoppingList([makeItem({ labelWarnings: [makeLabelSnapshot()] })], {
        listLabelWarnings: [makeLabelSnapshot({ warningKey: OTHER_WARNING_KEY })],
      }),
      {
        status: "valid",
        safetyFingerprint: FINGERPRINT,
        checkedSourceMenuIds: [MENU_ID],
        currentLabelWarnings: [
          {
            itemId: ITEM_ID,
            warningKey: WARNING_KEY,
            sourceMenuId: MENU_ID,
            sourceDerivationGroupId: DERIVATION_ID,
            sourceType: "ingredient",
            sourceId: SOURCE_ID,
            sourcePath: "dishes.0.ingredients.0",
            allergenId: "milk",
            allergenDisplayName: "乳",
            anonymousMemberRef: "member_1",
            memberDisplayName: "はなこ",
            sourceDisplayName: "デミグラスソース",
            dictionaryVersion: "allergens-v3",
          },
        ],
        issues: [],
      },
    );
    expect(screen.getByText("デミグラスソース・乳・はなこ")).toBeInTheDocument();
    // 保存済み provenance は current authority に昇格しない
    expect(screen.queryByText("現在の条件では確認できない過去の警告")).not.toBeInTheDocument();
    expect(screen.queryByText(SOURCE_ID)).not.toBeInTheDocument();
    expect(screen.queryByText("member_1")).not.toBeInTheDocument();
  });

  it("renders immutable snapshots in a separate read-only section when the gate is blocked", async () => {
    fetchActiveShoppingList.mockResolvedValue(
      makeShoppingList([
        makeItem({ labelWarnings: [makeLabelSnapshot({ confirmationId: null })] }),
      ]),
    );
    revalidateActiveShoppingList.mockResolvedValue(unverifiableSafety("元の献立が見つかりません"));
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    const section = await screen.findByLabelText("過去の原材料表示警告");
    expect(section).toHaveTextContent("現在の条件では確認できない過去の警告");
    expect(section).toHaveTextContent("デミグラスソース・乳・はなこ");
    expect(section).not.toHaveTextContent("確認済み");
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u })).toBeDisabled();
  });

  it("renders an empty state with a link to the history page", async () => {
    fetchActiveShoppingList.mockResolvedValue(null);
    revalidateActiveShoppingList.mockResolvedValue(validSafety());
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    expect(await screen.findByText("買い物リストは空です")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "献立から作る" })).toBeInTheDocument();
    expect(revalidateActiveShoppingList).not.toHaveBeenCalled();
  });

  it("renders a human error when the active list cannot be loaded", async () => {
    fetchActiveShoppingList.mockRejectedValue(new Error("買い物リストを読み込めませんでした"));
    revalidateActiveShoppingList.mockResolvedValue(validSafety());
    render(
      <Providers>
        <ShoppingListPage />
      </Providers>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("読み込めませんでした");
  });

  it("gives every control a 44px minimum touch target", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    expect(screen.getByRole("button", { name: "数量・単位・売り場を編集" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "家にある" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "削除" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "＋ 項目を追加" })).toHaveClass("min-h-11");
    expect(screen.getByRole("checkbox", { name: /購入済みにする/u }).parentElement).toHaveClass(
      "min-h-11",
    );
  });
});

describe("ShoppingListPage mutations", () => {
  it("edits quantity, marks an item at home, and explicitly undoes it", async () => {
    await renderPage(
      makeShoppingList([makeItem({ displayName: "にんじん", quantityValue: 1, unit: "本" })]),
    );
    await user.click(screen.getByRole("button", { name: "数量・単位・売り場を編集" }));
    await user.clear(screen.getByLabelText("にんじんの数量"));
    await user.type(screen.getByLabelText("にんじんの数量"), "3");
    await user.clear(screen.getByLabelText("にんじんの分量表記"));
    await user.type(screen.getByLabelText("にんじんの分量表記"), "3袋");
    await user.clear(screen.getByLabelText("にんじんの単位"));
    await user.type(screen.getByLabelText("にんじんの単位"), "袋");
    await user.selectOptions(screen.getByLabelText("にんじんの売り場"), "other");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "edit",
        expectedListVersion: 1,
        expectedSafetyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) as string,
        payload: expect.objectContaining({
          quantityValue: 3,
          quantityText: "3袋",
          unit: "袋",
          storeSection: "other",
        }) as ShoppingItemMutationRequest["payload"],
      }),
    );
    await user.click(screen.getByRole("button", { name: "家にある" }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "mark_at_home" }),
    );
    await rerenderRemovedPage();
    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(expect.objectContaining({ operation: "undo" }));
  });

  it("reloads after another tab advances the expected list version", async () => {
    mutateShoppingItem.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { code: "list_version_conflict" }),
    );
    await renderPage(makeShoppingList([makeItem()]));
    fetchActiveShoppingList.mockClear();
    await user.click(screen.getByRole("checkbox", { name: /購入済みにする/u }));
    await waitFor(() => {
      expect(fetchActiveShoppingList).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("別の画面で更新されました");
  });

  it("sends a new idempotency key, the rendered list version, and the latest fingerprint for every write", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    await user.click(screen.getByRole("checkbox", { name: /購入済みにする/u }));
    await user.click(screen.getByRole("button", { name: "家にある" }));
    const keys = mutateShoppingItem.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const [input] of mutateShoppingItem.mock.calls) {
      expect(input.listId).toBe(LIST_ID);
      expect(input.expectedListVersion).toBe(1);
      expect(input.expectedSafetyFingerprint).toBe(FINGERPRINT);
    }
  });

  it("adds a manual item with optional quantity and unit", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    await user.click(screen.getByRole("button", { name: "＋ 項目を追加" }));
    await user.type(screen.getByLabelText("項目名"), "とうふ");
    await user.type(screen.getByLabelText("数量"), "2");
    await user.clear(screen.getByLabelText("分量表記"));
    await user.type(screen.getByLabelText("分量表記"), "2丁");
    await user.type(screen.getByLabelText("単位"), "丁");
    await user.selectOptions(screen.getByLabelText("売り場"), "dairy_eggs");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "add_manual",
        itemId: null,
        payload: expect.objectContaining({
          displayName: "とうふ",
          quantityValue: 2,
          quantityText: "2丁",
          unit: "丁",
          storeSection: "dairy_eggs",
          pantryCheckRequired: false,
        }) as ShoppingItemMutationRequest["payload"],
      }),
    );
  });

  it("shows a field error and keeps focus in the form for invalid manual input", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    await user.click(screen.getByRole("button", { name: "＋ 項目を追加" }));
    await user.clear(screen.getByLabelText("分量表記"));
    await user.type(screen.getByLabelText("分量表記"), " ");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert")).toHaveTextContent("項目名と分量を確認してください");
    expect(mutateShoppingItem).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText("項目名")).toHaveFocus();
    });
  });

  it("removes an item through the owner RPC and never through a direct table write", async () => {
    await renderPage(makeShoppingList([makeItem()]));
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(mutateShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "remove", itemId: ITEM_ID, payload: {} }),
    );
  });
});

describe("CreateListSheet", () => {
  it("submits the exact active list id and version for an append", async () => {
    const onSubmit = vi.fn();
    render(
      <CreateListSheet
        activeList={{ id: LIST_ID, version: 3, itemCount: 7 }}
        pending={false}
        safetyBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/今のリストへ追加（7件）/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "作成する" }));
    expect(onSubmit).toHaveBeenCalledWith({
      mode: "append",
      activeListId: LIST_ID,
      expectedListVersion: 3,
    });
  });

  it("submits a new list with null expectations when none is active", async () => {
    const onSubmit = vi.fn();
    render(
      <CreateListSheet
        activeList={null}
        pending={false}
        safetyBlocked={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "作成する" }));
    expect(onSubmit).toHaveBeenCalledWith({
      mode: "new",
      activeListId: null,
      expectedListVersion: null,
    });
  });

  it("disables creation while the safety gate is blocked", () => {
    render(
      <CreateListSheet
        activeList={null}
        pending={false}
        safetyBlocked
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "作成する" })).toBeDisabled();
  });
});

describe("ReconcileListSheet", () => {
  const diff: ShoppingDiff = {
    add: [
      {
        key: "add-key-1",
        displayName: "たまねぎ",
        normalizedName: "たまねぎ",
        storeSection: "produce",
        quantityValue: 2,
        quantityText: "2個",
        unit: "個",
        pantryCheckRequired: true,
        sourceIngredients: [
          {
            ingredientId: INGREDIENT_ID,
            dishId: DISH_ID,
            dishName: "カレー",
            name: "たまねぎ",
            quantityValue: 2,
            quantityText: "2個",
            unit: "個",
            storeSection: "produce",
          },
        ],
        labelWarnings: [makeLabelSnapshot()],
      },
    ],
    replace: [
      {
        itemId: ITEM_ID,
        current: { displayName: "にんじん", quantityText: "1本", storeSection: "produce" },
        next: {
          key: "replace-key-1",
          displayName: "にんじん",
          normalizedName: "にんじん",
          storeSection: "produce",
          quantityValue: 3,
          quantityText: "3本",
          unit: "本",
          pantryCheckRequired: false,
          sourceIngredients: [
            {
              ingredientId: INGREDIENT_ID,
              dishId: DISH_ID,
              dishName: "肉じゃが",
              name: "にんじん",
              quantityValue: 3,
              quantityText: "3本",
              unit: "本",
              storeSection: "produce",
            },
          ],
          labelWarnings: [],
        },
      },
    ],
    remove: [{ itemId: OTHER_ITEM_ID, displayName: "しょうゆ", quantityText: "大さじ1" }],
    protectedItemIds: [ITEM_ID],
    listLabelWarnings: [makeLabelSnapshot({ warningKey: OTHER_WARNING_KEY })],
  };

  it("renders every human name, quantity change, dish source, pantry check, and warning", () => {
    render(
      <ReconcileListSheet
        diff={diff}
        pending={false}
        safetyBlocked={false}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("たまねぎ 2個")).toBeInTheDocument();
    expect(screen.getByText("使用先：カレー")).toBeInTheDocument();
    expect(screen.getByText("在庫量を確認")).toBeInTheDocument();
    expect(screen.getByText("原材料表示：デミグラスソース・乳・はなこ")).toBeInTheDocument();
    expect(screen.getByText(/1本 → 3本/u)).toBeInTheDocument();
    expect(screen.getByText("使用先：肉じゃが")).toBeInTheDocument();
    expect(screen.getByText("しょうゆ 大さじ1を外す")).toBeInTheDocument();
    expect(screen.getByText("購入済み・手動変更の項目はそのまま残します。")).toBeInTheDocument();
    expect(screen.getByText("原材料表示を確認：デミグラスソース・乳・はなこ")).toBeInTheDocument();
  });

  it("omits only the deselected operation and approves keys and ids only", async () => {
    const onApply = vi.fn();
    render(
      <ReconcileListSheet
        diff={diff}
        pending={false}
        safetyBlocked={false}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "選んだ変更を反映" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const approval = onApply.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(approval).sort()).toEqual(["addKeys", "removeItemIds", "replaceItemIds"]);
    expect(approval).toEqual({
      addKeys: [],
      replaceItemIds: [ITEM_ID],
      removeItemIds: [OTHER_ITEM_ID],
    });
  });

  it("disables applying while the safety gate is blocked", () => {
    render(
      <ReconcileListSheet
        diff={diff}
        pending={false}
        safetyBlocked
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "選んだ変更を反映" })).toBeDisabled();
  });
});

describe("persistedShoppingCommand", () => {
  const schema = z.object({ menuId: z.uuid(), idempotencyKey: z.uuid() }).strict();
  const build = (idempotencyKey: string) => ({ menuId: MENU_ID, idempotencyKey });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays the byte-identical command within 24 hours without a second click", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const first = persistedShoppingCommand("create", MENU_ID, schema, build);
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z").getTime() + pendingShoppingCommandTtlMs);
    const replayed = persistedShoppingCommand("create", MENU_ID, schema, build);
    expect(replayed).toEqual(first);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(first));
  });

  it("clears and never sends a record older than 24 hours by one millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const first = persistedShoppingCommand("reconcile", LIST_ID, schema, build);
    vi.setSystemTime(
      new Date("2026-07-22T00:00:00.000Z").getTime() + pendingShoppingCommandTtlMs + 1,
    );
    const next = persistedShoppingCommand("reconcile", LIST_ID, schema, build);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("discards a record with a future timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const first = persistedShoppingCommand("create", MENU_ID, schema, build);
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    const next = persistedShoppingCommand("create", MENU_ID, schema, build);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("discards a corrupt record and clears it on demand", () => {
    sessionStorage.setItem(pendingShoppingCommandStorageKey("create", MENU_ID), "{ not json");
    const command = persistedShoppingCommand("create", MENU_ID, schema, build);
    expect(command.menuId).toBe(MENU_ID);
    clearShoppingCommand("create", MENU_ID);
    expect(sessionStorage.getItem(pendingShoppingCommandStorageKey("create", MENU_ID))).toBeNull();
  });
});
