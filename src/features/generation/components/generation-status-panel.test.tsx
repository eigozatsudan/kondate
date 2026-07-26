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
  remaining: 4,
  userDailyLimit: 5,
  limitKind: "user",
  retryAt: serverRetryAt,
} as const;
const failedData: Extract<GenerationStatusData, { status: "failed" }> = {
  status: "failed",
  idempotencyKey: KEY,
  requestId: REQUEST_ID,
  error: { code: "user_daily_limit", message: "本日の作成回数の上限に達しました", retryable: true },
  completedAt: "2026-07-11T00:00:01.000Z",
  quota,
};
const failedState: GenerationClientState = { phase: "failed", data: failedData, effect: "none" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getUsageTodayMock.mockResolvedValue({
    success: { consumed: 1, limit: 5, remaining: 4 },
    attempts: { sent: 0, limit: 12, remaining: 12 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GenerationStatusPanel", () => {
  it("shows returned quota and Japan retry time after failure", () => {
    render(<GenerationStatusPanel state={failedState} />);
    expect(screen.getByText("成功回数には含まれません")).toBeVisible();
    expect(screen.getByText("成功回数：本日あと4回")).toBeVisible();
    expect(screen.getByText(/明日0:00/)).toBeVisible();
    expect(screen.getByRole("link", { name: "15分緊急献立を見る" })).toHaveAttribute(
      "href",
      "/emergency-menus",
    );
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toHaveAttribute(
      "href",
      "/history",
    );
  });

  it("hides emergency recovery link for idea target mode", () => {
    render(<GenerationStatusPanel state={failedState} targetMode="idea" />);
    expect(screen.queryByRole("link", { name: "15分緊急献立を見る" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "作った献立を見る" })).toBeInTheDocument();
  });

  it("shows how many generations remain today and the app-wide status", async () => {
    vi.useRealTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GenerationStatusPanel state={failedState} userId={USER_ID} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("region", { name: "今日あと何回作れるか" })).toBeVisible();
    expect(screen.getByText("アプリ全体：作成できます")).toBeVisible();
  });

  it("shows request_conflict copy and fresh-start without success-count claim", async () => {
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
    expect(screen.getByText(/再送できません/)).toBeVisible();
    expect(screen.queryByText("成功回数には含まれません")).toBeNull();
    expect(await screen.findByRole("region", { name: "今日あと何回作れるか" })).toBeVisible();
    screen.getByRole("button", { name: "最初からやり直す" }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
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
