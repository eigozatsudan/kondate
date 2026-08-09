import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { HomeRecentMenus } from "./home-recent-menus";

function renderWithRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }]);
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
});
