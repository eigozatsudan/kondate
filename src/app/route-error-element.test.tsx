import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
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
});
