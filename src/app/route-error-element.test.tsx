import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { RouteErrorElement } from "./route-error-element";

function Thrower(): null {
  throw new Error("render boom");
}

describe("RouteErrorElement", () => {
  it("shows Japanese recovery copy with home and login links when a child route throws", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          errorElement: <RouteErrorElement />,
          children: [
            {
              path: "boom",
              element: <Thrower />,
            },
          ],
        },
        { path: "/login", element: <h1>ログイン</h1> },
      ],
      { initialEntries: ["/boom"] },
    );
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: "画面を表示できませんでした" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "ホームへ戻る" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "ログイン画面へ" })).toHaveAttribute("href", "/login");
  });

  it("L1: reload button calls location.reload while home and login links remain", async () => {
    // 同一 specifier の失敗 Promise はフルリロード以外では再利用されるため、
    // ホーム／ログイン Link だけでは /welcome 死回路を抜けられない
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          errorElement: <RouteErrorElement />,
          children: [
            {
              path: "boom",
              element: <Thrower />,
            },
          ],
        },
        { path: "/login", element: <h1>ログイン</h1> },
      ],
      { initialEntries: ["/boom"] },
    );
    render(<RouterProvider router={router} />);

    const reloadButton = await screen.findByRole("button", { name: "再読み込み" });
    expect(reloadButton).toBeVisible();
    expect(screen.getByRole("link", { name: "ホームへ戻る" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "ログイン画面へ" })).toHaveAttribute("href", "/login");

    await user.click(reloadButton);
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
