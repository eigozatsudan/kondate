import { describe, expect, it } from "vitest";
import { formatBillingDate } from "./format-billing-date";

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
