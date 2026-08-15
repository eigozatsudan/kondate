import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";
import { getNextJstMidnight } from "@shared/time/jst";
import { HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY } from "@/features/planner/household-safety-helper-copy";
import type { GenerationClientState } from "../model/generation-machine";
import {
  clearPendingGeneration,
  createPendingGeneration,
  savePendingGeneration,
} from "../model/pending-generation";
import {
  clearPendingGenerationMeta,
  savePendingGenerationMeta,
} from "../model/pending-generation-meta";
import { GENERATION_PROGRESS_STAGES } from "../model/progress-stages";
import { GenerationStatusPanel } from "./generation-status-panel";

const getUsageTodayMock = vi.hoisted(() => vi.fn());

vi.mock("../api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));

const USER_ID = "60000000-0000-4000-8000-000000000001";

const NOW = new Date("2026-07-20T05:00:00.000Z");
const KEY = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
// E-I1: サーバ jsonb の timestamptz は +00:00。クライアント toISOString の .000Z と文字列一致させない。
const serverRetryAt = getNextJstMidnight(NOW).toISOString().replace(".000Z", "+00:00");
const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3,
  limitKind: "user",
  retryAt: serverRetryAt,
} as const;
const failedData: Extract<GenerationStatusData, { status: "failed" }> = {
  status: "failed",
  idempotencyKey: KEY,
  requestId: REQUEST_ID,
  error: {
    code: "user_daily_limit",
    message: "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    retryable: false,
  },
  completedAt: "2026-07-11T00:00:01.000Z",
  quota,
};
const failedState: GenerationClientState = { phase: "failed", data: failedData, effect: "none" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getUsageTodayMock.mockResolvedValue({
    plan: "free" as const,
    plusEntitled: false,
    success: { consumed: 1, limit: 3, remaining: 2 },
    attempts: { sent: 0, limit: 6, remaining: 6 },
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

afterEach(() => {
  vi.useRealTimers();
  clearPendingGeneration();
  clearPendingGenerationMeta();
});

function constraintConflictState(idempotencyKey: string = KEY): GenerationClientState {
  const data: Extract<GenerationStatusData, { status: "constraint_conflict" }> = {
    status: "constraint_conflict",
    idempotencyKey,
    requestId: REQUEST_ID,
    conflicts: [
      {
        code: "mandatory_safety_conflict",
        message: "必須の安全条件を満たす献立を作成できません。",
        conditionRefs: ["member_1"],
      },
      {
        code: "must_use_conflict",
        message: "条件を同時に満たせません。",
        conditionRefs: ["pantry_1"],
      },
    ],
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  };
  return { phase: "constraint_conflict", data, effect: "none" };
}

function seedNewMenuHouseholdPending(idempotencyKey: string = KEY): void {
  const pending = createPendingGeneration(
    {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey,
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    USER_ID,
    () => NOW,
  );
  savePendingGeneration(pending);
  savePendingGenerationMeta({
    kind: "new_menu",
    targetMode: "household",
    idempotencyKey,
    ownerUserId: USER_ID,
    createdAt: pending.createdAt,
  });
}

function renderWithUser(ui: ReactElement) {
  // userId 付きは TerminalQuotaBlock → useUsageToday が QueryClient を要求する
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("GenerationStatusPanel", () => {
  it("succeeded では遷移・結果読込中のインジケータを出す", () => {
    const succeededState: GenerationClientState = {
      phase: "succeeded",
      data: {
        status: "succeeded",
        idempotencyKey: KEY,
        requestId: REQUEST_ID,
        menuId: "30000000-0000-4000-8000-000000000001",
        completedAt: "2026-07-11T00:00:01.000Z",
        quota: {
          consumed: true,
          remaining: 1,
          userDailyLimit: 3,
          limitKind: "user",
          retryAt: null,
        },
      },
      effect: "navigate",
    };
    const { container } = render(<GenerationStatusPanel state={succeededState} />);
    expect(screen.getByRole("status")).toHaveTextContent("献立を表示しています");
    expect(container.querySelector(".gen-status-indicator")).not.toBeNull();
    expect(container.querySelector('[data-phase="succeeded"]')).not.toBeNull();
  });

  it("same-session new_menu household conflict shows helper once", () => {
    seedNewMenuHouseholdPending();
    renderWithUser(<GenerationStatusPanel state={constraintConflictState()} userId={USER_ID} />);
    expect(screen.getAllByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toHaveLength(1);
  });

  it("reload: rehydrate pending+meta shows helper once", () => {
    // storage に書いたあと unmount→remount で復帰経路を再現する
    seedNewMenuHouseholdPending();
    const first = renderWithUser(
      <GenerationStatusPanel state={constraintConflictState()} userId={USER_ID} />,
    );
    expect(screen.getAllByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toHaveLength(1);
    first.unmount();
    renderWithUser(<GenerationStatusPanel state={constraintConflictState()} userId={USER_ID} />);
    expect(screen.getAllByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toHaveLength(1);
  });

  it("after regenerate pending helper is absent", () => {
    seedNewMenuHouseholdPending();
    // regenerate save が meta を clear する契約を踏む
    const regenerate = createPendingGeneration(
      {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "10000000-0000-4000-8000-000000000099",
          sourceMenuId: "60000000-0000-4000-8000-000000000001",
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      USER_ID,
      () => NOW,
    );
    savePendingGeneration(regenerate);
    renderWithUser(
      <GenerationStatusPanel
        state={constraintConflictState(regenerate.request.idempotencyKey)}
        userId={USER_ID}
      />,
    );
    expect(screen.queryByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).not.toBeInTheDocument();
  });

  it("idea new_menu conflict does not show household helper", () => {
    const pending = createPendingGeneration(
      {
        commandVersion: "generation-command.v3",
        kind: "new_menu",
        qualityMode: false,
        request: {
          idempotencyKey: KEY,
          draftId: "20000000-0000-4000-8000-000000000001",
          draftRevision: 1,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      USER_ID,
      () => NOW,
    );
    savePendingGeneration(pending);
    savePendingGenerationMeta({
      kind: "new_menu",
      targetMode: "idea",
      idempotencyKey: KEY,
      ownerUserId: USER_ID,
      createdAt: pending.createdAt,
    });
    renderWithUser(<GenerationStatusPanel state={constraintConflictState()} userId={USER_ID} />);
    expect(screen.queryByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).not.toBeInTheDocument();
  });

  it("shows simplified not-consumed notice and success remaining after failure", () => {
    render(<GenerationStatusPanel state={failedState} />);
    expect(screen.getByText("献立は完成していないので、作成回数は減っていません")).toBeVisible();
    expect(screen.queryByText("成功回数には含まれません")).not.toBeInTheDocument();
    expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
    // 日次枠の retryAt（翌 JST 0:00）は「明日H:MM」
    expect(screen.getByText(/^再開: 明日/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toHaveAttribute(
      "href",
      "/emergency-menus",
    );
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toHaveAttribute(
      "href",
      "/history",
    );
  });

  it("G1: quality_monthly_limit retryAt (next JST month) does not show 明日", () => {
    // 2026-07-20 JST 相当の NOW から翌月初 = 2026-08-01 00:00 JST = 2026-07-31T15:00:00.000Z
    const nextMonthStart = "2026-07-31T15:00:00+00:00";
    const monthlyFailed: GenerationClientState = {
      phase: "failed",
      data: {
        ...failedData,
        error: {
          code: "quality_monthly_limit",
          message: "今月のプレミアム回数を使い切りました。",
          retryable: false,
        },
        quota: {
          ...quota,
          retryAt: nextMonthStart,
        },
      },
      effect: "none",
    };
    render(<GenerationStatusPanel state={monthlyFailed} />);
    const resume = screen.getByText(/^再開:/u);
    expect(resume).toBeVisible();
    expect(resume).not.toHaveTextContent(/明日/u);
    // 絶対日時（formatRetryAt / ja-JP short）を含むこと
    expect(resume).toHaveTextContent(/2026/u);
  });

  it("shows Plus hard-limit CTA on Free daily limit failure without usage userId", () => {
    const zeroQuota = {
      ...quota,
      remaining: 0,
    } as const;
    const zeroFailed: GenerationClientState = {
      phase: "failed",
      data: { ...failedData, quota: zeroQuota },
      effect: "none",
    };
    render(<GenerationStatusPanel state={zeroFailed} />);
    expect(screen.getByText(/Plus なら 1 日最大 10 回まで作成できます/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/plus");
  });

  it("shows emergency recovery link on failed recovery regardless of path", () => {
    render(<GenerationStatusPanel state={failedState} />);
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toHaveAttribute(
      "href",
      "/emergency-menus",
    );
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toBeInTheDocument();
  });

  it("shows emergency recovery link on request_conflict regardless of path", () => {
    const requestConflictState: GenerationClientState = {
      phase: "request_conflict",
      code: "idempotency_payload_mismatch",
      message: "前回と異なる内容で再送できません。もう一度操作してください",
      effect: "none",
    };
    render(<GenerationStatusPanel state={requestConflictState} />);
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toBeInTheDocument();
  });

  it("does not prefix Plus daily-limit failure with 無料版は (L16)", async () => {
    vi.useRealTimers();
    getUsageTodayMock.mockResolvedValue({
      plan: "plus" as const,
      plusEntitled: true,
      success: { consumed: 10, limit: 10, remaining: 0 },
      attempts: { sent: 0, limit: 20, remaining: 20 },
      shortWindow: { sent: 0, limit: 8, remaining: 8, retryAt: null },
      quality: {
        day: { consumed: 0, limit: 3, remaining: 3 },
        month: { consumed: 0, limit: 20, remaining: 20 },
        available: true,
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/無料版は本日の作成上限/u)).not.toBeInTheDocument();
  });

  it("shows success remaining only via usage today without dual attempt lines", async () => {
    vi.useRealTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("region", { name: "今日あと何回作れるか" })).toBeVisible();
    expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/10分間の通信試行/u)).not.toBeInTheDocument();
    expect(screen.getByText("アプリ全体：作成できます")).toBeVisible();
    // R-I1: retryAt はパネル直下に必ず1行（Terminal は data.retryAt を出さない）
    expect(screen.getAllByText(/再開/u)).toHaveLength(1);
  });

  it("shows global unavailable without free-tier prefix on dual jargon lines", async () => {
    vi.useRealTimers();
    getUsageTodayMock.mockResolvedValue({
      plan: "free" as const,
      plusEntitled: false,
      success: { consumed: 1, limit: 3, remaining: 2 },
      attempts: { sent: 5, limit: 6, remaining: 1 },
      shortWindow: {
        sent: 3,
        limit: 4,
        remaining: 1,
        retryAt: null,
      },
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
      globalAvailable: false,
      retryAt: "2026-07-11T15:00:00.000Z",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    const region = await screen.findByRole("region", { name: "今日あと何回作れるか" });
    expect(region).toBeVisible();
    expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
    expect(screen.getByText("アプリ全体：今日はここまで")).toBeVisible();
  });

  it("does not show attempt remaining zero as a second residual line", async () => {
    vi.useRealTimers();
    getUsageTodayMock.mockResolvedValue({
      plan: "free" as const,
      plusEntitled: false,
      success: { consumed: 1, limit: 3, remaining: 2 },
      attempts: { sent: 6, limit: 6, remaining: 0 },
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
      retryAt: "2026-07-11T15:00:00.000Z",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("無料版は本日あと2回まで献立の作成を受け付けます"),
    ).toBeVisible();
    expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
    expect(screen.getByText("アプリ全体：作成できます")).toBeVisible();
  });

  it("shows short-window wait copy when usage returns a shortWindow retryAt", async () => {
    vi.useRealTimers();
    getUsageTodayMock.mockResolvedValue({
      plan: "free" as const,
      plusEntitled: false,
      success: { consumed: 1, limit: 3, remaining: 2 },
      attempts: { sent: 2, limit: 6, remaining: 4 },
      shortWindow: {
        sent: 4,
        limit: 4,
        remaining: 0,
        retryAt: "2026-07-11T09:10:00+09:00",
      },
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
      retryAt: "2026-07-11T09:10:00+09:00",
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("無料版は本日あと2回まで献立の作成を受け付けます"),
    ).toBeVisible();
    expect(screen.getByText(/短い時間に何度も作成を試したため/u)).toBeVisible();
    expect(screen.queryByText(/10分間の通信試行/u)).not.toBeInTheDocument();
  });

  it("shows usage fetch error without dual jargon", async () => {
    vi.useRealTimers();
    getUsageTodayMock.mockRejectedValue(new Error("network"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        "プラン情報を含む本日の作成回数を確認できません。再読み込みしてください",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/AI通信試行/u)).not.toBeInTheDocument();
  });

  it("shows request_conflict copy and fresh-start without not-consumed claim", async () => {
    vi.useRealTimers();
    const onClear = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const requestConflictState: GenerationClientState = {
      phase: "request_conflict",
      code: "idempotency_payload_mismatch",
      message: "前回と異なる内容で再送できません。もう一度操作してください",
      effect: "none",
    };
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={requestConflictState} userId={USER_ID} onClear={onClear} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "同じ操作を続けられませんでした" })).toBeVisible();
    expect(screen.getByText(/再送できません/u)).toBeVisible();
    expect(screen.queryByText("成功回数には含まれません")).toBeNull();
    expect(screen.queryByText("献立は完成していないので、作成回数は減っていません")).toBeNull();
    expect(await screen.findByRole("region", { name: "今日あと何回作れるか" })).toBeVisible();
    screen.getByRole("button", { name: "最初からやり直す" }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("hides not-consumed notice when success quota was consumed", () => {
    const consumedFailed: GenerationClientState = {
      phase: "failed",
      data: {
        ...failedData,
        error: {
          code: "invalid_ai_response",
          message:
            "献立を正しく確認できませんでした。続けて試すと本日の受付上限に達しやすくなります。",
          retryable: true,
        },
        quota: { ...quota, consumed: true },
      },
      effect: "none",
    };
    render(<GenerationStatusPanel state={consumedFailed} />);
    expect(screen.queryByText("献立は完成していないので、作成回数は減っていません")).toBeNull();
    expect(screen.queryByText("成功回数には含まれません")).toBeNull();
  });

  it("G-R2: hides not-consumed notice when attempt-disclosed fail code even if success unconsumed", () => {
    // markSent 後 timeout: success 未減 + attempt 消費開示が並立すると「回数は減っていない」優先で溶融する
    const timeoutFailed: GenerationClientState = {
      phase: "failed",
      data: {
        ...failedData,
        error: {
          code: "generation_timeout",
          message:
            "作成に時間がかかりました。受付後に完了できなかったため、続けて試すと本日の受付上限に達しやすくなります。",
          retryable: true,
        },
        quota: { ...quota, consumed: false },
      },
      effect: "none",
    };
    render(<GenerationStatusPanel state={timeoutFailed} />);
    expect(screen.getByText(/受付上限に達しやすくなります/u)).toBeVisible();
    expect(screen.queryByText("献立は完成していないので、作成回数は減っていません")).toBeNull();
  });

  it("shows a status message while checking saved progress", () => {
    render(<GenerationStatusPanel state={{ phase: "checking", effect: "status" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("保存した作成状況を確認しています");
  });

  // G3: 別タブ reconcile が pending を消すと retryStatus の isCurrent が落ち、
  // phase が checking のまま固着する。スピナーだけでは画面内破棄導線が無い。
  it("exposes RecoveryLinks while checking so a stuck spinner can be abandoned (G3)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <GenerationStatusPanel state={{ phase: "checking", effect: "status" }} onClear={onClear} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("保存した作成状況を確認しています");
    expect(screen.getByRole("button", { name: "条件を直してやり直す" })).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toBeVisible();
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toBeVisible();
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("does not abandon a checking run when confirm is cancelled (G3)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <GenerationStatusPanel state={{ phase: "checking", effect: "status" }} onClear={onClear} />,
    );
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // G-R1: 別タブ reconcile が POST 応答前に pending を消すと isCurrent が落ち、
  // phase が submitting のまま固着する。進捗スピナーだけでは画面内破棄導線が無い。
  it("exposes RecoveryLinks while submitting so a stuck spinner can be abandoned (G-R1)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} onClear={onClear} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("条件を確認しています");
    expect(screen.getByRole("button", { name: "条件を直してやり直す" })).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toBeVisible();
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toBeVisible();
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("does not abandon a submitting run when confirm is cancelled (G-R1)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} onClear={onClear} />,
    );
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // G-R1: succeeded を積んだあと navigate の isCurrent が pending 消失で落ちると
  // 「献立を表示しています」のまま /menus/:id へ行かない。破棄導線が無いと固着する。
  it("exposes RecoveryLinks while succeeded so a stuck navigate can be abandoned (G-R1)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const succeededState: GenerationClientState = {
      phase: "succeeded",
      data: {
        status: "succeeded",
        idempotencyKey: KEY,
        requestId: REQUEST_ID,
        menuId: "30000000-0000-4000-8000-000000000001",
        completedAt: "2026-07-11T00:00:01.000Z",
        quota: {
          consumed: true,
          remaining: 1,
          userDailyLimit: 3,
          limitKind: "user",
          retryAt: null,
        },
      },
      effect: "navigate",
    };
    render(<GenerationStatusPanel state={succeededState} onClear={onClear} />);
    expect(screen.getByRole("status")).toHaveTextContent("献立を表示しています");
    expect(screen.getByRole("button", { name: "条件を直してやり直す" })).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toBeVisible();
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toBeVisible();
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("does not abandon a succeeded run when confirm is cancelled (G-R1)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const succeededState: GenerationClientState = {
      phase: "succeeded",
      data: {
        status: "succeeded",
        idempotencyKey: KEY,
        requestId: REQUEST_ID,
        menuId: "30000000-0000-4000-8000-000000000001",
        completedAt: "2026-07-11T00:00:01.000Z",
        quota: {
          consumed: true,
          remaining: 1,
          userDailyLimit: 3,
          limitKind: "user",
          retryAt: null,
        },
      },
      effect: "navigate",
    };
    render(<GenerationStatusPanel state={succeededState} onClear={onClear} />);
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows sticky progress stages while submitting", () => {
    render(<GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("条件を確認しています");
    expect(status).toHaveAttribute("data-progress-stage", "0");

    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 10_000));
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("献立案を用意しています");
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
  });

  it("exposes the total stage count so progress can be rendered", () => {
    // 段階の総数は GENERATION_PROGRESS_STAGES の length（5）と一致し続ける必要がある。
    // 表示側が独自の定数を持つと段階表の変更に追随できなくなる。
    expect(GENERATION_PROGRESS_STAGES).toHaveLength(5);
  });

  it("renders a progress meter reflecting the current stage while submitting", () => {
    // data-progress-stage は 0 始まりの index のまま status に残す。
    // progressbar の aria-valuenow は人間向けに 1 始まり（index + 1）。
    render(<GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />);
    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 10_000));
      vi.advanceTimersByTime(1_000);
    });
    const meter = screen.getByRole("progressbar", { name: "献立作成の進み具合" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemin", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    // status の data-progress-stage 契約は 0-based のまま
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
  });

  it("renders a progress meter while processing (same contract as submitting)", () => {
    // 長時間待ちの本体は processing。submitting だけの契約だと削除退行が緑のまま残る。
    const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
      status: "processing",
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      startedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      quota,
    };
    render(
      <GenerationStatusPanel
        state={{ phase: "processing", data: processingData, effect: "poll" }}
      />,
    );
    const meter = screen.getByRole("progressbar", { name: "献立作成の進み具合" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter).toHaveAttribute("aria-valuemin", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
  });

  it.each([
    [0, 0, "条件を確認しています"],
    [10_000, 2, "献立案を用意しています"],
    [35_000, 3, "組み合わせと段取りを整えています"],
    [60_000, 4, "仕上げの確認をしています"],
  ] as const)(
    "processing startedAt NOW-%s → stage %s synchronously (V-I3)",
    (agoMs, stage, message) => {
      const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
        status: "processing",
        idempotencyKey: KEY,
        requestId: REQUEST_ID,
        startedAt: new Date(NOW.getTime() - agoMs).toISOString(),
        quota,
      };
      render(
        <GenerationStatusPanel
          state={{ phase: "processing", data: processingData, effect: "poll" }}
        />,
      );
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(message);
      expect(status).toHaveAttribute("data-progress-stage", String(stage));
      expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    },
  );

  it("keeps progress stage when phase moves submitting → processing (V-I2)", () => {
    const { rerender } = render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
    );
    act(() => {
      vi.setSystemTime(new Date(NOW.getTime() + 10_000));
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");

    const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
      status: "processing",
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      // サーバ開始が「いま」に見えるアンカー → 計算上は stage0 だが L1 で stage2 を維持
      startedAt: new Date(NOW.getTime() + 10_000).toISOString(),
      quota,
    };
    rerender(
      <GenerationStatusPanel
        state={{ phase: "processing", data: processingData, effect: "poll" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-progress-stage", "2");
    expect(screen.getByRole("status")).toHaveTextContent("献立案を用意しています");
  });

  it("clears progress interval on unmount (V-I3)", () => {
    const { unmount } = render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // 実装レビュー D-M1: 終端/checking へ落ちたときも interval が残らない
  it("clears progress interval when leaving submitting for checking", () => {
    const { rerender } = render(
      <GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />,
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    rerender(<GenerationStatusPanel state={{ phase: "checking", effect: "status" }} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a resumable message while processing", () => {
    const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
      status: "processing",
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      startedAt: "2026-07-11T00:00:00.000Z",
      quota,
    };
    render(
      <GenerationStatusPanel
        state={{ phase: "processing", data: processingData, effect: "poll" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    expect(
      screen.getByText("この画面を閉じても、同じ作成IDであとから確認できます。"),
    ).toBeVisible();
  });

  it("lets the user abandon a processing run via onClear after confirm (G2)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
      status: "processing",
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      startedAt: "2026-07-11T00:00:00.000Z",
      quota,
    };
    render(
      <GenerationStatusPanel
        state={{ phase: "processing", data: processingData, effect: "poll" }}
        onClear={onClear}
      />,
    );
    expect(screen.getByText(/破棄すると、しばらく新しい作成を始められない/)).toBeVisible();
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("does not abandon a processing run when confirm is cancelled (G2)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const processingData: Extract<GenerationStatusData, { status: "processing" }> = {
      status: "processing",
      idempotencyKey: KEY,
      requestId: REQUEST_ID,
      startedAt: "2026-07-11T00:00:00.000Z",
      quota,
    };
    render(
      <GenerationStatusPanel
        state={{ phase: "processing", data: processingData, effect: "poll" }}
        onClear={onClear}
      />,
    );
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows an offline message while waiting for connectivity", () => {
    render(
      <GenerationStatusPanel
        state={{ phase: "offline", previous: failedState, effect: "wait_online" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "通信を確認しています" })).toBeVisible();
  });

  it("lets the user abandon an offline run via onClear after confirm (G2)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <GenerationStatusPanel
        state={{ phase: "offline", previous: failedState, effect: "wait_online" }}
        onClear={onClear}
      />,
    );
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("does not abandon an offline run when confirm is cancelled (G2)", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <GenerationStatusPanel
        state={{ phase: "offline", previous: failedState, effect: "wait_online" }}
        onClear={onClear}
      />,
    );
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not require confirm on terminal failed RecoveryLinks", () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GenerationStatusPanel state={failedState} onClear={onClear} />);
    screen.getByRole("button", { name: "条件を直してやり直す" }).click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });
});
