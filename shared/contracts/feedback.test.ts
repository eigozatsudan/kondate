import { describe, expect, it } from "vitest";
import { feedbackClientPathSchema, submitFeedbackRequestSchema } from "./feedback.js";

describe("feedbackClientPathSchema (AP4)", () => {
  it("accepts app-relative pathnames", () => {
    expect(feedbackClientPathSchema.parse("/settings")).toBe("/settings");
    expect(feedbackClientPathSchema.parse("/history/abc-123")).toBe("/history/abc-123");
    expect(feedbackClientPathSchema.parse("/")).toBe("/");
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
