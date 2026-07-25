import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackSection } from "./feedback-section";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

describe("FeedbackSection", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    fetchMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("validates minimum length before calling the API", async () => {
    const user = userEvent.setup();
    render(<FeedbackSection />);
    await user.type(screen.getByLabelText("内容（10〜2000文字）"), "短い");
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(screen.getByRole("alert")).toHaveTextContent("もう少し詳しく書いてください");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits feature feedback and shows a success status", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: "feedback-1" } }),
    });
    render(<FeedbackSection />);
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

  it("shows rate-limit copy from the API", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        error: { code: "feedback_rate_limited", message: "rate" },
      }),
    });
    render(<FeedbackSection />);
    await user.type(
      screen.getByLabelText("内容（10〜2000文字）"),
      "もう一度送りたいフィードバック本文です。",
    );
    await user.click(screen.getByRole("button", { name: "送信する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("送信回数の上限に達しました");
  });
});
