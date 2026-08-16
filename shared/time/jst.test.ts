import { expect, it } from "vitest";
import {
  alignLocalDateInputToJstDay,
  getJstDateKey,
  getLocalDateKey,
  getNextJstMidnight,
} from "./jst.js";

it("uses the Japan date and next midnight across UTC", () => {
  const now = new Date("2026-07-10T15:30:00.000Z");
  expect(getJstDateKey(now)).toBe("2026-07-11");
  expect(getNextJstMidnight(now).toISOString()).toBe("2026-07-11T15:00:00.000Z");
});

it("PE12: alignLocalDateInputToJstDay maps local today to JST today and leaves other days", () => {
  const now = new Date("2026-08-16T16:00:00.000Z");
  expect(getJstDateKey(now)).toBe("2026-08-17");
  const localToday = getLocalDateKey(now);
  expect(alignLocalDateInputToJstDay(localToday, now)).toBe("2026-08-17");
  expect(alignLocalDateInputToJstDay("2026-08-20", now)).toBe("2026-08-20");
  expect(alignLocalDateInputToJstDay("2000-01-01", now)).toBe("2000-01-01");
});
