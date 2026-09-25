import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import {
  clearPendingGeneration,
  createPendingGeneration,
  readPendingGeneration,
  savePendingGeneration,
} from "../model/pending-generation";
import { GENERATION_OPENED_FROM_PLANNER_STATE } from "../model/generation-opened-from-planner";
import { savePendingGenerationReturnSurface } from "../model/pending-generation-return-surface";
import { GenerationPage } from "./generation-page";

// --- モック定義 ---------------------------------------------------------
// use-generation-recovery.test.tsx と同じモックの張り方を踏襲する。

const mockPost = vi.hoisted(() => vi.fn());
const mockStatus = vi.hoisted(() => vi.fn());
const mockGetUsageToday = vi.hoisted(() => vi.fn());
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
  readLiveGenerationDraftPin: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../api/usage-today-api", () => ({
  getUsageToday: mockGetUsageToday,
}));

// --- フィクスチャ --------------------------------------------------------

const USER_ID = "40000000-0000-4000-8000-000000000001";
const KEY_A = "10000000-0000-4000-8000-000000000001";
const SOURCE_MENU_ID = "60000000-0000-4000-8000-000000000001";
const DISH_ID = "70000000-0000-4000-8000-000000000001";

const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 1,
  limitKind: null,
  retryAt: null,
} as const;

