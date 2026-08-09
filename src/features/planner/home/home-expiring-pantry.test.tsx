import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import { HomeExpiringPantry } from "./home-expiring-pantry";

function renderWithRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }]);
  return render(<RouterProvider router={router} />);
}

describe("HomeExpiringPantry", () => {
  it("renders expiring items with badge tone labels", () => {
    renderWithRouter(
      <HomeExpiringPantry
        items={[
          {
            id: "a",
            name: "キャベツ",
            expiresOn: "2026-08-10",
            tone: "warning",
            suffix: "（まもなく）",
          },
          {
            id: "b",
            name: "牛乳",
            expiresOn: "2026-08-01",
            tone: "danger",
            suffix: "（期限切れ）",
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "期限が近い食材" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "期限が近い食材一覧" })).toBeInTheDocument();
    expect(screen.getByText("キャベツ")).toBeInTheDocument();
    expect(screen.getByText("（まもなく）")).toBeInTheDocument();
    expect(screen.getByText("牛乳")).toBeInTheDocument();
    expect(screen.getByText("（期限切れ）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "冷蔵庫を見る" })).toHaveAttribute("href", "/pantry");
  });

  it("renders nothing when there are no expiring items", () => {
    const { container } = renderWithRouter(<HomeExpiringPantry items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
