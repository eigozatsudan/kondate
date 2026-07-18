import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { RequireSession } from "./protected-routes";

vi.mock("./use-auth", () => ({
  useAuth: vi.fn(() => ({
    status: "unauthenticated",
    session: null,
    refreshSession: vi.fn(),
  })),
}));

it("returns an unauthenticated visitor to login with a safe return path", async () => {
  const router = createMemoryRouter(
    [
      {
        element: <RequireSession />,
        children: [{ path: "/pantry", element: <h1>冷蔵庫</h1> }],
      },
      {
        path: "/login",
        element: (
          <>
            <h1>ログイン</h1>
            <Outlet />
          </>
        ),
      },
    ],
    { initialEntries: ["/pantry?from=test"] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  expect(router.state.location.search).toBe("?returnTo=%2Fpantry%3Ffrom%3Dtest");
});
