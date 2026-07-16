import { expect, it } from "vitest";
import { getJstDateKey, getNextJstMidnight } from "./jst.js";

it("uses the Japan date and next midnight across UTC", () => {
  const now = new Date("2026-07-10T15:30:00.000Z");
  expect(getJstDateKey(now)).toBe("2026-07-11");
  expect(getNextJstMidnight(now).toISOString()).toBe("2026-07-11T15:00:00.000Z");
});
