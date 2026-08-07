import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_DAILY_LIMIT, FEEDBACK_RATE_WINDOW_HOURS } from "@shared/contracts/feedback";
import {
  FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY,
  FEEDBACK_POST_CLIENT_TIMEOUT_MS,
  FeedbackSection,
} from "./feedback-section";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

async function expandFeedback(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "改善要望・不具合を送る" }));
  expect(screen.getByLabelText("内容（10〜2000文字）")).toBeVisible();
}

describe("FeedbackSection", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    fetchMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token");
    sessionStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("starts collapsed and hides the form until expanded", () => {
    render(<FeedbackSection />);
    expect(screen.getByRole("heading", { name: "フィードバック" })).toBeVisible();
    expect(screen.getByRole("button", { name: "改善要望・不具合を送る" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByLabelText("内容（10〜2000文字）")).not.toBeInTheDocument();
  });

  it("validates minimum length before calling the API", async () => {
    const user = userEvent.setup();
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), "短い");
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(screen.getByRole("alert")).toHaveTextContent("もう少し詳しく書いてください");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits feature feedback and shows a success status", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: { id: "feedback-1" } }),
    });
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.click(screen.getByRole("radio", { name: "不具合の報告" }));
    await user.type(
      screen.getByLabelText("内容（10〜2000文字）"),
      "設定画面の保存ボタンが反応しないことがあります。",
    );
    await user.click(screen.getByRole("button", { name: "送信する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/feedback",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token",
          }) as HeadersInit,
        }),
      );
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "ありがとうございます。フィードバックを受け付けました",
    );
    expect(screen.getByLabelText("内容（10〜2000文字）")).toHaveValue("");
  });

  it("can collapse again with 閉じる", async () => {
    const user = userEvent.setup();
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByLabelText("内容（10〜2000文字）")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "改善要望・不具合を送る" })).toBeVisible();
  });

  it("shows rate-limit copy from the API", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          ok: false,
          error: { code: "feedback_rate_limited", message: "rate" },
        }),
    });
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(
      screen.getByLabelText("内容（10〜2000文字）"),
      "もう一度送りたいフィードバック本文です。",
    );
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信回数の上限に達しました");
  });

  it("AP10: blocks same-body resubmit after ambiguous response loss", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    render(<FeedbackSection />);
    await expandFeedback(user);
    const text = "応答欠落後に同じ本文を再送したくない内容です。";
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同じ内容を再送すると重複");
    // 二重 insert 防止: fetch は増えない
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AP10: allows retry after definitive server error (not ambiguous)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            ok: false,
            error: { code: "feedback_rate_limited", message: "rate" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { id: "feedback-2" } }),
      });
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(
      screen.getByLabelText("内容（10〜2000文字）"),
      "サーバ明示拒否後は再送を許可する本文です。",
    );
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信回数の上限に達しました");

    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("status")).toHaveTextContent("フィードバックを受け付けました");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("AP5: persists ambiguous fingerprint across remount via sessionStorage", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    const text = "リロード後も同じ本文の再送を抑止する内容です。";
    const { unmount } = render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    expect(sessionStorage.getItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY)).toContain(text);

    unmount();
    fetchMock.mockClear();
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同じ内容を再送すると重複");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AP6: fetch never-settle is timed out so pending clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchMock.mockReturnValue(new Promise(() => undefined));
      render(<FeedbackSection />);
      await expandFeedback(user);
      await user.type(
        screen.getByLabelText("内容（10〜2000文字）"),
        "送信が返らないとき閉じられるようにする本文です。",
      );
      await user.click(screen.getByRole("button", { name: "送信する" }));
      expect(screen.getByRole("button", { name: "送信しています…" })).toBeDisabled();

      await vi.advanceTimersByTimeAsync(FEEDBACK_POST_CLIENT_TIMEOUT_MS + 50);

      expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
      expect(screen.getByRole("button", { name: "閉じる" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "送信する" })).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP9: shows daily limit in the expanded form copy", async () => {
    const user = userEvent.setup();
    render(<FeedbackSection />);
    await expandFeedback(user);
    expect(
      screen.getByText(
        new RegExp(
          `${String(FEEDBACK_RATE_WINDOW_HOURS)}時間あたり${String(FEEDBACK_DAILY_LIMIT)}件`,
        ),
      ),
    ).toBeVisible();
  });
});
