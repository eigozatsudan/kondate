import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";
import type { RevalidationResult } from "../api/revalidation-api";
import { HistoryDetailPage, type HistoryDetailRevalidationView } from "./history-detail-page";

const revalidateMenuMock = vi.hoisted(() => vi.fn());
const getMenuResultMock = vi.hoisted(() => vi.fn());
const getUsageTodayMock = vi.hoisted(() => vi.fn());
const acceptMenuVersionMock = vi.hoisted(() => vi.fn());
const channelHandlers = vi.hoisted(() => ({
  members: null as null | (() => void),
  allergies: null as null | (() => void),
}));
// hoisted mock から参照する固定 UUID（下の const より前に置く）
const MOCK_USER_ID = "31000000-0000-4000-8000-000000000001";

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
vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return { ...original, acceptMenuVersion: acceptMenuVersionMock };
});
vi.mock("@/features/generation/model/pending-generation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/generation/model/pending-generation")>();
  return { ...original, clearPendingGeneration: vi.fn() };
});
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    channel: () => {
      const api = {
        on: (_event: string, filter: { table?: string }, callback: () => void) => {
          if (filter.table === "household_members") channelHandlers.members = callback;
          if (filter.table === "member_allergies") channelHandlers.allergies = callback;
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

// 買い物 hooks を決定論的に通す（Realtime/getUser 依存のゲートを page テストから外す）
vi.mock("@/features/shopping/hooks/use-shopping-list", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/shopping/hooks/use-shopping-list")>();
  return {
    ...original,
    useShoppingList: () => ({
      data: null,
      isFetching: false,
      isSuccess: true,
      isPending: false,
      isError: false,
    }),
    useShoppingSafetyGate: () => ({
      blocked: false,
      error: false,
      message: null,
      safetyFingerprint: null,
      currentLabelWarnings: [],
    }),
    useCreateShoppingList: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useReconcileShoppingList: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useResumeShoppingCommand: () => undefined,
  };
});

const MENU_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "31000000-0000-4000-8000-000000000001";

const validRevalidation: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
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
  } = {},
) {
  if (options.revalidate !== undefined) {
    revalidateMenuMock.mockImplementation(options.revalidate);
  }
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
    ],
    { initialEntries: [`/history/${MENU_ID}`] },
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
    channelHandlers.members?.();
    return;
  }
  if (signal === "realtime-member-allergy") {
    channelHandlers.allergies?.();
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
  channelHandlers.members = null;
  channelHandlers.allergies = null;
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
});

afterEach(() => {
  cleanup();
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
    // P4#3: /history/:menuId の買い物・冷蔵庫は enabled でも no-op だった。結果画面と同等に配線する。
    const user = userEvent.setup();
    renderHistoryDetail({
      revalidation: { phase: "checked", result: validRevalidation },
    });

    const shopping = await screen.findByRole("button", { name: "買い物リストを作る" });
    expect(shopping).toBeEnabled();
    await user.click(shopping);
    // CreateListSheet（section + 見出し）が開く
    expect(await screen.findByRole("heading", { name: /買い物リスト/i })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "冷蔵庫へ反映" }));
    expect(
      screen.getByText("調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。"),
    ).toBeVisible();
  });
});

describe("HistoryDetailPage idea permitted actions boundary", () => {
  it("renders a permanent notice and permitted actions without mounting revalidation or shopping", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "idea" }));

    renderHistoryDetail();

    expect(await screen.findByText("家族条件を使用していません")).toBeVisible();
    expect(screen.getByText("年齢・アレルギーへの適合は確認されていません")).toBeVisible();
    // idea では家族 revalidation と買い物を mount しない
    expect(revalidateMenuMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "買い物リストを作る" })).toBeNull();
    // 許可操作: 採用・お気に入り・冷蔵庫・whole/dish 再生成
    expect(screen.getByRole("button", { name: "これに決めた" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "この一品だけ別案にする" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "冷蔵庫へ反映" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "お気に入りに追加" })).toBeEnabled();
    expect(acceptMenuVersionMock).not.toHaveBeenCalled();
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
        .some((node) => (node.textContent ?? "").includes("現在の家族設定で確認しています")),
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
        .some((node) => (node.textContent ?? "").includes("現在の家族設定で確認しています")),
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
