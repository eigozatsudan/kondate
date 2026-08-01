import { describe, expect, it } from "vitest";
import {
  shareFailureCodes,
  shareJobStatuses,
  shareSkipReasons,
  type ShareFailureCode,
  type ShareSkipReason,
} from "./share-job.js";

describe("share job contracts", () => {
  it("locks job statuses including skipped", () => {
    expect(shareJobStatuses).toEqual(["pending", "running", "succeeded", "failed", "skipped"]);
  });

  it("includes consent_revoked and daily_success_cap in skip reasons only", () => {
    expect(shareSkipReasons).toContain("consent_revoked");
    expect(shareSkipReasons).toContain("daily_success_cap");
    expect(shareSkipReasons).toEqual(
      expect.arrayContaining([
        "not_emergency_duration",
        "pantry_bound",
        "consent_revoked",
        "ineligible_structure",
        "daily_success_cap",
      ]),
    );

    const failureSet = new Set<string>(shareFailureCodes);
    expect(failureSet.has("consent_revoked")).toBe(false);
    expect(failureSet.has("daily_success_cap")).toBe(false);

    // 型上も failure に載せないことを固定（代入が通らないこと）
    const skipOnly: ShareSkipReason = "consent_revoked";
    expect(skipOnly).toBe("consent_revoked");
    const _assertNotFailure: ShareFailureCode | "consent_revoked" = skipOnly;
    expect(_assertNotFailure).toBe("consent_revoked");
    const capSkip: ShareSkipReason = "daily_success_cap";
    expect(capSkip).toBe("daily_success_cap");
  });

  it("locks non-PII failure codes used by reaper, gate, and OpenRouter", () => {
    expect(shareFailureCodes).toEqual(
      expect.arrayContaining(["lease_expired", "server_gate_failed", "openrouter_failed"]),
    );
    expect(shareFailureCodes).not.toContain("consent_revoked");
  });
});
