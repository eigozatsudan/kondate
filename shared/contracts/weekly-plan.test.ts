import { describe, expect, it } from "vitest";
import {
  weeklyPlanRequestSchema,
  weeklyPlanResultSchema,
  weeklyPlanIssueMessages,
  weeklyPlanFailureCodeMap,
  WEEKLY_PLAN_UI_ENABLED,
} from "./weekly-plan.js";
import { issueMessages } from "./generation.js";

describe("weeklyPlanRequestSchema", () => {
  const base = {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
    cuisineGenre: "japanese" as const,
    budgetPreference: null,
    noveltyPreference: null,
  };

  it("rejects unknown keys (strict)", () => {
    expect(weeklyPlanRequestSchema.safeParse({ ...base, extra: "x" }).success).toBe(false);
  });

  it("rejects zero target members", () => {
    expect(weeklyPlanRequestSchema.safeParse({ ...base, targetMemberIds: [] }).success).toBe(false);
  });

  it("rejects an out-of-enum cuisineGenre", () => {
    expect(weeklyPlanRequestSchema.safeParse({ ...base, cuisineGenre: "korean" }).success).toBe(
      false,
    );
  });

  it("accepts the base shape", () => {
    expect(weeklyPlanRequestSchema.safeParse(base).success).toBe(true);
  });
});

describe("weeklyPlanResultSchema", () => {
  function sampleDay(dayIndex: number) {
    return {
      dayIndex,
      label: `day${String(dayIndex)}`,
      mainName: "主菜",
      sideName: null,
      ingredients: ["食材"],
      notes: null,
    };
  }

  const baseResult = {
    weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    weekStartJst: "2026-09-07",
    days: Array.from({ length: 7 }, (_, index) => sampleDay(index + 1)),
    targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
    cuisineGenre: "japanese" as const,
    partialHousehold: false,
    staleSafety: false,
  };

  it("accepts the base shape", () => {
    expect(weeklyPlanResultSchema.safeParse(baseResult).success).toBe(true);
  });

  it("requires exactly 7 unique days", () => {
    expect(
      weeklyPlanResultSchema.safeParse({ ...baseResult, days: baseResult.days.slice(0, 6) })
        .success,
    ).toBe(false);
  });

  it("rejects a safetyFingerprint key (strict, never echoed)", () => {
    expect(
      weeklyPlanResultSchema.safeParse({ ...baseResult, safetyFingerprint: "x".repeat(64) })
        .success,
    ).toBe(false);
  });

  it("requires a JST YYYY-MM-DD weekStartJst", () => {
    expect(
      weeklyPlanResultSchema.safeParse({ ...baseResult, weekStartJst: "2026/09/07" }).success,
    ).toBe(false);
  });
});

describe("weeklyPlanIssueMessages", () => {
  it("mentions the shared quota with the flyer feature", () => {
    expect(weeklyPlanIssueMessages.weekly_plan_weekly_limit).toContain("チラシ献立と共通");
  });

  it("locks the exact Japanese copy for every issue code", () => {
    expect(weeklyPlanIssueMessages.weekly_plan_requires_plus).toBe(
      "今週の献立づくりは Plus の機能です。",
    );
    expect(weeklyPlanIssueMessages.weekly_plan_unsatisfiable_member).toBe(
      "この家族向けの週献立は作れません。日ごとの献立作成をご利用ください。",
    );
    expect(weeklyPlanIssueMessages.weekly_plan_invalid_ai_response).toBe(
      "週献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。",
    );
    expect(weeklyPlanIssueMessages.weekly_plan_persist_failed).toBe(
      "週献立を保存できませんでした。同じ条件でもう一度お試しください。",
    );
  });
});

describe("weeklyPlanFailureCodeMap", () => {
  it("maps SQL failure codes to weekly-plan-specific issue codes", () => {
    expect(weeklyPlanFailureCodeMap.flyer_weekly_limit).toBe("weekly_plan_weekly_limit");
    expect(weeklyPlanFailureCodeMap.flyer_weekly_try_limit).toBe("weekly_plan_try_limit");
  });

  it("has no entry for codes that should fall back to the existing issueMessages", () => {
    // weeklyPlanFailureCodeMap は `as const satisfies` でリテラル 2 キーに型付くため、
    // 未知キーへのドットアクセスは TS2339 になる。キー集合で検証する
    // （マップ側を Partial<Record<string, …>> に緩めると Task 7 の
    // `mapKey in map ? map[mapKey] : code` が undefined を含むようになるので緩めない）。
    expect(Object.keys(weeklyPlanFailureCodeMap)).not.toContain("user_attempt_limit");
    expect(issueMessages.user_attempt_limit).toBeDefined();
  });
});

describe("WEEKLY_PLAN_UI_ENABLED", () => {
  it("is a boolean flag", () => {
    expect(typeof WEEKLY_PLAN_UI_ENABLED).toBe("boolean");
  });
});
