import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import type { HistoryGroup } from "../model/group-history";
import { HistoryPage, HistoryPageContent } from "./history-page";

const api = vi.hoisted(() => ({
  listHistoryGroups: vi.fn(),
  setMenuFavorite: vi.fn(),
  deleteMenuGroup: vi.fn(),
  acceptMenuVersion: vi.fn(),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
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
  };
}

function renderHistoryPage(props: { groups: readonly HistoryGroup[] }) {
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: <HistoryPageContent groups={props.groups} />,
      },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
      { path: "/planner", element: <h1>プランナー</h1> },
    ],
    { initialEntries: ["/history"] },
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
    expect(screen.getByText("3案")).toBeVisible();
    expect(screen.getByText("開くと現在の家族設定で再確認します")).toBeVisible();
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
    expect(screen.getByRole("link", { name: "献立を作る" })).toHaveAttribute("href", "/planner");
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
    expect(favorite.className).toMatch(/min-h-11/);
    await user.click(favorite);
    await waitFor(() => {
      expect(api.setMenuFavorite).toHaveBeenCalledWith("menu-2", false);
    });
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

  it("links the representative title to the menu result route", async () => {
    renderHistoryPage({ groups: [sampleGroup] });
    const link = await screen.findByRole("link", { name: "採用した献立" });
    expect(link).toHaveAttribute("href", "/menus/menu-2");
  });
});
