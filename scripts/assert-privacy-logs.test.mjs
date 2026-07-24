import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPrivacyLogs } from "./assert-privacy-logs.mjs";

const goodLine = JSON.stringify({
  level: "info",
  code: "generation_succeeded",
  request_id: "req-1",
  duration_ms: 120,
  model_id: "mock/kondate-primary:free",
});

describe("assertPrivacyLogs", () => {
  it("passes on generation lines with snake_case fields", () => {
    const result = assertPrivacyLogs(`noise\n${goodLine}\n`);
    assert.equal(result.generationLines, 1);
  });

  it("fails on empty log", () => {
    assert.throws(() => assertPrivacyLogs(""), /privacy_log_empty/);
  });

  it("fails when generation lines are absent", () => {
    assert.throws(() => assertPrivacyLogs("hello world\n"), /privacy_log_no_generation/);
  });

  it("fails on synthetic test emails and camelCase keys", () => {
    assert.throws(
      () => assertPrivacyLogs(`${goodLine}\nuser@example.invalid\n`),
      /privacy_log_sensitive_present/,
    );
    assert.throws(
      () =>
        assertPrivacyLogs(
          JSON.stringify({
            level: "info",
            code: "generation_succeeded",
            requestId: "x",
            durationMs: 1,
            errorCode: "y",
          }),
        ),
      /privacy_log_missing_request_id|privacy_log_camel_case/,
    );
  });
});
