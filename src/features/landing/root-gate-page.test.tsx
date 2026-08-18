import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "@/features/auth/auth-provider";

const useAuthMock = vi.hoisted(() => vi.fn());

/** FreeLanding を一時 suspend させて Suspense fallback を観測する（L1）。 */
const freeLpSuspend = vi.hoisted(() => {
  let pending: Promise<void> | null = null;
  let release: (() => void) | null = null;
  return {
    start() {
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    finish() {
      release?.();
      pending = null;
      release = null;
    },
    maybeSuspend() {
      if (pending !== null) {
        // React Suspense: throw した Promise が解決するまで fallback を表示
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense 契約
        throw pending;
      }
    },
  };
});

vi.mock("@/features/auth/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("@/features/auth/root-entry-page", () => ({
  RootEntryPage: () => <h1>RootEntry stub</h1>,
}));
vi.mock("./free-landing-page", async () => {
  const actual = await vi.importActual<typeof import("./free-landing-page")>("./free-landing-page");
  return {
    ...actual,
    FreeLandingPage: () => {
      freeLpSuspend.maybeSuspend();
      return <h1>{actual.FREE_LP_H1}</h1>;
    },
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
    freeLpSuspend.finish();
  });

  afterEach(() => {
    freeLpSuspend.finish();
  });

  it("shows session check copy while loading and neither landing nor entry", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    const pending = screen.getByText("ログイン状態を確認しています…");
    expect(pending).toBeVisible();
    // L4: AppShell 外待ちは Welcome / RootEntry と同型の h1 を置く
    expect(
      screen.getByRole("heading", { level: 1, name: "ログイン状態を確認しています" }),
    ).toBeVisible();
    // L10: main busy + status live（mount 後に sr-only status が埋まる）
    expect(pending.closest("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when unauthenticated", async () => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    // FreeLanding は React.lazy のため chunk 解決を待つ
    expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when session is null even if status is not unauthenticated", async () => {
    // fail-closed: session null → LP（設計 L14）
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
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

  it("L1: after C5 deadline while still loading, fail-closed to free landing", async () => {
    vi.useFakeTimers();
    try {
      useAuthMock.mockReturnValue({
        status: "loading",
        session: null,
        refreshSession: vi.fn(),
      });
      renderGate();
      expect(screen.getByText("ログイン状態を確認しています…")).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
      });
      // lazy + Suspense は real timer の wait が必要なので切り替える
      vi.useRealTimers();
      expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
      // deadline 後に cold-start と同じ「確認中」で着地しない
      expect(screen.queryByText("ログイン状態を確認しています…")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("L1: Suspense fallback uses chunk-loading copy, not session-check copy", async () => {
    freeLpSuspend.start();
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    // lazy chunk 解決後も FreeLanding が suspend 中 → fallback が見える
    expect(await screen.findByText("読み込み中…")).toBeVisible();
    expect(screen.queryByText("ログイン状態を確認しています…")).not.toBeInTheDocument();
    // finish は同期。act の戻りは void のため await しない（require-await / await-thenable）
    act(() => {
      freeLpSuspend.finish();
    });
    expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByText("読み込み中…")).not.toBeInTheDocument();
  });

  it("L2: Free LP chunk hang past C5 deadline shows reload UI", async () => {
    freeLpSuspend.start();
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    // deadline の setTimeout を fake 下で武装させる（real で武装すると advance が効かない）
    vi.useFakeTimers();
    try {
      renderGate();
      await act(async () => {
        // lazy import の microtask を流す（chunk 自体は mock、子は suspend 継続）
        await Promise.resolve();
        await Promise.resolve();
      });
      const loading = screen.getByText("読み込み中…");
      expect(loading).toBeVisible();
      // L10: chunk 待ちも busy + status live
      expect(loading.closest("main")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
      await act(async () => {
        // L3: timer は queueMicrotask 再確認するため +1 tick 相当を流す
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
      });
      expect(
        screen.getByText("読み込みに時間がかかっています。通信を確認して再読み込みしてください。"),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "再読み込み" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
      // L3: hang 中の可視ランドマークは timeout 側 main だけ（hidden LP は a11y ツリー外）
      expect(
        screen.getByRole("heading", { level: 1, name: "読み込みに時間がかかっています" }),
      ).toBeVisible();
      expect(screen.getAllByRole("main")).toHaveLength(1);
    } finally {
      freeLpSuspend.finish();
      vi.useRealTimers();
    }
  });

  it("L3: successful Free LP mount stays mounted (layoutEffect disarms timeout)", async () => {
    // probe の useLayoutEffect が loaded を立て timer を clear するため、
    // 成功 mount 後に timeout UI へ差し替わらないことを固定する。
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    // 成功後も再読み込み UI にはならない
    expect(
      screen.queryByText("読み込みに時間がかかっています。通信を確認して再読み込みしてください。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再読み込み" })).not.toBeInTheDocument();
  });

  it("L3: load completing after timer microtask does not sticky-timeout successful mount", async () => {
    // timer 発火 → microtask が setTimedOut を予約 → 同一 flush で Suspense が commit しても
    // loadedRef + setTimedOut(false) で成功 UI を維持する（sticky 誤 timeout 防止）。
    freeLpSuspend.start();
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    vi.useFakeTimers();
    try {
      renderGate();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("読み込み中…")).toBeVisible();
      await act(async () => {
        // 同一 act 内: timer microtask の setTimedOut(true) と成功 commit を交差させる
        await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS);
        await Promise.resolve();
        freeLpSuspend.finish();
        await Promise.resolve();
        await Promise.resolve();
      });
      vi.useRealTimers();
      expect(await screen.findByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
      expect(
        screen.queryByText(
          "読み込みに時間がかかっています。通信を確認して再読み込みしてください。",
        ),
      ).not.toBeInTheDocument();
    } finally {
      freeLpSuspend.finish();
      vi.useRealTimers();
    }
  });
});