function makeCommand(idempotencyKey: string): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    request: {
      idempotencyKey,
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 3,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function makeRegenerateDishCommand(idempotencyKey: string): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "regenerate_dish",
    qualityMode: false,
    request: {
      idempotencyKey,
      sourceMenuId: SOURCE_MENU_ID,
      dishId: DISH_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function makeRegenerateMenuCommand(idempotencyKey: string): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "regenerate_menu",
    qualityMode: false,
    request: {
      idempotencyKey,
      sourceMenuId: SOURCE_MENU_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-29.v1",
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

function failedStatus(idempotencyKey: string): Extract<GenerationStatusData, { status: "failed" }> {
  return {
    status: "failed",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    error: {
      code: "invalid_ai_response",
      message: "献立を正しく確認できませんでした。",
      retryable: true,
    },
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  };
}

type GenerationTestEntry = string | { pathname: string; state: unknown };

function renderGenerationPage(
  initialEntry: GenerationTestEntry = "/generation",
  earlierEntries: GenerationTestEntry[] = [],
) {
  const initialEntries = [...earlierEntries, initialEntry];
  const router = createMemoryRouter(
    [
      { path: "/generation", element: <GenerationPage /> },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/menus/:menuId", element: <h1>献立結果</h1> },
      { path: "/history/:menuId", element: <h1>履歴の献立</h1> },
      { path: "*", element: <h1>外の画面</h1> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
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
  clearPendingGeneration();
  currentUserIdRef.current = USER_ID;
  mockGetUsageToday.mockResolvedValue({
    plan: "free" as const,
    plusEntitled: false,
    success: { consumed: 0, limit: 1, remaining: 1 },
    attempts: { sent: 2, limit: 6, remaining: 4 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    quality: {
      day: { consumed: 0, limit: 3, remaining: 3 },
      month: { consumed: 0, limit: 20, remaining: 20 },
      available: false,
    },
    flyerWeekly: {
      successConsumed: 0,
      successLimit: 2,
      successRemaining: 2,
      triesConsumed: 0,
      triesLimit: 6,
      triesRemaining: 6,
      weekStartJst: "2026-07-27",
    },
    globalAvailable: true,
    retryAt: null,
  });
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

  it("wires session userId so terminal failure shows live usage today", async () => {
    // ページが userId を渡さないと request-local quota だけになり、
    // useUsageToday（成功残の真相）が本番経路で動かない。
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue(failedStatus(KEY_A));

    renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });
    expect(await screen.findByRole("region", { name: "今日あと何回作れるか" })).toBeVisible();
    // 設計 2026-07-29: success 残1行のみ。AI通信試行 dual は出さない
    expect(screen.getByText("無料版は本日あと1回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
    expect(screen.getByText("アプリ全体：作成できます")).toBeVisible();
    // request-local のフォールバック経路ではないこと
    expect(mockGetUsageToday).toHaveBeenCalled();
  });

  it("shows a resume notice when opened with resumed=1", async () => {
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue(processingStatus(KEY_A));

    renderGenerationPage("/generation?resumed=1");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    });
    const notice = screen.getByText("進行中の作成を再開しています");
    expect(notice).toBeVisible();
    expect(notice.closest(".generation-resume-notice")).not.toBeNull();
    expect(screen.getByText(/いま選んだ条件では新しく作り直していません/u)).toBeVisible();
  });

  // menus からの一品再生成が失敗したあと「条件を直してやり直す」で planner に落ちると
  // 下書き文脈がなく操作不能になる。元の /menus/:sourceMenuId へ戻す。
  it("returns to the source menus page after regenerate_dish failure clear", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(
      makeRegenerateDishCommand(KEY_A),
      USER_ID,
      () => new Date(),
    );
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue(failedStatus(KEY_A));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/menus/${SOURCE_MENU_ID}`);
    });
    expect(await screen.findByRole("heading", { name: "献立結果" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();
  });

  // UX 残り R2 項目 2: 履歴詳細から作り直して失敗したら、下タブが「献立」に変わらないよう
  // 入口の /history/:sourceMenuId へ戻す。
  it("R2: returns to the source history page when the regeneration started from history", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(
      makeRegenerateDishCommand(KEY_A),
      USER_ID,
      () => new Date(),
    );
    savePendingGeneration(pending);
    savePendingGenerationReturnSurface(KEY_A, "history");
    mockStatus.mockResolvedValue(failedStatus(KEY_A));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/history/${SOURCE_MENU_ID}`);
    });
    expect(await screen.findByRole("heading", { name: "履歴の献立" })).toBeVisible();
  });

  it("R2: keeps the history return path after a business error already cleared pending", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(
      makeRegenerateDishCommand(KEY_A),
      USER_ID,
      () => new Date(),
    );
    savePendingGeneration(pending);
    savePendingGenerationReturnSurface(KEY_A, "history");
    mockStatus.mockResolvedValue({ status: "not_started", idempotencyKey: KEY_A, quota });
    mockPost.mockRejectedValue(new Error("replace_dish_not_found"));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });
    expect(readPendingGeneration(USER_ID, new Date())).toBeNull();

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/history/${SOURCE_MENU_ID}`);
      expect(router.state.location.search).toBe("");
    });
  });

  // U4 修正ラウンド2: 業務エラーの合成 failed（POST が閉じたサーバ code で
  // 拒否され、失敗画面が出る前に pending がすでに消えている経路）から
  // 「条件を直してやり直す」を押しても、regenerate_dish の文脈を失わず
  // 元の /menus/:id に戻ることを確認する。ラウンド1の実装は resumeReview 時に
  // pending を読み直しており、この経路では pending が null に見えるため
  // /planner?resume=review へ誤って上書きしていた（レビュー Critical）。
  it("U4: 業務エラーで pending が消えたあとの regenerate_dish は条件を直してやり直すで /menus/:id に戻る（本番経路）", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(
      makeRegenerateDishCommand(KEY_A),
      USER_ID,
      () => new Date(),
    );
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue({ status: "not_started", idempotencyKey: KEY_A, quota });
    // "replace_dish_not_found" は POST_ERROR_STATUS_RECOVERABLE_FAILURE_CODES に
    // 含まれない閉じた業務 code なので、use-generation-recovery が
    // clearPendingGeneration() を呼んでから合成 failed を dispatch する
    // （失敗画面が出た時点で pending はもう存在しない）。
    mockPost.mockRejectedValue(new Error("replace_dish_not_found"));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });
    // 前提確認: この時点で pending はすでに消えている。
    expect(readPendingGeneration(USER_ID, new Date())).toBeNull();

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/menus/${SOURCE_MENU_ID}`);
      expect(router.state.location.search).toBe("");
    });
    expect(await screen.findByRole("heading", { name: "献立結果" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();
  });

  it("U4: 業務エラーで pending が消えたあとの regenerate_menu は条件を直してやり直すで /menus/:id に戻る（本番経路）", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(
      makeRegenerateMenuCommand(KEY_A),
      USER_ID,
      () => new Date(),
    );
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue({ status: "not_started", idempotencyKey: KEY_A, quota });
    mockPost.mockRejectedValue(new Error("source_menu_not_found"));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });
    expect(readPendingGeneration(USER_ID, new Date())).toBeNull();

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/menus/${SOURCE_MENU_ID}`);
      expect(router.state.location.search).toBe("");
    });
    expect(await screen.findByRole("heading", { name: "献立結果" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();
  });

  // G3: 別タブが pending を消すと retryStatus の isCurrent が落ち、checking のまま
  // GenerationPage は idle 以外 Navigate しない。RecoveryLinks から破棄できること。
  it("lets the user leave a stuck checking spinner after another tab clears pending", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    let resolveStatus: ((value: ReturnType<typeof processingStatus>) => void) | undefined;
    mockStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("保存した作成状況を確認しています");
    });
    clearPendingGeneration();
    expect(router.state.location.pathname).toBe("/generation");
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    // U4 修正ラウンド1: 本番経路（Button + onClear + Navigate）でも
    // resume=review 付きで確認画面へ直着地する。
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/planner");
      expect(router.state.location.search).toBe("?resume=review");
    });
    expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
    resolveStatus?.(processingStatus(KEY_A));
    confirmSpy.mockRestore();
  });

  // G-R1: GET not_started 後 POST 中に別タブが pending を消すと isCurrent が落ち、
  // submitting のまま固着する。GenerationPage は idle 以外 Navigate しない。
  it("lets the user leave a stuck submitting spinner after another tab clears pending", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue({
      status: "not_started",
      idempotencyKey: KEY_A,
      quota,
    });
    let resolvePost: ((value: GenerationStatusData) => void) | undefined;
    mockPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("条件を確認しています");
    });
    clearPendingGeneration();
    expect(router.state.location.pathname).toBe("/generation");
    expect(screen.queryByRole("heading", { name: "プランナー" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/planner");
      expect(router.state.location.search).toBe("?resume=review");
    });
    expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
    resolvePost?.({
      status: "succeeded",
      idempotencyKey: KEY_A,
      requestId: "50000000-0000-4000-8000-000000000001",
      menuId: "30000000-0000-4000-8000-000000000001",
      completedAt: "2026-07-11T00:00:01.000Z",
      quota: { ...quota, consumed: true },
    });
    confirmSpy.mockRestore();
  });

  // U4 修正ラウンド1: 本番で唯一使われる経路（GenerationStatusPanel の Button
  // → onClear → GenerationPage の handleClear → clearGeneration → Navigate）で
  // 「条件を直してやり直す」を押すと、U3 の「下書きがあると /planner はホームを
  // 出す」影響を受けずに resume=review 付きで確認画面へ直着地することを確認する。
  // <a href> 側（onClear 未指定時のフォールバック）だけを見るテストでは、この
  // 本番経路の regression（レビュー指摘）を検出できないため、ここでは
  // renderGenerationPage 経由で実際のボタンクリックを再現する。
  it("U4: 条件を直してやり直すは resume=review 付きで planner へ直着地する（本番経路）", async () => {
    const user = userEvent.setup();
    const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
    savePendingGeneration(pending);
    mockStatus.mockResolvedValue(failedStatus(KEY_A));

    const router = renderGenerationPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/planner");
      expect(router.state.location.search).toBe("?resume=review");
    });
    expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
  });
  // UX 残り R1 項目 1: planner が push した /generation（entry に印がある）が idle になったら、
  // /planner を 2 つ並べず 1 つ戻る。生成・結果から戻ったあとに戻るが 1 回空振りしないこと。
  describe("returning to the planner entry it was opened from", () => {
    const fromPlanner = { pathname: "/generation", state: GENERATION_OPENED_FROM_PLANNER_STATE };

    async function pressBack(router: ReturnType<typeof renderGenerationPage>): Promise<void> {
      await act(async () => {
        await router.navigate(-1);
      });
    }

    it("goes back to the planner entry instead of duplicating /planner when idle", async () => {
      const router = renderGenerationPage(fromPlanner, ["/history", "/planner"]);
      expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/planner");
      expect(router.state.historyAction).toBe("POP");

      await pressBack(router);
      expect(router.state.location.pathname).toBe("/history");
      expect(await screen.findByRole("heading", { name: "外の画面" })).toBeVisible();
    });

    it("leaves the planner in one back after returning from the result screen", async () => {
      const router = renderGenerationPage(`/menus/${SOURCE_MENU_ID}?recovered=1`, [
        "/history",
        "/planner",
        fromPlanner,
      ]);
      expect(await screen.findByRole("heading", { name: "献立結果" })).toBeVisible();

      // 結果で戻ると /generation に着き、idle なのでそのまま /planner の entry へ戻る
      await pressBack(router);
      expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/planner");

      await pressBack(router);
      expect(router.state.location.pathname).toBe("/history");
      expect(await screen.findByRole("heading", { name: "外の画面" })).toBeVisible();
    });

    it("replaces instead of going back when the marked entry is the first entry of the tab", async () => {
      // ブラウザ履歴で idx が 0（タブの最初の entry）なら、1 つ戻るとアプリの外へ出てしまう
      window.history.replaceState({ idx: 0 }, "");
      try {
        const router = renderGenerationPage(fromPlanner);
        expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
        expect(router.state.historyAction).toBe("REPLACE");
      } finally {
        window.history.replaceState(null, "");
      }
    });

    it("still replaces /generation with /planner when the entry has no planner mark", async () => {
      const router = renderGenerationPage("/generation", ["/history"]);
      expect(await screen.findByRole("heading", { name: "プランナー" })).toBeVisible();
      expect(router.state.historyAction).toBe("REPLACE");

      await pressBack(router);
      expect(router.state.location.pathname).toBe("/history");
    });

    it("keeps replacing with ?resume=review for 条件を直してやり直す even with the planner mark", async () => {
      const user = userEvent.setup();
      const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
      savePendingGeneration(pending);
      mockStatus.mockResolvedValue(failedStatus(KEY_A));
      const router = renderGenerationPage(fromPlanner, ["/history", "/planner"]);

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "献立を作成できませんでした" })).toBeVisible();
      });
      await user.click(screen.getByRole("button", { name: "条件を直してやり直す" }));

      await waitFor(() => {
        expect(router.state.location.search).toBe("?resume=review");
      });
      expect(router.state.location.pathname).toBe("/planner");
      expect(router.state.historyAction).toBe("REPLACE");
    });

    it("keeps the device back from the in-progress screen landing on the planner entry", async () => {
      const pending = createPendingGeneration(makeCommand(KEY_A), USER_ID, () => new Date());
      savePendingGeneration(pending);
      mockStatus.mockResolvedValue(processingStatus(KEY_A));
      const router = renderGenerationPage(fromPlanner, ["/history", "/planner"]);
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
      });

      // 端末の戻るで作成中の画面から planner へ戻るのは従来どおり
      await pressBack(router);
      expect(router.state.location.pathname).toBe("/planner");
      await pressBack(router);
      expect(router.state.location.pathname).toBe("/history");
    });
  });
});
