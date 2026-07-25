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
  const insertFeedback = vi.fn();
  const countRecentFeedback = vi.fn();
  const handler = createSubmitFeedbackHandler({
    authenticate,
    insertFeedback,
    countRecentFeedback,
  });

  beforeEach(() => {
    authenticate.mockReset();
    insertFeedback.mockReset();
    countRecentFeedback.mockReset();
    authenticate.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    countRecentFeedback.mockResolvedValue(0);
    insertFeedback.mockResolvedValue({ id: "feedback-1" });
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
    expect(insertFeedback).not.toHaveBeenCalled();
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
    expect(insertFeedback).toHaveBeenCalledWith({
      userId: USER_ID,
      category: "feature_request",
      body: "買い物リストに並び替えがあると助かります。",
      clientPath: "/settings",
    });
  });

  it("rate-limits after five submissions in 24 hours", async () => {
    countRecentFeedback.mockResolvedValue(5);
    const response = await handler(
      makeRequest({
        category: "other",
        body: "追加のフィードバック本文です。",
      }),
    );
    expect(response.status).toBe(429);
    expect(insertFeedback).not.toHaveBeenCalled();
  });
});
