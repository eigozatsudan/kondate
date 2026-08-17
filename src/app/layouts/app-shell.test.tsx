import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { registerPlannerLeaveFlush } from "@/features/planner/planner-leave-flush";
import { PWA_INSTALL_TIP_DISMISSED_KEY } from "@/features/pwa/install-tip-storage";
import { AppShell } from "./app-shell";

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

beforeEach(() => {
  // 既定は案内カード非表示。既存 heading 契約を侵さない。
  window.localStorage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");
});

afterEach(() => {
  registerPlannerLeaveFlush(null);
  // 公開 LP の静的コピーと本番同様の #root をテスト間で残さない
  document.getElementById("kondate-public-lp")?.remove();
  document.getElementById("root")?.remove();
});

const unauthenticated: AuthContextValue = {
  status: "unauthenticated",
  session: null,
  refreshSession: vi.fn(),
  sessionProbeDegraded: false,
};

/** 本番 index.html と同様、シェルは #root に載せる。無いときは作る。 */
function ensureAppRoot(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing instanceof HTMLElement) {
    return existing;
  }
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

function renderAppShellAt(path: string, children?: { path: string; element: ReactNode }[]) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: children ?? [
          { path: "/planner", element: <h1>献立</h1> },
          { path: "/generation", element: <h1>生成中</h1> },
          { path: "/pantry", element: <h1>冷蔵庫</h1> },
          { path: "/menus/:menuId", element: <h1>献立結果</h1> },
          { path: "/history", element: <h1>履歴</h1> },
          { path: "/history/:menuId", element: <h1>履歴詳細</h1> },
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
  // 静的公開 LP は #root の外に残るため、RTL も本番と同じマウント先にする
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={unauthenticated}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </QueryClientProvider>,
    { container: ensureAppRoot() },
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

  it("L6: marks planner nav active on /emergency-menus", () => {
    renderAppShellAt("/emergency-menus");
    const planner = screen.getByRole("link", { name: /献立/u });
    expect(planner.className).toContain("nav-item-active");
  });

  it.each(["/generation", "/menus/abc", "/emergency-menus"] as const)(
    "L2: links aria-current=page with planner visual active on %s",
    (path) => {
      // 視覚 active と SR 現在地を一致させる（NavLink match だけでは付かない）
      renderAppShellAt(path);
      const planner = screen.getByRole("link", { name: /献立/u });
      expect(planner.className).toContain("nav-item-active");
      expect(planner).toHaveAttribute("aria-current", "page");
      // 他タブに誤 current が付かない
      expect(screen.getByRole("link", { name: /冷蔵庫/u })).not.toHaveAttribute("aria-current");
      expect(screen.getByRole("link", { name: /履歴/u })).not.toHaveAttribute("aria-current");
    },
  );

  it("L2: keeps aria-current=page on /planner exact", () => {
    renderAppShellAt("/planner");
    expect(screen.getByRole("link", { name: /献立/u })).toHaveAttribute("aria-current", "page");
  });

  it("L2: history child routes set aria-current on history tab", () => {
    renderAppShellAt("/history/m1");
    const history = screen.getByRole("link", { name: /履歴/u });
    expect(history.className).toContain("nav-item-active");
    expect(history).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /献立/u })).not.toHaveAttribute("aria-current");
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

  it("L1: focuses h1 that appears after pathname change (pending/lazy)", async () => {
    function DelayedHeading({ title }: { title: string }) {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const id = window.setTimeout(() => {
          setReady(true);
        }, 30);
        return () => {
          window.clearTimeout(id);
        };
      }, []);
      if (!ready) {
        return <main className="page-frame">読み込み中</main>;
      }
      return (
        <main className="page-frame">
          <h1>{title}</h1>
        </main>
      );
    }

    const user = userEvent.setup();
    renderAppShellAt("/planner", [
      {
        path: "/planner",
        element: (
          <main className="page-frame">
            <h1>献立</h1>
          </main>
        ),
      },
      { path: "/settings", element: <DelayedHeading title="設定" /> },
    ]);
    expect(screen.getByRole("heading", { name: "献立" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: /設定/u }));
    expect(screen.queryByRole("heading", { name: "設定" })).not.toBeInTheDocument();
    const settingsHeading = await screen.findByRole("heading", { name: "設定" });
    await waitFor(() => {
      expect(settingsHeading).toHaveFocus();
    });
  });

  it("does not focus the hidden static public LP h1 outside #root (ADV-I1)", async () => {
    // 本番は静的 LP が #root の外に残り、display:none でも document 順の main h1 に拾われる
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div id="kondate-public-lp" style="display:none"><main><h1>今日の献立、家族に合わせて。</h1></main></div>`,
    );

    renderAppShellAt("/planner", [
      {
        path: "/planner",
        element: (
          <main className="page-frame">
            <h1>献立</h1>
          </main>
        ),
      },
    ]);

    const plannerHeading = screen.getByRole("heading", { name: "献立" });
    // shell の rAF focus が完了するまで2フレーム待つ（dialog 契約と同じ）
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    });

    expect(document.activeElement).toBe(plannerHeading);
    const hiddenLpHeading = document.querySelector("#kondate-public-lp h1");
    if (!(hiddenLpHeading instanceof HTMLElement)) {
      throw new Error("expected #kondate-public-lp h1");
    }
    expect(hiddenLpHeading).not.toHaveAttribute("tabindex");
    expect(document.activeElement).not.toBe(hiddenLpHeading);
  });
});

describe("AppShell planner leave flush (P2)", () => {
  it("awaits leave flush and navigates only on proceed", async () => {
    const user = userEvent.setup();
    let resolveFlush: ((value: "proceed" | "blocked") => void) | undefined;
    const flush = vi.fn(
      () =>
        new Promise<"proceed" | "blocked">((resolve) => {
          resolveFlush = resolve;
        }),
    );
    registerPlannerLeaveFlush(flush);
    renderAppShellAt("/planner");

    await user.click(screen.getByRole("link", { name: /設定/u }));
    // flush 完了前は settings に遷移しない
    expect(screen.getByRole("heading", { name: "献立" })).toBeVisible();
    expect(flush).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFlush?.("proceed");
      // flush resolve → navigate microtasks を flush
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeVisible();
    });
  });

  it("L9: exposes polite status while leave-flush is pending", async () => {
    const user = userEvent.setup();
    let resolveFlush: ((value: "proceed" | "blocked") => void) | undefined;
    registerPlannerLeaveFlush(
      () =>
        new Promise<"proceed" | "blocked">((resolve) => {
          resolveFlush = resolve;
        }),
    );
    renderAppShellAt("/planner");

    const nav = screen.getByRole("navigation", { name: "メインメニュー" });
    expect(nav).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /設定/u }));
    // aria-busy と対の polite status 文言（何を待つかを伝える）
    expect(nav).toHaveAttribute("aria-busy", "true");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("保存しています…");

    await act(async () => {
      resolveFlush?.("proceed");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeVisible();
    });
    // 完了後は busy / status を外す
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).not.toHaveAttribute(
      "aria-busy",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays on planner when leave flush is blocked", async () => {
    const user = userEvent.setup();
    registerPlannerLeaveFlush(() => Promise.resolve("blocked"));
    renderAppShellAt("/planner");

    await user.click(screen.getByRole("link", { name: /冷蔵庫/u }));
    expect(screen.getByRole("heading", { name: "献立" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "冷蔵庫" })).not.toBeInTheDocument();
  });

  it("does not intercept leave when not on /planner", async () => {
    const user = userEvent.setup();
    const flush = vi.fn(() => Promise.resolve("blocked" as const));
    registerPlannerLeaveFlush(flush);
    renderAppShellAt("/pantry");

    await user.click(screen.getByRole("link", { name: /設定/u }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "設定" })).toBeVisible();
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("does not flush or preventDefault on modifier-click leave from /planner", () => {
    const flush = vi.fn(() => Promise.resolve("proceed" as const));
    registerPlannerLeaveFlush(flush);
    renderAppShellAt("/planner");

    const pantry = screen.getByRole("link", { name: /冷蔵庫/u });
    // MemoryRouter は新規タブを開かない。核は flush 非実行と preventDefault しないこと。
    let defaultPrevented = true;
    const onDocumentClick = (event: Event) => {
      defaultPrevented = event.defaultPrevented;
    };
    document.addEventListener("click", onDocumentClick);
    fireEvent.click(pantry, { ctrlKey: true, button: 0 });
    document.removeEventListener("click", onDocumentClick);

    expect(flush).not.toHaveBeenCalled();
    expect(defaultPrevented).toBe(false);
  });
});

describe("AppShell heading contract (I2)", () => {
  it("does not expose the install-card heading when the dismiss key is already 1", () => {
    // 受け入れ 9: heading.first() がカード h2「ホーム画面に置く」に侵食しないこと。
    // 資格が揃っていても dismiss 済みなら、document 順の先頭見出しはページ側のまま。
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: undefined,
    });
    const authenticated: AuthContextValue = {
      status: "authenticated",
      session: { user: { id: "user-1" } } as AuthContextValue["session"],
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    };
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [{ path: "/history/:menuId", element: <h1>履歴詳細</h1> }],
        },
      ],
      { initialEntries: ["/history/m1"] },
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthContext.Provider value={authenticated}>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(window.localStorage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY)).toBe("1");
    const firstHeading = screen.getAllByRole("heading")[0];
    expect(firstHeading).not.toHaveAccessibleName("ホーム画面に置く");
    expect(screen.queryByRole("heading", { name: "ホーム画面に置く" })).not.toBeInTheDocument();
    expect(firstHeading).toHaveAccessibleName("履歴詳細");
    vi.unstubAllGlobals();
  });
});
