import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("@/features/auth/root-entry-page", () => ({
  RootEntryPage: () => <h1>RootEntry stub</h1>,
}));
vi.mock("./free-landing-page", async () => {
  const actual = await vi.importActual<typeof import("./free-landing-page")>("./free-landing-page");
  return {
    ...actual,
    FreeLandingPage: () => <h1>{actual.FREE_LP_H1}</h1>,
  };
});

import { FREE_LP_H1 } from "./free-landing-page";
import { RootGatePage } from "./root-gate-page";

function renderGate() {
  const router = createMemoryRouter([{ path: "/", element: <RootGatePage /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
}

describe("RootGatePage", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it("shows session check copy while loading and neither landing nor entry", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByText("ログイン状態を確認しています…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when unauthenticated", () => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when session is null even if status is not unauthenticated", () => {
    // fail-closed: session null → LP（設計 L14）
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows RootEntry when authenticated with session", () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: "72000000-0000-4000-8000-000000000001" } },
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "RootEntry stub" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
  });
});
