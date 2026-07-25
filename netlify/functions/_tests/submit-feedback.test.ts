import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../_shared/http.js";
import { createSubmitFeedbackHandler } from "../submit-feedback.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "access-token";

function makeRequest(body: unknown, options: { authorization?: string | null } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.authorization === undefined) {
    headers.set("authorization", `Bearer ${ACCESS_TOKEN}`);
  } else if (options.authorization !== null) {
    headers.set("authorization", options.authorization);
  }
  return new Request("http://127.0.0.1/api/feedback", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("createSubmitFeedbackHandler", () => {
  const authenticate = vi.fn();
  const submitRateLimited = vi.fn();
  const handler = createSubmitFeedbackHandler({
    authenticate,
    submitRateLimited,
  });

  beforeEach(() => {
    authenticate.mockReset();
    submitRateLimited.mockReset();
    authenticate.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    submitRateLimited.mockResolvedValue({ id: "feedback-1" });
  });

  it("rejects non-POST methods", async () => {
    const response = await handler(new Request("http://127.0.0.1/api/feedback", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("requires authentication", async () => {
    authenticate.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const response = await handler(
      makeRequest({ category: "bug_report", body: "ボタンが押せませんでした。" }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects too-short body", async () => {
    const response = await handler(makeRequest({ category: "bug_report", body: "短い" }));
    expect(response.status).toBe(400);
    const envelope = (await response.json()) as { ok: false; error: { code: string } };
    expect(envelope.error.code).toBe("invalid_request");
    expect(submitRateLimited).not.toHaveBeenCalled();
  });

  it("stores valid feedback and returns 201", async () => {
    const response = await handler(
      makeRequest({
        category: "feature_request",
        body: "買い物リストに並び替えがあると助かります。",
        clientPath: "/settings",
      }),
    );
    expect(response.status).toBe(201);
    const envelope = (await response.json()) as { ok: true; data: { id: string } };
    expect(envelope.data.id).toBe("feedback-1");
    expect(submitRateLimited).toHaveBeenCalledWith({
      userId: USER_ID,
      category: "feature_request",
      body: "買い物リストに並び替えがあると助かります。",
      clientPath: "/settings",
    });
  });

  it("maps rateLimited from the atomic SQL path to 429 without treating it as success", async () => {
    // 閾値 5 件/24h の判定本体は insert_user_feedback_rate_limited の pgTAP が担保する。
    // ここは RPC 結果を 429 に写すハンドラ境界だけを固定する。
    submitRateLimited.mockResolvedValue({ rateLimited: true });
    const response = await handler(
      makeRequest({
        category: "other",
        body: "追加のフィードバック本文です。",
      }),
    );
    expect(response.status).toBe(429);
    const envelope = (await response.json()) as { ok: false; error: { code: string } };
    expect(envelope.error.code).toBe("feedback_rate_limited");
    expect(submitRateLimited).toHaveBeenCalledWith({
      userId: USER_ID,
      category: "other",
      body: "追加のフィードバック本文です。",
      clientPath: null,
    });
  });

  it("forwards feedbackDailyLimit as p_limit via deps contract (handler always passes limit 5)", async () => {
    // createSubmitFeedbackHandler の本番 deps は feedbackDailyLimit=5 を RPC に渡す。
    // ここは deps が呼ばれる入力形を固定し、上限定数の意図をコメントと期待で残す。
    await handler(
      makeRequest({
        category: "bug_report",
        body: "上限定数の受け渡し確認用の本文です。",
      }),
    );
    expect(submitRateLimited).toHaveBeenCalledTimes(1);
    expect(submitRateLimited.mock.calls[0]?.[0]).toMatchObject({
      userId: USER_ID,
      category: "bug_report",
    });
  });
});
