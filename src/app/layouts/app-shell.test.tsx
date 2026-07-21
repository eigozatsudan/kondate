import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { AppShell } from "./app-shell";

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

const unauthenticated: AuthContextValue = {
  status: "unauthenticated",
  session: null,
  refreshSession: vi.fn(),
};

function renderAppShellAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: "/planner", element: <h1>献立</h1> },
          { path: "/pantry", element: <h1>冷蔵庫</h1> },
          { path: "/menus/:menuId", element: <h1>献立結果</h1> },
          { path: "/history", element: <h1>履歴</h1> },
          { path: "/shopping", element: <h1>買い物</h1> },
          { path: "/settings", element: <h1>設定</h1> },
          { path: "/emergency-menus", element: <h1>緊急献立</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={unauthenticated}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("AppShell section tinting", () => {
  it("marks the pantry section on the pantry route", () => {
    renderAppShellAt("/pantry");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "pantry");
  });

  it("marks nested menu routes as the planner section", () => {
    renderAppShellAt("/menus/abc");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "planner");
  });

  it("falls back to other for routes without a section", () => {
    renderAppShellAt("/emergency-menus");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "other");
  });
});
