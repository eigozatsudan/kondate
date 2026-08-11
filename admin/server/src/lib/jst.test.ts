import { describe, it, expect } from "vitest";
import { parseJstDateRange, jstDayStartUtc, getJstDateKey } from "./jst.js";
import { AdminClosedError } from "../errors.js";

describe("parseJstDateRange", () => {
  it("defaults to last 7 JST days when omitted", () => {
    // 固定: 2026-08-11 12:00 JST = 2026-08-11 03:00 UTC
    const now = new Date("2026-08-11T03:00:00.000Z");
    const r = parseJstDateRange({ now });
    expect(r.toJst).toBe("2026-08-11");
    expect(r.fromJst).toBe("2026-08-05");
    expect(r.fromUtc.toISOString()).toBe(jstDayStartUtc("2026-08-05").toISOString());
  });

  it("rejects range longer than 31 days", () => {
    expect(() =>
      parseJstDateRange({ from: "2026-01-01", to: "2026-02-15" }),
    ).toThrow(AdminClosedError);
  });

  it("accepts 31 day inclusive range", () => {
    const r = parseJstDateRange({ from: "2026-01-01", to: "2026-01-31" });
    expect(r.fromJst).toBe("2026-01-01");
    expect(r.toJst).toBe("2026-01-31");
  });
});

describe("getJstDateKey", () => {
  it("returns JST calendar day around midnight boundary", () => {
    // 2026-08-10 15:00 UTC = 2026-08-11 00:00 JST
    expect(getJstDateKey(new Date("2026-08-10T15:00:00.000Z"))).toBe("2026-08-11");
  });
});
