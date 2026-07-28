import { describe, expect, it } from "vitest";
import { getJstSeasonContext } from "./jst-season.js";

describe("getJstSeasonContext", () => {
  it("maps July JST to summer", () => {
    // 2026-07-15 12:00 JST = 2026-07-15T03:00:00.000Z
    expect(getJstSeasonContext(new Date("2026-07-15T03:00:00.000Z"))).toEqual({
      month: 7,
      season: "summer",
      labelJa: "夏",
    });
  });

  it("maps March 1 JST to spring", () => {
    // 2026-03-01 00:00 JST = 2026-02-28T15:00:00.000Z
    expect(getJstSeasonContext(new Date("2026-02-28T15:00:00.000Z"))).toEqual({
      month: 3,
      season: "spring",
      labelJa: "春",
    });
  });

  it("maps February JST to winter", () => {
    expect(getJstSeasonContext(new Date("2026-02-15T03:00:00.000Z"))).toEqual({
      month: 2,
      season: "winter",
      labelJa: "冬",
    });
  });

  it("maps December JST to winter", () => {
    expect(getJstSeasonContext(new Date("2026-12-01T03:00:00.000Z"))).toEqual({
      month: 12,
      season: "winter",
      labelJa: "冬",
    });
  });
});
