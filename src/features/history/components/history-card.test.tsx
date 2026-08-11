import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import type { HistoryGroup } from "../model/group-history";
import { menusPathForShopping } from "@/features/shopping/shopping-intent";
import { HistoryCard } from "./history-card";

const api = vi.hoisted(() => ({
  setMenuFavorite: vi.fn(),
  deleteMenuGroup: vi.fn(),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return {
    ...original,
    setMenuFavorite: api.setMenuFavorite,
    deleteMenuGroup: api.deleteMenuGroup,
  };
});

function householdGroup(): HistoryGroup {
  return {
    derivationGroupId: "group-household",
    versionCount: 1,
    representative: {
      id: "menu-household",
      title: "家族の献立",
      createdAt: "2026-07-11T10:00:00Z",
      selectedAt: null,
      isFavorite: false,
      targetMode: "household",
    },
  };
}

function ideaGroup(): HistoryGroup {
  return {
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
}

const USER_ID = "60000000-0000-4000-8000-000000000001";

function authValue(): AuthContextValue {
  return {
    status: "authenticated",
    session: { user: { id: USER_ID } } as AuthContextValue["session"],
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  };
}

function renderCard(group: HistoryGroup, shoppingIntent = false) {
  const router = createMemoryRouter(
    [
      {
        path: "/history",
        element: <HistoryCard group={group} shoppingIntent={shoppingIntent} />,
      },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
    ],
    { initialEntries: ["/history"] },
  );
  render(
    <AuthContext.Provider value={authValue()}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

describe("HistoryCard mode badge", () => {
  it("shows a household badge for household-mode representative menus", () => {
    renderCard(householdGroup());
    expect(screen.getByText("家族に合わせた献立")).toBeVisible();
    expect(screen.queryByText("アイデア")).toBeNull();
  });

  it("shows an idea badge for idea-mode representative menus", () => {
    renderCard(ideaGroup());
    expect(screen.getByText("アイデア")).toBeVisible();
    expect(screen.queryByText("家族に合わせた献立")).toBeNull();
  });

  it("never implies family safety confirmation on an idea card", () => {
    renderCard(ideaGroup());
    const card = screen.getByRole("article");
    // 「確認済み」「安全」等、家族安全確認済みと誤解させる語をidea cardへ出さない
    expect(card.textContent).not.toMatch(/確認済み|安全に配慮|アレルギー対応済み/u);
  });
});

describe("HistoryCard shopping CTA", () => {
  it("shows shopping CTA for household only", () => {
    renderCard(householdGroup());
    const cta = screen.getByRole("link", { name: "買い物リストを作る" });
    expect(cta).toHaveAttribute("href", menusPathForShopping("menu-household"));
    expect(cta).toHaveClass("min-h-11");
  });

  it("hides shopping CTA for idea menus", () => {
    renderCard(ideaGroup());
    expect(screen.queryByRole("link", { name: "買い物リストを作る" })).toBeNull();
  });

  it("keeps plain title path without shopping intent", () => {
    renderCard(householdGroup(), false);
    expect(screen.getByRole("link", { name: "家族の献立" })).toHaveAttribute(
      "href",
      "/menus/menu-household",
    );
  });

  it("uses shopping path on title when shoppingIntent", () => {
    renderCard(householdGroup(), true);
    expect(screen.getByRole("link", { name: "家族の献立" })).toHaveAttribute(
      "href",
      menusPathForShopping("menu-household"),
    );
  });
});

describe("HistoryCard detail CTA", () => {
  it("shows detail link next to favorite and delete for idea cards", () => {
    renderCard(ideaGroup());
    const detail = screen.getByRole("link", { name: "詳細を見る" });
    expect(detail).toHaveAttribute("href", "/menus/menu-idea");
    // secondary-button → button-link（Link は Button 化しない契約）。44px は min-h-11
    expect(detail).toHaveClass("min-h-11", "button-link");
    expect(screen.getByRole("button", { name: "お気に入りに追加" })).toBeVisible();
    expect(screen.getByRole("button", { name: "この履歴を削除" })).toBeVisible();
  });

  it("uses the same path as the title for household cards", () => {
    renderCard(householdGroup());
    expect(screen.getByRole("link", { name: "詳細を見る" })).toHaveAttribute(
      "href",
      "/menus/menu-household",
    );
  });

  it("uses shopping path on detail when shoppingIntent", () => {
    renderCard(householdGroup(), true);
    expect(screen.getByRole("link", { name: "詳細を見る" })).toHaveAttribute(
      "href",
      menusPathForShopping("menu-household"),
    );
  });
});

describe("HistoryCard delete dialog", () => {
  it("blocks Escape close while delete is pending", async () => {
    let resolveDelete: (() => void) | undefined;
    api.deleteMenuGroup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const user = userEvent.setup();
    renderCard(householdGroup());
    await user.click(screen.getByRole("button", { name: "この履歴を削除" }));
    const dialog = screen.getByRole("dialog", { name: "この履歴を削除しますか？" });
    expect(dialog).toBeVisible();
    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(screen.getByRole("button", { name: "削除しています" })).toBeDisabled();
    // Escape 相当の cancel。pending 中は閉じない
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog", { name: "この履歴を削除しますか？" })).toBeVisible();
    resolveDelete?.();
    await screen.findByRole("heading", { name: "家族の献立" });
  });
});
