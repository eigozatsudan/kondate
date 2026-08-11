import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { PlannerHome } from "./planner-home";

function renderWithRouter(ui: ReactElement) {
  const router = createMemoryRouter([{ path: "*", element: ui }]);
  return render(<RouterProvider router={router} />);
}

describe("PlannerHome", () => {
  it("assembles generate card, recent menus, and page header", () => {
    renderWithRouter(
      <PlannerHome
        remainingToday={3}
        onStartWizard={vi.fn()}
        recentMenus={[{ id: "11111111-1111-4111-8111-111111111111", title: "味噌汁定食" }]}
        expiringItems={[]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "今日の献立" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "味噌汁定食" })).toBeInTheDocument();
  });

  it("forwards start to the route owner", async () => {
    const user = userEvent.setup();
    const onStartWizard = vi.fn();
    renderWithRouter(
      <PlannerHome
        remainingToday={null}
        onStartWizard={onStartWizard}
        recentMenus={[]}
        expiringItems={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "今日の献立をつくる" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });

  it("P1: route の hard error を role=alert で表示する", () => {
    renderWithRouter(
      <PlannerHome
        remainingToday={null}
        onStartWizard={vi.fn()}
        recentMenus={[]}
        expiringItems={[]}
        error="条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "条件を保存できなかったため、移動できませんでした。通信を確認して再度お試しください。",
    );
  });
});
