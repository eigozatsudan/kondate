import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import { NotFoundPage } from "./not-found-page";

describe("NotFoundPage", () => {
  it("L5: shows Japanese 404 copy with home link", async () => {
    const router = createMemoryRouter(
      [
        { path: "*", element: <NotFoundPage /> },
        { path: "/", element: <h1>ホーム</h1> },
      ],
      { initialEntries: ["/this-path-does-not-exist"] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    expect(screen.getByRole("link", { name: "ホームへ戻る" })).toHaveAttribute("href", "/");
  });
});
