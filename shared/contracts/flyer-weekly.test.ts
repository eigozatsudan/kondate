import { describe, expect, it } from "vitest";
import {
  flyerWeeklyIssueMessages,
  FLYER_LOCKED_PREVIEW_COPY,
  weeklyFlyerMenuSchema,
  flyerWeeklyUsageSchema,
} from "./flyer-weekly.js";
import { planQuota } from "./plan-quota.js";

const sampleDays = Array.from({ length: 7 }, (_, i) => ({
  dayIndex: i + 1,
  label: `曜日${String(i + 1)}`,
  mainName: `主菜${String(i + 1)}`,
  sideName: null,
  ingredients: ["にんじん", "ごはん"],
  notes: null,
}));

describe("weeklyFlyerMenuSchema", () => {
  it("accepts 7 unique dayIndex days", () => {
    const parsed = weeklyFlyerMenuSchema.parse({ days: sampleDays });
    expect(parsed.days).toHaveLength(7);
  });

  it("rejects non-unique dayIndex", () => {
    const bad = sampleDays.map((d, i) => (i === 6 ? { ...d, dayIndex: 1 } : d));
    expect(weeklyFlyerMenuSchema.safeParse({ days: bad }).success).toBe(false);
  });
});

describe("flyerWeeklyIssueMessages", () => {
  it("locks Japanese copy for flyer codes", () => {
    expect(flyerWeeklyIssueMessages.flyer_requires_plus).toBe(
      "チラシ写真から 1 週間の献立は Plus の機能です。",
    );
    expect(flyerWeeklyIssueMessages.flyer_weekly_limit).toBe(
      "今週のチラシ献立の作成上限に達しています。",
    );
    expect(flyerWeeklyIssueMessages.flyer_weekly_try_limit).toBe(
      "しばらくしてから再度お試しください。",
    );
    expect(flyerWeeklyIssueMessages.flyer_invalid_image).toBe(
      "画像を読み取れませんでした。別の写真でお試しください。",
    );
    expect(flyerWeeklyIssueMessages.flyer_unsupported_media).toBe(
      "対応している画像形式は JPEG / PNG / WebP です。",
    );
    expect(flyerWeeklyIssueMessages.flyer_invalid_ai_response).toBe(
      "週間献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。",
    );
    expect(FLYER_LOCKED_PREVIEW_COPY).toBe("チラシ写真から 1 週間の献立は Plus の機能です");
  });
});

describe("flyerWeeklyUsageSchema", () => {
  it("accepts balanced full remaining projection", () => {
    const fixture = {
      successConsumed: 0,
      successLimit: planQuota.flyerWeekly.successPerJstWeek,
      successRemaining: planQuota.flyerWeekly.successPerJstWeek,
      triesConsumed: 0,
      triesLimit: planQuota.flyerWeekly.triesPerJstWeek,
      triesRemaining: planQuota.flyerWeekly.triesPerJstWeek,
      weekStartJst: "2026-07-27",
    };
    expect(flyerWeeklyUsageSchema.parse(fixture)).toEqual(fixture);
  });
});
