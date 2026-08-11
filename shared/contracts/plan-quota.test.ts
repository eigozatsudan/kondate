import { describe, expect, it } from "vitest";
import {
  GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX,
  planQuota,
  releaseQuota,
  type PlanCode,
} from "./plan-quota.js";

describe("planQuota", () => {
  it("locks Free and Plus product limits and defense ceilings", () => {
    expect(planQuota.free).toEqual({
      successPerDay: 3,
      attemptsPerDay: 6,
      shortWindowLimit: 4,
      shortWindowSeconds: 600,
    });
    expect(planQuota.plus).toEqual({
      successPerDay: 10,
      attemptsPerDay: 20,
      shortWindowLimit: 8,
      shortWindowSeconds: 600,
    });
    expect(planQuota.quality).toEqual({ perDay: 3, perMonth: 20 });
    expect(planQuota.flyerWeekly).toEqual({
      successPerJstWeek: 2,
      triesPerJstWeek: 6,
    });
    expect(planQuota.defense).toEqual({
      maxSuccessPerDay: 10,
      maxAttemptsPerDay: 20,
      maxShortWindow: 8,
      maxFlyerSuccessPerWeek: 2,
      maxFlyerTriesPerWeek: 6,
    });
  });

  it("exports a single product max for GLOBAL_DAILY_AI_LIMIT (ENV-only; SQL has no range gate)", async () => {
    // 運用値は ENV だけで上げられる。製品 max の正本は plan-quota-constants.mjs（S4）。
    const { GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX: fromMjs } =
      await import("./plan-quota-constants.mjs");
    expect(planQuota.globalDailyAiLimitProductMax).toBe(500);
    expect(GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX).toBe(planQuota.globalDailyAiLimitProductMax);
    expect(GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX).toBe(fromMjs);
    expect(GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX).toBeGreaterThanOrEqual(80);
  });

  it("keeps releaseQuota as Free alias for legacy imports", () => {
    expect(releaseQuota).toEqual({
      userDailySuccessLimit: 3,
      userDailyExternalCallLimit: 6,
      userShortWindowExternalCallLimit: 4,
      userShortWindowSeconds: 600,
    });
  });

  it("exposes PlanCode as free|plus only", () => {
    const codes: PlanCode[] = ["free", "plus"];
    expect(codes).toHaveLength(2);
  });
});
