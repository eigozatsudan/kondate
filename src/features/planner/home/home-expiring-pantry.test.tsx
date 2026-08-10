import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPlannerLeaveFlush } from "../planner-leave-flush";
import { HomeExpiringPantry } from "./home-expiring-pantry";

afterEach(() => {
  registerPlannerLeaveFlush(null);
});

function renderWithRouter(ui: ReactElement, initialPath = "/planner") {
  const router = createMemoryRouter(
    [
      { path: "/planner", element: ui },
      { path: "/pantry", element: <h1>冷蔵庫</h1> },
    ],
    { initialEntries: [initialPath] },
  );
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

  it("P1: pantry link awaits leave-flush and stays when blocked", async () => {
    const user = userEvent.setup();
    const flush = vi.fn().mockResolvedValue("blocked" as const);
    registerPlannerLeaveFlush(flush);
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
        ]}
      />,
    );

    await user.click(screen.getByRole("link", { name: "冷蔵庫を見る" }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "冷蔵庫" })).toBeNull();
    expect(screen.getByRole("heading", { name: "期限が近い食材" })).toBeInTheDocument();
  });

  it("P1: pantry link navigates after leave-flush proceed", async () => {
    const user = userEvent.setup();
    registerPlannerLeaveFlush(() => Promise.resolve("proceed"));
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
        ]}
      />,
    );

    await user.click(screen.getByRole("link", { name: "冷蔵庫を見る" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "冷蔵庫" })).toBeInTheDocument();
    });
  });
});
