import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import { createPendingGeneration, savePendingGeneration } from "../model/pending-generation";
import { GenerationPage } from "./generation-page";

// --- モック定義 ---------------------------------------------------------
// use-generation-recovery.test.tsx と同じモックの張り方を踏襲する。

const mockPost = vi.hoisted(() => vi.fn());
const mockStatus = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const currentUserIdRef = vi.hoisted(() => ({ current: "" }));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session:
      currentUserIdRef.current === ""
        ? null
        : ({ user: { id: currentUserIdRef.current } } as Session),
  }),
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: unsubscribeMock } } }),
    },
  }),
}));
vi.mock("../api/generation-api", () => ({
  postGeneration: mockPost,
  getGenerationStatus: mockStatus,
}));

// --- フィクスチャ --------------------------------------------------------

const USER_ID = "40000000-0000-4000-8000-000000000001";
const KEY_A = "10000000-0000-4000-8000-000000000001";

const quota = {
  consumed: false,
  remaining: 4,
  userDailyLimit: 5,
  limitKind: null,
  retryAt: null,
} as const;

function makeCommand(idempotencyKey: string): GenerationCommand {
  return {
    kind: "new_menu",
    request: {
      idempotencyKey,
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 3,
      privacyNoticeVersion: "2026-07-11.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function processingStatus(
  idempotencyKey: string,
): Extract<GenerationStatusData, { status: "processing" }> {
  return {
    status: "processing",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    startedAt: "2026-07-11T00:00:00.000Z",
    quota,
  };
}

function renderGenerationPage() {
  const router = createMemoryRouter(
    [
      { path: "/generation", element: <GenerationPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
    ],
    { initialEntries: ["/generation"] },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserIdRef.current = USER_ID;
});

describe("GenerationPage", () => {
  it("復旧確認が終わる前に /planner へリダイレクトしない", async () => {
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue(processingStatus(KEY_A));

    const router = renderGenerationPage();

    // マウント直後（復旧フックの mount effect がまだ確定する前）は、
    // 中立なプレースホルダーを表示し、この時点で /planner へは遷移していない。
    expect(router.state.location.pathname).toBe("/generation");

    // 復旧フックが保存済みの作成中状況を検出し、GenerationStatusPanel の
    // processing 表示（見出し「献立を作っています」）へ到達する。
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    });

    // 一貫して /planner へは一度も遷移していない。
    expect(router.state.location.pathname).toBe("/generation");
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("復旧すべき保存内容が無いときは /planner へ遷移する", async () => {
    const router = renderGenerationPage();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/planner");
    });
    expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
  });
});
