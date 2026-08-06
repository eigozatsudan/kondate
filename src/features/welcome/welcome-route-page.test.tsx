import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getProfileMock = vi.hoisted(() => vi.fn());
const setOnboardingStatusMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("@/features/household/household-api", () => ({
  getProfile: getProfileMock,
  setOnboardingStatus: setOnboardingStatusMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

import { WelcomeRoutePage } from "./welcome-route-page";

const userId = "72000000-0000-4000-8000-000000000001";

function renderWelcome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/welcome", element: <WelcomeRoutePage /> },
      { path: "/planner", element: <h1>献立</h1> },
      { path: "/onboarding", element: <h1>家族設定</h1> },
    ],
    { initialEntries: ["/welcome"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("WelcomeRoutePage L4 first-writer", () => {
  beforeEach(() => {
    getProfileMock.mockReset();
    setOnboardingStatusMock.mockReset();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: userId } },
      refreshSession: vi.fn(),
    });
  });

  it("does not overwrite when another tab already set in_progress; navigates to onboarding", async () => {
    // 表示中は not_started。開始直前に live を in_progress に切替（別タブ先勝ち）。
    let liveStatus: "not_started" | "in_progress" | "skipped" | "complete" = "not_started";
    getProfileMock.mockImplementation(() => ({ onboarding_status: liveStatus }));
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    liveStatus = "in_progress";
    await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
    expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("does not overwrite when another tab already set skipped; navigates to planner", async () => {
    let liveStatus: "not_started" | "in_progress" | "skipped" | "complete" = "not_started";
    getProfileMock.mockImplementation(() => ({ onboarding_status: liveStatus }));
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "家族情報を登録する" })).toBeVisible();
    liveStatus = "skipped";
    await user.click(screen.getByRole("button", { name: "家族情報を登録する" }));
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/planner");
  });

  it("writes skipped when status is still not_started", async () => {
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "skipped" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
    await waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(expect.anything(), userId, "skipped", {
        expectedStatus: "not_started",
      });
    });
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/planner");
  });

  it("R1 CAS: when write returns in_progress (other tab won), navigates onboarding without assuming skipped", async () => {
    // locks 無し dual-tab: 自タブは idea(skipped) を要求したが CAS 負けで in_progress が返る
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "in_progress" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
    await waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(expect.anything(), userId, "skipped", {
        expectedStatus: "not_started",
      });
    });
    expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("R1 CAS: household start passes expectedStatus not_started", async () => {
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "in_progress" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "家族情報を登録する" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "家族情報を登録する" }));
    await waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        "in_progress",
        { expectedStatus: "not_started" },
      );
    });
    expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("L1: in_progress 表示で idea は expected=in_progress の skipped CAS へ進む", async () => {
    getProfileMock.mockResolvedValue({ onboarding_status: "in_progress" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "skipped" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(
      await screen.findByRole("button", { name: "設定せず献立アイデアを考える" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "設定せず献立アイデアを考える" }));
    await waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalledWith(expect.anything(), userId, "skipped", {
        expectedStatus: "in_progress",
      });
    });
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/planner");
  });

  it("L1: in_progress 表示の household は onboarding へ（書き込みなし）", async () => {
    getProfileMock.mockResolvedValue({ onboarding_status: "in_progress" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "家族設定を続ける" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "家族設定を続ける" }));
    expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
    expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/onboarding");
  });
});
