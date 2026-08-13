import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPlannerLeaveFlush } from "../planner-leave-flush";
import { HomeRecentMenus } from "./home-recent-menus";

afterEach(() => {
  registerPlannerLeaveFlush(null);
});

function renderWithRouter(ui: ReactElement, initialPath = "/planner") {
  const router = createMemoryRouter(
    [
      { path: "/planner", element: ui },
      {
        path: "/menus/:menuId",
        element: <h1>献立詳細</h1>,
      },
    ],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}

describe("HomeRecentMenus", () => {
  it("renders recent menu links by accessible name", () => {
    renderWithRouter(
      <HomeRecentMenus
        menus={[
          { id: "11111111-1111-4111-8111-111111111111", title: "鶏肉のさっぱり煮" },
          { id: "22222222-2222-4222-8222-222222222222", title: "鮭のムニエル" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "直近の献立" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "直近の献立一覧" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "鶏肉のさっぱり煮" })).toHaveAttribute(
      "href",
      "/menus/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("link", { name: "鮭のムニエル" })).toBeInTheDocument();
  });

  it("shows empty copy when there are no menus", () => {
    renderWithRouter(<HomeRecentMenus menus={[]} />);
    expect(screen.getByText(/まだ献立がありません/u)).toBeInTheDocument();
  });

  it("exposes loading status", () => {
    renderWithRouter(<HomeRecentMenus menus={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent(/読み込んでいます/u);
  });

  it("exposes error alert and retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithRouter(<HomeRecentMenus menus={[]} error onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/読み込めませんでした/u);
    await user.click(screen.getByRole("button", { name: "もう一度読み込む" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("P1: menu link awaits leave-flush before navigating", async () => {
    const user = userEvent.setup();
    const flush = vi.fn().mockResolvedValue("proceed" as const);
    registerPlannerLeaveFlush(flush);
    renderWithRouter(
      <HomeRecentMenus
        menus={[{ id: "11111111-1111-4111-8111-111111111111", title: "鶏肉のさっぱり煮" }]}
      />,
    );

    await user.click(screen.getByRole("link", { name: "鶏肉のさっぱり煮" }));
    expect(flush).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立詳細" })).toBeInTheDocument();
    });
  });

  it("C5: disabled のときは leave-flush せず stay", async () => {
    const user = userEvent.setup();
    const flush = vi.fn().mockResolvedValue("proceed" as const);
    registerPlannerLeaveFlush(flush);
    renderWithRouter(
      <HomeRecentMenus
        menus={[{ id: "11111111-1111-4111-8111-111111111111", title: "鶏肉のさっぱり煮" }]}
        disabled
      />,
    );

    const link = screen.getByRole("link", { name: "鶏肉のさっぱり煮" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);
    expect(flush).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "献立詳細" })).toBeNull();
  });
});
