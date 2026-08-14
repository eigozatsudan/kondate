import { describe, expect, it } from "vitest";
import {
  feedbackClientPathSchema,
  feedbackEnvelopeSchema,
  sanitizeFeedbackClientPath,
  submitFeedbackRequestSchema,
} from "./feedback.js";

describe("feedbackClientPathSchema (AP4)", () => {
  it("accepts app-relative pathnames", () => {
    expect(feedbackClientPathSchema.parse("/settings")).toBe("/settings");
    expect(feedbackClientPathSchema.parse("/history/abc-123")).toBe("/history/abc-123");
    expect(feedbackClientPathSchema.parse("/")).toBe("/");
  });

  it("AP11: folds UUID menu segments out of clientPath", () => {
    expect(sanitizeFeedbackClientPath("/history/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/history",
    );
    expect(feedbackClientPathSchema.parse("/history/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/history",
    );
    expect(feedbackClientPathSchema.parse("/menus/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/menus",
    );
    expect(feedbackClientPathSchema.parse("/history/abc-123")).toBe("/history/abc-123");
  });

  it("rejects schemes, hosts, query, spaces, and free-form lures", () => {
    for (const bad of [
      "https://phish.example/x",
      "//evil",
      "/settings?q=1",
      "/path with space",
      "settings",
      "user@example.com",
      "",
    ]) {
      expect(feedbackClientPathSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("AP9: rejects dot-only segments (., .., ....)", () => {
    for (const bad of ["/a/../b", "/..", "/.", "/....", "/foo/./bar", "/a/..../b"]) {
      expect(feedbackClientPathSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("submitFeedbackRequestSchema", () => {
  it("accepts valid body with optional safe clientPath", () => {
    const parsed = submitFeedbackRequestSchema.parse({
      category: "bug_report",
      body: "買い物リストで順番を変えたいです",
      clientPath: "/settings",
    });
    expect(parsed.clientPath).toBe("/settings");
  });

  it("rejects phishing-style clientPath", () => {
    const result = submitFeedbackRequestSchema.safeParse({
      category: "other",
      body: "もう少し詳しく書きますね",
      clientPath: "https://phish.example/x",
    });
    expect(result.success).toBe(false);
  });
});

describe("feedbackEnvelopeSchema (S9)", () => {
  it("accepts closed error codes and rejects huge/open messages", () => {
    expect(
      feedbackEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "rate_limited", message: "しばらくしてから再度お試しください" },
      }).success,
    ).toBe(true);
    expect(
      feedbackEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "RateLimited", message: "ng" },
      }).success,
    ).toBe(false);
    expect(
      feedbackEnvelopeSchema.safeParse({
        ok: false,
        error: { code: "request_failed", message: "x".repeat(501) },
      }).success,
    ).toBe(false);
  });
});
