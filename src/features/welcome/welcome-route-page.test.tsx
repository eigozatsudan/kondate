import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";

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

import {
  WelcomeRoutePage,
  WELCOME_START_CAS_SETTLE_MS,
  WELCOME_START_RECONCILE_GRACE_MS,
} from "./welcome-route-page";

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

  afterEach(() => {
    // fake timer 残留で後続 findBy / userEvent が testTimeout(15s) まで死ぬのを防ぐ
    vi.useRealTimers();
    cleanup();
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

  it("L1: start re-read hang past C5 deadline shows error and re-enables CTA", async () => {
    // 表示用は 1 回解決、開始時 re-read 以降は never-settle → lock 内 withTimeout
    // timeout 後の L1 reconcile 再読込も hang するため grace も進める
    getProfileMock
      .mockResolvedValueOnce({ onboarding_status: "not_started" })
      .mockReturnValue(new Promise(() => undefined));
    // 初回 profile は real で解決。withTimeout 武装後だけ fake で 15s を進める
    renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    vi.useFakeTimers();
    try {
      // userEvent は fake timer 下で delay 待ちし得るため fireEvent で即時発火
      fireEvent.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
      expect(screen.getByRole("button", { name: "準備しています…" })).toBeDisabled();
      await act(async () => {
        // C5 + reconcile grace。双方 hang なら失敗 UI
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS + WELCOME_START_RECONCILE_GRACE_MS,
        );
      });
      // getBy: fake timer 下の findBy ポーリングは進まない
      expect(screen.getByRole("alert")).toHaveTextContent("開始できませんでした");
      expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeEnabled();
      expect(setOnboardingStatusMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L1: zombie re-read after timeout does not CAS or navigate when still not_started", async () => {
    // timeout 後に遅延 resolve しても not_started なら CAS / navigate なし
    let resolveReread: ((value: { onboarding_status: string }) => void) | undefined;
    getProfileMock.mockResolvedValueOnce({ onboarding_status: "not_started" }).mockImplementation(
      () =>
        new Promise<{ onboarding_status: string }>((resolve) => {
          resolveReread = resolve;
        }),
    );
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      // C5 timeout 後の reconcile re-read も hang。grace で打ち切り失敗 UI
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WELCOME_START_RECONCILE_GRACE_MS);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("開始できませんでした");
      expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeEnabled();
      // ゾンビ re-read が not_started で settle しても CAS / navigate しない
      await act(async () => {
        resolveReread?.({ onboarding_status: "not_started" });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOnboardingStatusMock).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe("/welcome");
      expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L1: deferred CAS past C5 reconciles navigate instead of sticky false failure", async () => {
    // CAS が C5 後に着地しても、timeout 無効化後のゾンビを reconcile して遷移する
    let resolveCas: ((value: { onboarding_status: string }) => void) | undefined;
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockImplementation(
      () =>
        new Promise<{ onboarding_status: string }>((resolve) => {
          resolveCas = resolve;
        }),
    );
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
      // getProfile mock を microtask で流し CAS を武装
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOnboardingStatusMock).toHaveBeenCalled();
      await act(async () => {
        // C5 + reconcile grace（CAS outstanding → single-flight 維持、即失敗 UI にしない）
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS + WELCOME_START_RECONCILE_GRACE_MS,
        );
      });
      // post-grace でも CAS 待ちのため CTA は閉じたまま（opposite dual-flight 防止）
      expect(screen.getByRole("button", { name: "準備しています…" })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      // findBy / RR navigate は real timer 下で待つ（fake 下の findBy は testTimeout までハング）
      vi.useRealTimers();
    }
    // 遅延 CAS が skipped で着地 → L1 reconcile で /planner へ
    await act(async () => {
      resolveCas?.({ onboarding_status: "skipped" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/planner");
  });

  it("L1: post-grace CAS hang keeps single-flight; opposite CTA does not issue second CAS", async () => {
    // C5+grace 後も zombie CAS が pending の間は双方 CTA を閉じ、opposite が dual-flight しない
    // （第二 deadline 前までは single-flight 維持。永久待ちは L1 CAS settle 上限で切る）
    let resolveCas: ((value: { onboarding_status: string }) => void) | undefined;
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockImplementation(
      () =>
        new Promise<{ onboarding_status: string }>((resolve) => {
          resolveCas = resolve;
        }),
    );
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOnboardingStatusMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS + WELCOME_START_RECONCILE_GRACE_MS,
        );
      });
      // false failure で双方 CTA を開けない（pre-CAS hang と非対称）
      expect(screen.getByRole("button", { name: "準備しています…" })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // opposite CTA は disabled。クリックしても第二 CAS は出ない
      const household = screen.getByRole("button", { name: "家族情報を登録する" });
      expect(household).toBeDisabled();
      fireEvent.click(household);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOnboardingStatusMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
    // 第一 CAS が skipped で着地 → household 意図の dual CAS なしで /planner へ単一 reconcile
    await act(async () => {
      resolveCas?.({ onboarding_status: "skipped" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/planner");
    expect(setOnboardingStatusMock).toHaveBeenCalledTimes(1);
    expect(setOnboardingStatusMock).toHaveBeenCalledWith(expect.anything(), userId, "skipped", {
      expectedStatus: "not_started",
    });
  });

  it("L1: post-grace CAS never-settle past second deadline re-enables CTA", async () => {
    // 第二 deadline 超過で single-flight を解除し、永久「準備しています…」閉塞を避ける
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockImplementation(() => new Promise(() => undefined));
    renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setOnboardingStatusMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          COLD_START_SESSION_DEADLINE_MS +
            WELCOME_START_RECONCILE_GRACE_MS +
            WELCOME_START_CAS_SETTLE_MS,
        );
      });
      expect(screen.getByRole("alert")).toHaveTextContent("開始できませんでした");
      expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "家族情報を登録する" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L2: unmount during start does not zombie-navigate after late CAS", async () => {
    // 離脱後に CAS が成功しても generation 無効化で router yank しない
    let resolveCas: ((value: { onboarding_status: string }) => void) | undefined;
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockImplementation(
      () =>
        new Promise<{ onboarding_status: string }>((resolve) => {
          resolveCas = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        { path: "/welcome", element: <WelcomeRoutePage /> },
        { path: "/planner", element: <h1>献立</h1> },
        { path: "/onboarding", element: <h1>家族設定</h1> },
        { path: "/history", element: <h1>履歴</h1> },
      ],
      { initialEntries: ["/welcome"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "家族情報を登録する" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "家族情報を登録する" }));
    expect(screen.getByRole("button", { name: "準備しています…" })).toBeDisabled();
    // CAS 発行まで待ってから離脱（未発行だとゾンビ経路を検証できない）
    await waitFor(() => {
      expect(setOnboardingStatusMock).toHaveBeenCalled();
    });
    // 開始 flight 中に別画面へ離脱（household CAS 成功なら本来 /onboarding）
    await act(async () => {
      await router.navigate("/history");
    });
    expect(router.state.location.pathname).toBe("/history");
    expect(await screen.findByRole("heading", { name: "履歴" })).toBeVisible();
    await act(async () => {
      resolveCas?.({ onboarding_status: "in_progress" });
      await Promise.resolve();
      await Promise.resolve();
    });
    // ゾンビ navigate で /onboarding に引っ張られない
    expect(router.state.location.pathname).toBe("/history");
    expect(screen.getByRole("heading", { name: "履歴" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "家族設定" })).not.toBeInTheDocument();
  });

  it("L2: CAS success navigates even when invalidateQueries would hang", async () => {
    // invalidate を await しない契約: CAS 成功後は false failure を出さない
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "skipped" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(setOnboardingStatusMock).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/planner");
    // 失敗 alert は出ない
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("L10: profile loading main exposes aria-busy and aria-live", async () => {
    getProfileMock.mockReturnValue(new Promise(() => undefined));
    renderWelcome();
    const pending = await screen.findByText("状態を確認しています…");
    expect(pending.closest("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("L4: successful idea start replaces history (back does not return to welcome)", async () => {
    getProfileMock.mockResolvedValue({ onboarding_status: "not_started" });
    setOnboardingStatusMock.mockResolvedValue({ onboarding_status: "skipped" });
    const user = userEvent.setup();
    const router = renderWelcome();
    expect(await screen.findByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
    expect(await screen.findByRole("heading", { name: "献立" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/planner");
    // replace なので stack に /welcome が残らず、戻っても welcome に着地しない
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe("/planner");
    expect(screen.queryByRole("button", { name: "献立アイデアを考える" })).not.toBeInTheDocument();
  });
});
