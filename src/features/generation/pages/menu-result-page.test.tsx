import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import type { RevalidationResult } from "@/features/history/api/revalidation-api";
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
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
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
});

function deferredPromiseForTest<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
