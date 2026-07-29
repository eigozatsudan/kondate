import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";
import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";
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
    globalAvailable: true,
    retryAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GenerationStatusPanel", () => {
  it("shows simplified not-consumed notice and success remaining after failure", () => {
    render(<GenerationStatusPanel state={failedState} />);
    expect(screen.getByText("献立は完成していないので、作成回数は減っていません")).toBeVisible();
    expect(screen.queryByText("成功回数には含まれません")).not.toBeInTheDocument();
    expect(screen.getByText("無料版は本日あと2回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.getByText(/^再開:/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toHaveAttribute(
      "href",
      "/emergency-menus",
    );
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toHaveAttribute(
      "href",
      "/history",
    );
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
    expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/settings");
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
      await screen.findByText("本日の作成回数を確認できません。再読み込みしてください"),
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
          message: "献立を正しく確認できませんでした。",
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

  it("shows a status message while checking saved progress", () => {
    render(<GenerationStatusPanel state={{ phase: "checking", effect: "status" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("保存した作成状況を確認しています");
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

  it("shows an offline message while waiting for connectivity", () => {
    render(
      <GenerationStatusPanel
        state={{ phase: "offline", previous: failedState, effect: "wait_online" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "通信を確認しています" })).toBeVisible();
  });
});
