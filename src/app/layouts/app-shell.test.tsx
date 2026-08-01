import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
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

function renderAppShellAt(path: string, children?: { path: string; element: ReactNode }[]) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: children ?? [
          { path: "/planner", element: <h1>献立</h1> },
          { path: "/pantry", element: <h1>冷蔵庫</h1> },
          { path: "/menus/:menuId", element: <h1>献立結果</h1> },
          { path: "/history", element: <h1>履歴</h1> },
          { path: "/shopping", element: <h1>買い物</h1> },
          { path: "/settings", element: <h1>設定</h1> },
          { path: "/plus", element: <h1>Plus LP</h1> },
          { path: "/emergency-menus", element: <h1>緊急献立</h1> },
          { path: "/unknown-section", element: <h1>その他</h1> },
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

  it("marks planner nav active on /menus/:id (D-I19)", () => {
    renderAppShellAt("/menus/abc");
    const planner = screen.getByRole("link", { name: /献立/u });
    expect(planner.className).toContain("nav-item-active");
  });

  it("maps emergency-menus to planner chrome (SHELL-M1 recovery path)", () => {
    renderAppShellAt("/emergency-menus");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "planner");
  });

  it("falls back to other for routes without a section", () => {
    renderAppShellAt("/unknown-section");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "other");
  });

  it("marks plus section on /plus (not settings)", () => {
    renderAppShellAt("/plus");
    expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "plus");
    // desktop-section-bar は aria-hidden だが DOM に "Plus" を持つ
    expect(document.querySelector(".desktop-section-bar")?.textContent).toBe("Plus");
  });
});

describe("AppShell route focus (L2)", () => {
  it("does not steal focus from an open dialog after pathname focus effect", async () => {
    function PageWithDialog() {
      const buttonRef = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        // ページ側が dialog 内へフォーカスした状態をシミュレート（rAF より前でも後でも可）
        buttonRef.current?.focus();
      }, []);
      return (
        <main className="page-frame">
          <h1>設定</h1>
          <div role="dialog" aria-modal="true" aria-label="確認">
            <button ref={buttonRef} type="button">
              ダイアログ内操作
            </button>
          </div>
        </main>
      );
    }

    renderAppShellAt("/settings", [{ path: "/settings", element: <PageWithDialog /> }]);
    const dialogButton = await screen.findByRole("button", { name: "ダイアログ内操作" });
    // shell の rAF focus が完了するまで2フレーム待ち、dialog 内フォーカスが維持されることを固定
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(dialogButton);
    });
    expect(screen.getByRole("heading", { name: "設定" })).not.toHaveFocus();
  });
});
