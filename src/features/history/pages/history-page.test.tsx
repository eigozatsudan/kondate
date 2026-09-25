import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import type { WeeklyPlanHistoryRow } from "@/features/weekly-plan/components/weekly-plan-history-card";
import type { HistoryGroup } from "../model/group-history";
import { HistoryPage, HistoryPageContent } from "./history-page";

const api = vi.hoisted(() => ({
  listHistoryGroups: vi.fn(),
  setMenuFavorite: vi.fn(),
  deleteMenuGroup: vi.fn(),
  acceptMenuVersion: vi.fn(),
  loadCurrentCompleteMemberIds: vi.fn(),
}));

// 週献立履歴の useQuery 結果を直接制御する（isPending/isError/refetch の分岐を検証するため）
const weeklyPlanHistoryQuery = vi.hoisted(() => ({
  useWeeklyPlanHistory: vi.fn(),
}));

vi.mock("@/features/weekly-plan/weekly-plan-history.js", () => ({
  useWeeklyPlanHistory: weeklyPlanHistoryQuery.useWeeklyPlanHistory,
}));

vi.mock("@/features/weekly-plan/weekly-plan-eligibility.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/weekly-plan/weekly-plan-eligibility.js")>();
  return {
    ...original,
    loadCurrentCompleteMemberIds: api.loadCurrentCompleteMemberIds,
  };
});

// household-api.ts の listHouseholdMembers は
// .from(table).select("*").eq(...).order(...).order(...) と PostgREST builder を
// メソッドチェーンした上で await する。チェーンの各メソッドが自分自身を返し、
// 最終的に thenable（then を持つ）になるビルダーをモックする。
function emptyQueryBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
      resolve({ data: [], error: null });
    },
  };
  return builder;
}

vi.mock("@/shared/lib/supabase", () => ({
  // このモックはどのテーブルでも空配列を返す（テーブル名では分岐しない）。
  getBrowserSupabaseClient: () => ({ from: () => emptyQueryBuilder() }),
}));

vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return {
    ...original,
    listHistoryGroups: api.listHistoryGroups,
    setMenuFavorite: api.setMenuFavorite,
    deleteMenuGroup: api.deleteMenuGroup,
    acceptMenuVersion: api.acceptMenuVersion,
  };
});

const USER_ID = "51000000-0000-4000-8000-000000000001";

const sampleGroup: HistoryGroup = {
  derivationGroupId: "group-1",
  versionCount: 3,
  representative: {
    id: "menu-2",
    title: "採用した献立",
    createdAt: "2026-07-11T10:00:00Z",
    selectedAt: "2026-07-11T10:00:00Z",
    isFavorite: true,
    targetMode: "household",
  },
};

function authValue(userId: string | null): AuthContextValue {
  return {
    status: userId === null ? "unauthenticated" : "authenticated",
    session: userId === null ? null : ({ user: { id: userId } } as AuthContextValue["session"]),
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  };
}

