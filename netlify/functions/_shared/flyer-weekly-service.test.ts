import { describe, expect, it, vi } from "vitest";
import { flyerWeeklyIssueMessages } from "../../../shared/contracts/flyer-weekly.js";
import { runFlyerWeeklyWithReserveStub } from "./flyer-weekly-service.js";

describe("flyer-weekly-service", () => {
  it("does not call OpenRouter when reserve returns flyer_weekly_limit", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: null,
        idempotency_key: "k",
        status: "failed",
        failure_code: "flyer_weekly_limit",
        replayed: false,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.openRouterCalls).toBe(0);
    expect(result.errorCode).toBe("flyer_weekly_limit");
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("returns flyer_requires_plus without reserve when not plus entitled", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
      },
      openRouterSender,
      plusEntitled: false,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("flyer_requires_plus");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
    expect(flyerWeeklyIssueMessages.flyer_requires_plus).toContain("Plus");
  });
});
