import { describe, expect, it } from "vitest";
import {
  formatBillingDate,
  formatBillingDateTime,
  formatUpcomingBillingDateTime,
} from "./format-billing-date";

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

// UX 残り R3 M-2（ユーザー決定）: 終了は日付と時刻（JST、24 時間表記の HH:MM）で示す
describe("formatBillingDateTime", () => {
  it("shows 00:00 on the JST day when the moment is exactly JST midnight", () => {
    expect(formatBillingDateTime("2026-10-22T15:00:00.000Z")).toBe("2026年10月23日 00:00");
  });

  it("shows the JST time of day in 24-hour HH:MM when the moment is during the day", () => {
    expect(formatBillingDateTime("2026-10-23T05:32:11.000Z")).toBe("2026年10月23日 14:32");
    expect(formatBillingDateTime("2026-10-23T00:05:00.000Z")).toBe("2026年10月23日 09:05");
  });

  it("uses the JST date and time across the year boundary", () => {
    expect(formatBillingDateTime("2026-12-31T14:59:00.000Z")).toBe("2026年12月31日 23:59");
    expect(formatBillingDateTime("2026-12-31T15:00:00.000Z")).toBe("2027年1月1日 00:00");
  });

  it("returns null for null or an unparsable value", () => {
    expect(formatBillingDateTime(null)).toBeNull();
    expect(formatBillingDateTime("not-a-date")).toBeNull();
  });
});

describe("formatUpcomingBillingDateTime", () => {
  const now = new Date("2026-09-24T00:00:00.000Z");

  it("formats an upcoming moment with its JST time", () => {
    expect(formatUpcomingBillingDateTime("2026-10-23T05:32:11.000Z", now)).toBe(
      "2026年10月23日 14:32",
    );
  });

  it("returns null for past, equal, null, or unparsable values", () => {
    expect(formatUpcomingBillingDateTime("2026-09-24T00:00:00.000Z", now)).toBeNull();
    expect(formatUpcomingBillingDateTime("2026-09-20T15:00:00.000Z", now)).toBeNull();
    expect(formatUpcomingBillingDateTime(null, now)).toBeNull();
    expect(formatUpcomingBillingDateTime("not-a-date", now)).toBeNull();
  });
});
