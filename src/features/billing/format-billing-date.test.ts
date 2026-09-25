import { describe, expect, it } from "vitest";
import { formatBillingDate, formatUpcomingBillingLastDay } from "./format-billing-date";

describe("formatBillingDate", () => {
  // JST の日付境界（UTC 15:00）の前後を両側で固定する
  it("keeps the previous JST day just before 15:00 UTC", () => {
    expect(formatBillingDate("2026-10-22T14:59:59.999Z")).toBe("2026年10月22日");
  });

  it("switches to the next JST day at 15:00 UTC", () => {
    expect(formatBillingDate("2026-10-22T15:00:00.000Z")).toBe("2026年10月23日");
  });

  it("returns null for null or an unparsable value", () => {
    expect(formatBillingDate(null)).toBeNull();
    expect(formatBillingDate("not-a-date")).toBeNull();
  });
});

describe("formatUpcomingBillingLastDay (final review B Minor 3)", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");

  it("names the previous JST day when the period ends exactly at JST midnight", () => {
    expect(formatUpcomingBillingLastDay("2026-10-22T15:00:00.000Z", now)).toBe("2026年10月22日");
  });

  it("names the same JST day when the period ends during that day", () => {
    // 10/23 12:00 JST に終わるなら、10/23 も途中まで使える
    expect(formatUpcomingBillingLastDay("2026-10-23T03:00:00.000Z", now)).toBe("2026年10月23日");
    // 10/23 0:00:00.001 JST（1ms だけ入る）も 10/23 の途中まで使える
    expect(formatUpcomingBillingLastDay("2026-10-22T15:00:00.001Z", now)).toBe("2026年10月23日");
  });

  it("returns null for past, equal, null, or unparsable values", () => {
    expect(formatUpcomingBillingLastDay("2026-09-24T00:00:00.000Z", now)).toBeNull();
    expect(formatUpcomingBillingLastDay("2026-09-20T15:00:00.000Z", now)).toBeNull();
    expect(formatUpcomingBillingLastDay(null, now)).toBeNull();
    expect(formatUpcomingBillingLastDay("not-a-date", now)).toBeNull();
  });
});
