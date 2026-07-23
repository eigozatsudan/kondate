import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());
const getProfileMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: useQueryMock };
});
vi.mock("@/features/auth/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("@/features/household/household-api", () => ({ getProfile: getProfileMock }));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

import { householdKeys } from "@/features/household/household-queries";
import { RootEntryPage } from "./root-entry-page";

const userId = "72000000-0000-4000-8000-000000000001";

function renderWithRouter(initialPath = "/") {
  const router = createMemoryRouter(
    [
      { path: "/", element: <RootEntryPage /> },
      { path: "/welcome", element: <h1>ウェルカム</h1> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  // vi.mock 済みの useAuth を毎テスト前にログイン済みユーザーへ固定する。
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: { user: { id: userId } },
    refreshSession: vi.fn(),
  });
});

it("queryKey に householdKeys.profile(userId)、queryFn に getProfile(client,userId) を使う", () => {
  useQueryMock.mockReturnValue({ isPending: true, isError: false, data: undefined });
  renderWithRouter();
  expect(useQueryMock).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: householdKeys.profile(userId) }),
  );
});

it("pending 中は進行状況を表示する", () => {
  useQueryMock.mockReturnValue({ isPending: true, isError: false, data: undefined });
  renderWithRouter();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.getByText(/確認/u)).toBeInTheDocument();
});

it.each(["not_started", "in_progress"] as const)(
  "%s は /welcome へ replace navigation する",
  async (status) => {
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      status: "success",
      data: { onboarding_status: status },
    });
    const router = renderWithRouter();
    expect(await screen.findByRole("heading", { name: "ウェルカム" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/welcome");
  },
);

it.each(["complete", "skipped"] as const)(
  "%s は /planner へ replace navigation する",
  async (status) => {
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      status: "success",
      data: { onboarding_status: status },
    });
    const router = renderWithRouter();
    expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/planner");
  },
);

it("query error は not_started へ推測変換せず再試行操作を持つ alert に留まりredirectしない", () => {
  useQueryMock.mockReturnValue({ isPending: false, isError: true, data: undefined });
  const router = renderWithRouter();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /再読み込み|再試行/u })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
});

it("profile row 欠損は not_started へ推測変換せず再試行操作を持つ alert に留まりredirectしない", () => {
  useQueryMock.mockReturnValue({ isPending: false, isError: false, data: null });
  const router = renderWithRouter();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /再読み込み|再試行/u })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
});