function renderHistoryPage(props: {
  groups: readonly HistoryGroup[];
  shoppingIntent?: boolean;
  initialPath?: string;
  weeklyPlans?: readonly WeeklyPlanHistoryRow[];
  currentCompleteMemberIds?: readonly string[] | null;
}) {
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: (
          <HistoryPageContent
            groups={props.groups}
            shoppingIntent={props.shoppingIntent ?? false}
            weeklyPlans={props.weeklyPlans ?? []}
            currentCompleteMemberIds={props.currentCompleteMemberIds ?? null}
          />
        ),
      },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
      { path: "/history/:menuId", element: <h1>献立の詳細</h1> },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/shopping", element: <h1>買い物</h1> },
      { path: "/weekly/:weeklyPlanId", element: <h1>今週の献立</h1> },
    ],
    { initialEntries: [props.initialPath ?? "/history"] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={authValue(USER_ID)}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

const ideaOnlyGroup: HistoryGroup = {
  derivationGroupId: "group-idea",
  versionCount: 1,
  representative: {
    id: "menu-idea",
    title: "アイデア献立",
    createdAt: "2026-07-11T10:00:00Z",
    selectedAt: null,
    isFavorite: false,
    targetMode: "idea",
  },
};

function renderConnectedHistoryPage(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const router = createMemoryRouter(
    [
      { path: "/history", element: <HistoryPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
    ],
    { initialEntries: ["/history"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(USER_ID)}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 週献立系クエリの既定は「空で成功」。各テストで必要な分だけ上書きする。
  api.loadCurrentCompleteMemberIds.mockResolvedValue([]);
  weeklyPlanHistoryQuery.useWeeklyPlanHistory.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  // jsdom 向け native dialog ポリフィル
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  cleanup();
});

describe("HistoryPage", () => {
  it("renders one card per derivation group and prefers the selected version", async () => {
    renderHistoryPage({
      groups: [sampleGroup],
    });
    expect(await screen.findByText("採用した献立")).toBeVisible();
    expect(screen.getByRole("heading", { name: "作った献立" })).toBeVisible();
    expect(screen.getByText("全3案")).toBeVisible();
    expect(screen.getByText("開くとこの献立の対象家族の設定で再確認します")).toBeVisible();
    expect(screen.queryByText("menu-1")).not.toBeInTheDocument();
  });

  it("shows loading and empty states", async () => {
    api.listHistoryGroups.mockReturnValue(new Promise(() => undefined));
    renderConnectedHistoryPage();
    expect(screen.getByRole("status")).toHaveTextContent("履歴を読み込んでいます");

    cleanup();
    api.listHistoryGroups.mockResolvedValue([]);
    renderConnectedHistoryPage();
    expect(await screen.findByText("まだ献立がありません")).toBeVisible();
    expect(screen.getByRole("heading", { name: "作った献立" })).toBeVisible();
    const cta = screen.getByRole("link", { name: "献立を作る" });
    expect(cta).toHaveAttribute("href", "/planner");
    // primary-button → button-link--primary（Link は Button 化しない契約）
    expect(cta.className).toMatch(/button-link--primary/);
  });

  it("shows a heading and a retry control when loading fails", async () => {
    api.listHistoryGroups.mockRejectedValue(new Error("boom"));
    renderConnectedHistoryPage();
    expect(await screen.findByRole("heading", { name: "作った献立" })).toBeVisible();
    expect(screen.getByText("履歴を読み込めませんでした")).toBeVisible();
  });

  it("toggles favorite with a 44px control", async () => {
    const user = userEvent.setup();
    api.setMenuFavorite.mockResolvedValue(undefined);
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    renderConnectedHistoryPage();

    const favorite = await screen.findByRole("button", { name: "お気に入りを外す" });
    // 44px は min-h-11 ではなく共有 Button（.ui-btn min-height: 44px）が保証する
    expect(favorite).toHaveClass("ui-btn");
    await user.click(favorite);
    await waitFor(() => {
      expect(api.setMenuFavorite).toHaveBeenCalledWith("menu-2", false);
    });
  });

  it("filters to favorites only with a session switch", async () => {
    const user = userEvent.setup();
    const nonFavorite: HistoryGroup = {
      derivationGroupId: "group-2",
      versionCount: 1,
      representative: {
        id: "menu-3",
        title: "通常の献立",
        createdAt: "2026-07-10T10:00:00Z",
        selectedAt: null,
        isFavorite: false,
        targetMode: "idea",
      },
    };
    renderHistoryPage({ groups: [sampleGroup, nonFavorite] });

    expect(screen.getByText("採用した献立")).toBeVisible();
    expect(screen.getByText("通常の献立")).toBeVisible();

    const filter = screen.getByRole("switch", { name: "お気に入りだけを表示" });
    // 44px のタップ領域は label 側で持ち、スイッチ本体は見た目の大きさに留める
    expect(filter.className).not.toMatch(/min-[hw]-11/u);
    expect(filter.closest("label")).toHaveClass("min-h-11");
    expect(filter).toHaveAttribute("aria-checked", "false");
    // C M-4(b): 横の状態の文字は見た目の補助。switch の状態と一緒に変わり、読み上げには入れない
    const filterLabel = filter.closest("label");
    expect(filterLabel).not.toBeNull();
    const stateText = () =>
      filterLabel === null ? null : within(filterLabel).getByText(/^オ[ンフ]$/u);
    expect(stateText()).toHaveTextContent("オフ");
    expect(stateText()).toHaveAttribute("aria-hidden", "true");
    await user.click(filter);

    expect(filter).toHaveAttribute("aria-checked", "true");
    expect(stateText()).toHaveTextContent("オン");
    expect(screen.getByText("採用した献立")).toBeVisible();
    expect(screen.queryByText("通常の献立")).not.toBeInTheDocument();
  });

  it("shows favorites-empty and restores all when toggled off", async () => {
    const user = userEvent.setup();
    const nonFavorite: HistoryGroup = {
      derivationGroupId: "group-2",
      versionCount: 1,
      representative: {
        id: "menu-3",
        title: "通常の献立",
        createdAt: "2026-07-10T10:00:00Z",
        selectedAt: null,
        isFavorite: false,
        targetMode: "idea",
      },
    };
    renderHistoryPage({ groups: [nonFavorite] });

    await user.click(screen.getByRole("switch", { name: "お気に入りだけを表示" }));
    expect(screen.getByText("お気に入りがありません")).toBeVisible();
    expect(screen.queryByText("通常の献立")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "すべての献立を表示" }));
    expect(screen.getByText("通常の献立")).toBeVisible();
    expect(screen.getByRole("switch", { name: "お気に入りだけを表示" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows the weekly plan card in the empty-history state", () => {
    const memberId = "51000000-0000-4000-8000-0000000000a1";
    renderHistoryPage({
      groups: [],
      weeklyPlans: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          week_start: "2026-09-07",
          created_at: "2026-09-01T00:00:00Z",
          preference_snapshot: { targetMemberIds: [memberId] },
        },
      ],
      currentCompleteMemberIds: [memberId],
    });
    expect(screen.getByText("まだ献立がありません")).toBeVisible();
    expect(screen.getByText("今週の献立")).toBeVisible();
    expect(screen.getByText("2026-09-07")).toBeVisible();
  });

  it("shows the weekly plan card alongside the daily history list", () => {
    const memberId = "51000000-0000-4000-8000-0000000000a1";
    renderHistoryPage({
      groups: [sampleGroup],
      weeklyPlans: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          week_start: "2026-09-07",
          created_at: "2026-09-01T00:00:00Z",
          preference_snapshot: { targetMemberIds: [memberId] },
        },
      ],
      currentCompleteMemberIds: [memberId],
    });
    expect(screen.getByText("採用した献立")).toBeVisible();
    expect(screen.getByText("今週の献立")).toBeVisible();
    expect(screen.getByText("2026-09-07")).toBeVisible();
  });

  it("hides the favorites switch when there are no groups", () => {
    renderHistoryPage({ groups: [] });
    expect(screen.queryByRole("switch", { name: "お気に入りだけを表示" })).not.toBeInTheDocument();
  });

  it("does not flash the partial warning while complete member ids are still loading", async () => {
    const memberId = "51000000-0000-4000-8000-0000000000a1";
    api.listHistoryGroups.mockResolvedValue([]);
    // 現行メンバー集合が未確定の間は「外した家族の条件は見ていません」を出さない
    api.loadCurrentCompleteMemberIds.mockReturnValue(new Promise(() => undefined));
    weeklyPlanHistoryQuery.useWeeklyPlanHistory.mockReturnValue({
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          week_start: "2026-09-07",
          created_at: "2026-09-01T00:00:00Z",
          preference_snapshot: { targetMemberIds: [memberId] },
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderConnectedHistoryPage();

    expect(await screen.findByText("今週の献立")).toBeVisible();
    expect(screen.getByText("2026-09-07")).toBeVisible();
    expect(screen.queryByText("外した家族の条件は見ていません")).not.toBeInTheDocument();
    expect(screen.queryByText(/人分/u)).not.toBeInTheDocument();
  });

  it("lists weekly plans without the warning when complete member ids fail to load", async () => {
    const memberId = "51000000-0000-4000-8000-0000000000a1";
    api.listHistoryGroups.mockResolvedValue([]);
    api.loadCurrentCompleteMemberIds.mockRejectedValue(new Error("boom"));
    weeklyPlanHistoryQuery.useWeeklyPlanHistory.mockReturnValue({
      data: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          week_start: "2026-09-07",
          created_at: "2026-09-01T00:00:00Z",
          preference_snapshot: { targetMemberIds: [memberId] },
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderConnectedHistoryPage();

    expect(await screen.findByText("今週の献立")).toBeVisible();
    // 取得失敗は 0 人確定と区別し、partial 警告を出さない
    expect(screen.queryByText("外した家族の条件は見ていません")).not.toBeInTheDocument();
  });

  it("omits the weekly plan section while the weekly plan history is loading", async () => {
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    weeklyPlanHistoryQuery.useWeeklyPlanHistory.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    renderConnectedHistoryPage();

    expect(await screen.findByText("採用した献立")).toBeVisible();
    // 読込中は補助セクション自体を出さない（履歴本体は通常どおり表示する）
    expect(screen.queryByText("今週の献立")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an inline notice and retries when the weekly plan history fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    weeklyPlanHistoryQuery.useWeeklyPlanHistory.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    renderConnectedHistoryPage();

    // 週献立の失敗で履歴一覧を落とさない
    expect(await screen.findByText("採用した献立")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("今週の献立を読み込めませんでした");

    await user.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the delete confirmation closed on initial render", async () => {
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    renderConnectedHistoryPage();

    await screen.findByText("採用した献立");
    // 閉じた dialog は a11y ツリーに出ない（.stack の display 上書き回帰を防ぐ）
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dialogEl = document.querySelector("dialog");
    expect(dialogEl).not.toBeNull();
    expect(dialogEl?.hasAttribute("open")).toBe(false);
    // display を変えるユーティリティを dialog 本体に載せない
    expect(dialogEl?.className.split(/\s+/u)).not.toContain("stack");
  });

  it("confirms delete in a native dialog and retries after failure", async () => {
    const user = userEvent.setup();
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    api.deleteMenuGroup.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    renderConnectedHistoryPage();

    await screen.findByText("採用した献立");
    await user.click(screen.getByRole("button", { name: "この履歴を削除" }));

    const dialog = screen.getByRole("dialog", { name: "この履歴を削除しますか？" });
    expect(dialog).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("削除できませんでした。もう一度試してください")).toBeVisible();
    // 失敗してもカードは残る
    expect(screen.getByText("採用した献立")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "もう一度削除する" }));
    await waitFor(() => {
      expect(api.deleteMenuGroup).toHaveBeenCalledTimes(2);
      expect(api.deleteMenuGroup).toHaveBeenLastCalledWith("group-1");
    });
  });

  it("links the representative title to the history detail route", async () => {
    renderHistoryPage({ groups: [sampleGroup] });
    const link = await screen.findByRole("link", { name: "採用した献立" });
    expect(link).toHaveAttribute("href", "/history/menu-2");
  });

  it("shows shopping banner when shoppingIntent", () => {
    renderHistoryPage({ groups: [sampleGroup], shoppingIntent: true });
    expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "買い物に戻る" })).toHaveAttribute("href", "/shopping");
    expect(screen.getByRole("link", { name: "買い物リストを作る" })).toBeInTheDocument();
  });

  it("shows dead-end when shoppingIntent and no household cards", () => {
    renderHistoryPage({ groups: [ideaOnlyGroup], shoppingIntent: true });
    expect(
      screen.getByText(
        "いま選べる家族向けの献立がありません。買い物リストに使えるのは家族に合わせた献立だけです",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家族向けの献立を作る" })).toHaveAttribute(
      "href",
      "/planner",
    );
    expect(screen.queryByRole("link", { name: "買い物リストを作る" })).toBeNull();
  });

  it("shows banner on empty list with shoppingIntent", () => {
    renderHistoryPage({ groups: [], shoppingIntent: true });
    expect(screen.getByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "買い物に戻る" })).toBeInTheDocument();
  });

  it("passes for=shopping from URL into HistoryPage", async () => {
    api.listHistoryGroups.mockResolvedValue([sampleGroup]);
    const router = createMemoryRouter(
      [
        { path: "/history", element: <HistoryPage /> },
        { path: "/shopping", element: <h1>買い物</h1> },
        { path: "/planner", element: <h1>プランナー</h1> },
      ],
      { initialEntries: ["/history?for=shopping"] },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthContext.Provider value={authValue(USER_ID)}>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("買い物リスト用に献立を選んでください")).toBeInTheDocument();
  });
});
