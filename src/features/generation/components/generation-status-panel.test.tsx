import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";
import { getNextJstMidnight } from "@shared/time/jst";
import type { GenerationClientState } from "../model/generation-machine";
import { GenerationStatusPanel } from "./generation-status-panel";

const NOW = new Date("2026-07-20T05:00:00.000Z");
const KEY = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const quota = {
  consumed: false,
  remaining: 4,
  userDailyLimit: 5,
  limitKind: "user",
  retryAt: getNextJstMidnight(NOW).toISOString(),
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
