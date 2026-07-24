import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPrivacyLogs } from "./assert-privacy-logs.mjs";

const goodLine = JSON.stringify({
  level: "info",
  code: "succeeded",
  request_id: "50000000-0000-4000-8000-000000000099",
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
            code: "succeeded",
            requestId: "x",
            durationMs: 1,
            errorCode: "y",
          }),
        ),
      /privacy_log_missing_request_id|privacy_log_camel_case/,
    );
  });

  it("allows UUID only inside request_id and fails bare UUID / memo / names / raw body", () => {
    // request_id 内の UUID は redacted 後に検査するため通過する
    assert.equal(assertPrivacyLogs(`${goodLine}\n`).generationLines, 1);
    assert.throws(
      () => assertPrivacyLogs(`${goodLine}\n10000000-0000-4000-8000-000000000001\n`),
      /privacy_log_sensitive_present/,
    );
    assert.throws(
      () => assertPrivacyLogs(`${goodLine}\n{"memo":"secret note"}\n`),
      /privacy_log_sensitive_present/,
    );
    assert.throws(
      () => assertPrivacyLogs(`${goodLine}\n山田 太郎さんが使いました\n`),
      /privacy_log_sensitive_present/,
    );
    assert.throws(
      () => assertPrivacyLogs(`${goodLine}\nopenrouter response body dump\n`),
      /privacy_log_sensitive_present/,
    );
  });

  it("does not count maintenance_cleanup as generation presence", () => {
    const maintenance = JSON.stringify({
      level: "info",
      code: "maintenance_cleanup",
      request_id: "req-m",
      duration_ms: 10,
    });
    assert.throws(() => assertPrivacyLogs(`${maintenance}\n`), /privacy_log_no_generation/);
  });

  it("rejects unexpected free-form fields on generation lines", () => {
    assert.throws(
      () =>
        assertPrivacyLogs(
          JSON.stringify({
            level: "info",
            code: "succeeded",
            request_id: "req-1",
            duration_ms: 1,
            extra_debug: "not allowlisted",
          }),
        ),
      /privacy_log_unexpected_field/,
    );
  });
});
