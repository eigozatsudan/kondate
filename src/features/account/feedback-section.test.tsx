import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_DAILY_LIMIT, FEEDBACK_RATE_WINDOW_HOURS } from "@shared/contracts/feedback";
import {
  FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY,
  FEEDBACK_POST_CLIENT_TIMEOUT_MS,
  FeedbackSection,
  feedbackAmbiguousFingerprintStorageKey,
} from "./feedback-section";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());

const TEST_USER_ID = "10000000-0000-4000-8000-000000000001";
const stickyKey = feedbackAmbiguousFingerprintStorageKey(TEST_USER_ID)!;

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: useAuthMock,
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
    useAuthMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token");
    // AP17: sticky は user 束縛。既定 session を注入する。
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: TEST_USER_ID } },
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
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

  it("AP5/AP3: persists ambiguous fingerprint across remount via localStorage", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    const text = "リロード後も同じ本文の再送を抑止する内容です。";
    const { unmount } = render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    const stored = localStorage.getItem(stickyKey);
    // AP1: 平文本文は残さず SHA-256 hex のみ
    expect(stored).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored).not.toContain(text);
    // AP3: localStorage 権威（sessionStorage には書かない）
    expect(sessionStorage.getItem(stickyKey)).toBeNull();
    // AP17: レガシー非束縛キーには書かない
    expect(localStorage.getItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY)).toBeNull();

    unmount();
    fetchMock.mockClear();
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同じ内容を再送すると重複");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AP3: sticky fingerprint is shared across tabs via localStorage (no second POST)", async () => {
    // Tab A が ambiguous 後、別マウント（Tab B 相当）が同一 body を拒否する
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    const text = "別タブでも同じ本文の再送を抑止する内容です。";
    const { unmount: unmountTabA } = render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    expect(localStorage.getItem(stickyKey)).toMatch(/^[0-9a-f]{64}$/u);
    unmountTabA();
    fetchMock.mockClear();

    // Tab B: 新規 mount（in-memory ref は空、localStorage から読む）
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同じ内容を再送すると重複");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AP1: ambiguous fingerprint storage never contains free-form body plaintext", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    const piiBody = "氏名やメールを含む曖昧失敗本文です。再送抑止の指紋確認用。";
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), piiBody);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    const stored = localStorage.getItem(stickyKey);
    expect(stored).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored).not.toContain(piiBody);
    expect(stored).not.toContain("feature_request");
  });

  it("AP1: legacy plaintext fingerprint in localStorage is discarded on remount", async () => {
    const user = userEvent.setup();
    const piiBody = "旧形式で残った平文指紋は受理せず再送を許可する本文です。";
    localStorage.setItem(stickyKey, `feature_request\n${piiBody}`);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: { id: "feedback-legacy" } }),
    });
    render(<FeedbackSection />);
    // remount 相当の初回 read で旧平文を捨てる
    expect(localStorage.getItem(stickyKey)).toBeNull();
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), piiBody);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("status")).toHaveTextContent("フィードバックを受け付けました");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AP17: sticky fingerprint is user-bound (other user is not suppressed)", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    const text = "利用者Aの曖昧失敗本文は利用者Bの sticky にならない内容です。";
    const { unmount } = render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
    expect(localStorage.getItem(stickyKey)).toMatch(/^[0-9a-f]{64}$/u);
    unmount();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: { id: "feedback-b" } }),
    });
    const otherUserId = "20000000-0000-4000-8000-000000000099";
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: otherUserId } },
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    render(<FeedbackSection />);
    await expandFeedback(user);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), text);
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("status")).toHaveTextContent("フィードバックを受け付けました");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      // fingerprint の await 後に pending が立つ。フルスイート負荷下では同期 getBy がレースし得る
      expect(await screen.findByRole("button", { name: "送信しています…" })).toBeDisabled();

      await vi.advanceTimersByTimeAsync(FEEDBACK_POST_CLIENT_TIMEOUT_MS + 50);

      expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
      expect(screen.getByRole("button", { name: "閉じる" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "送信する" })).not.toBeDisabled();
      // AP9: abortable POST
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/feedback",
        expect.objectContaining({
          method: "POST",
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP9: headers-only body hang is timed out so pending clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => new Promise(() => undefined),
      });
      render(<FeedbackSection />);
      await expandFeedback(user);
      await user.type(
        screen.getByLabelText("内容（10〜2000文字）"),
        "本文が返らないとき閉じられるようにするフィードバックです。",
      );
      await user.click(screen.getByRole("button", { name: "送信する" }));
      // AP6 と同型。fingerprint await 後の pending を findBy で待ちフルスイート負荷のレースを避ける
      expect(await screen.findByRole("button", { name: "送信しています…" })).toBeDisabled();

      await vi.advanceTimersByTimeAsync(FEEDBACK_POST_CLIENT_TIMEOUT_MS + 50);

      expect(await screen.findByRole("alert")).toHaveTextContent("送信結果を確認できませんでした");
      expect(screen.getByRole("button", { name: "閉じる" })).not.toBeDisabled();
      expect(localStorage.getItem(stickyKey)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP9: shows daily limit and clientPath disclosure in the expanded form copy", async () => {
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
    // AP9: 画面パス添付の開示
    expect(screen.getByText(/いま開いている画面のパス/u)).toBeVisible();
  });
});
