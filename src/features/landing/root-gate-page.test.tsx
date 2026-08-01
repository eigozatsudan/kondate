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
    expect(screen.getByText("ログイン状態を確認しています…")).toBeVisible();
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
});
