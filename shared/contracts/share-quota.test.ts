import { describe, expect, it } from "vitest";
import { shareQuota } from "./share-quota.js";

describe("shareQuota", () => {
  it("locks lottery, per-user, and app-wide share AI caps", () => {
    expect(shareQuota.lotteryPercent).toBe(20);
    expect(shareQuota.perUserDailySuccessCap).toBe(1);
    expect(shareQuota.perUserDailyAttemptCap).toBe(2);
    expect(shareQuota.appDailyAiSuccessCap).toBe(200);
    expect(shareQuota.appDailyAiCallCap).toBe(500);
  });

  it("locks job lease and emergency fetch bounds", () => {
    expect(shareQuota.jobLeaseMinutes).toBe(15);
    expect(shareQuota.emergencyMaxCandidates).toBe(5);
    expect(shareQuota.sharePoolFetchLimit).toBe(20);
  });

  it("exposes concurrent running caps as positive numbers", () => {
    expect(typeof shareQuota.maxGlobalRunning).toBe("number");
    expect(typeof shareQuota.maxPerUserRunning).toBe("number");
    expect(shareQuota.maxGlobalRunning).toBe(4);
    expect(shareQuota.maxPerUserRunning).toBe(1);
    expect(shareQuota.maxGlobalRunning).toBeGreaterThan(0);
    expect(shareQuota.maxPerUserRunning).toBeGreaterThan(0);
  });
});
