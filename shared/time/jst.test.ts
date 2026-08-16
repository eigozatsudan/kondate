import { expect, it } from "vitest";
import {
  alignDateInputTodayToJst,
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

it("PE12: alignLocalDateInputToJstDay maps behind-TZ local today to JST today and leaves other days", () => {
  const now = new Date("2026-08-16T16:00:00.000Z");
  expect(getJstDateKey(now)).toBe("2026-08-17");
  const localToday = getLocalDateKey(now);
  const jstToday = getJstDateKey(now);
  if (localToday < jstToday) {
    expect(alignLocalDateInputToJstDay(localToday, now)).toBe(jstToday);
  } else {
    expect(alignLocalDateInputToJstDay(localToday, now)).toBe(localToday);
  }
  expect(alignLocalDateInputToJstDay("2026-08-20", now)).toBe("2026-08-20");
  expect(alignLocalDateInputToJstDay("2000-01-01", now)).toBe("2000-01-01");
});

it("PE-R5: does not rewind ahead-TZ local today back to JST today", () => {
  // Australia/Sydney 0 時台: ローカル今日が JST 明日。巻き戻すと表示と保存がずれる。
  expect(alignDateInputTodayToJst("2026-08-17", "2026-08-17", "2026-08-16")).toBe("2026-08-17");
  expect(alignDateInputTodayToJst("2026-08-16", "2026-08-16", "2026-08-17")).toBe("2026-08-17");
  expect(alignDateInputTodayToJst("2026-08-16", "2026-08-16", "2026-08-16")).toBe("2026-08-16");
  expect(alignDateInputTodayToJst("2026-08-20", "2026-08-17", "2026-08-16")).toBe("2026-08-20");
});
