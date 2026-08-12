import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "./auth-provider";
import { useAuth } from "./use-auth";
import { RequireSession } from "./protected-routes";

vi.mock("./use-auth", () => ({
  useAuth: vi.fn(() => ({
    status: "unauthenticated",
    session: null,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  })),
}));

it("no longer exports RequireCompletedOnboarding (guard removed, onboarding is optional)", async () => {
  const moduleExports: Record<string, unknown> = await import("./protected-routes");
  expect(moduleExports.RequireCompletedOnboarding).toBeUndefined();
});

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

it("L1: after C5 deadline while still loading, fail-closed to login", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(useAuth).mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    const router = createMemoryRouter(
      [
        {
          element: <RequireSession />,
          children: [{ path: "/pantry", element: <h1>冷蔵庫</h1> }],
        },
        {
          path: "/login",
          element: <h1>ログイン</h1>,
        },
      ],
      { initialEntries: ["/pantry"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("ログイン状態を確認しています…")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
    });
    expect(screen.getByRole("heading", { name: "ログイン" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  } finally {
    vi.useRealTimers();
  }
});

it("L6: loading main exposes aria-busy and aria-live", () => {
  vi.mocked(useAuth).mockReturnValue({
    status: "loading",
    session: null,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  const router = createMemoryRouter(
    [
      {
        element: <RequireSession />,
        children: [{ path: "/pantry", element: <h1>冷蔵庫</h1> }],
      },
    ],
    { initialEntries: ["/pantry"] },
  );
  render(<RouterProvider router={router} />);
  const pending = screen.getByText("ログイン状態を確認しています…");
  expect(pending.closest("main")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
});

it("C12: degraded session shows re-auth recovery action when recoverDegradedSession is provided", () => {
  const recoverDegradedSession = vi.fn();
  vi.mocked(useAuth).mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-1" } } as NonNullable<ReturnType<typeof useAuth>["session"]>,
    refreshSession: vi.fn(),
    sessionProbeDegraded: true,
    recoverDegradedSession,
  });
  const router = createMemoryRouter(
    [
      {
        element: <RequireSession />,
        children: [{ path: "/pantry", element: <h1>冷蔵庫</h1> }],
      },
    ],
    { initialEntries: ["/pantry"] },
  );
  render(<RouterProvider router={router} />);
  expect(
    screen.getByText(/安全のため一部の操作を止めています|接続の確認に時間がかかっています/),
  ).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "ログインし直す" });
  act(() => {
    button.click();
  });
  expect(recoverDegradedSession).toHaveBeenCalledOnce();
});
