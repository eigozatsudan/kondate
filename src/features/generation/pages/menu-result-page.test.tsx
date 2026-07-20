import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuResultPage } from "./menu-result-page";

const getMenuResultMock = vi.hoisted(() => vi.fn());
const clearPendingGenerationMock = vi.hoisted(() => vi.fn());

vi.mock("../api/menu-result-api", () => ({ getMenuResult: getMenuResultMock }));
vi.mock("../model/pending-generation", () => ({
  clearPendingGeneration: clearPendingGenerationMock,
}));

const VALID_MENU_ID = "30000000-0000-4000-8000-000000000001";

function renderPage(
  path: string,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const router = createMemoryRouter(
    [
      { path: "/menus/:menuId", element: <MenuResultPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("読み込みに失敗したら履歴への導線を表示し、保存内容は後始末しない", async () => {
    getMenuResultMock.mockRejectedValue(new Error("menu_not_found"));

    renderPage(`/menus/${VALID_MENU_ID}`);

    expect(await screen.findByRole("heading", { name: "献立を表示できません" })).toBeVisible();
    expect(screen.getByRole("link", { name: "履歴を見る" })).toHaveAttribute("href", "/history");
    expect(clearPendingGenerationMock).not.toHaveBeenCalled();
  });
});
