import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLYER_UPSELL_COPY, FlyerUpsellBanner } from "./flyer-upsell-banner";
import { FLYER_UPSELL_WEEK_KEY, jstIsoWeekKey } from "./jst-iso-week";

const FIXED_NOW = new Date("2026-07-29T05:00:00.000Z"); // JST 2026-07-29

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("FlyerUpsellBanner", () => {
  it("shows flyer upsell once per JST week for Free after success (L10-6)", () => {
    localStorage.clear();
    const { unmount } = render(<FlyerUpsellBanner plusEntitled={false} now={FIXED_NOW} />);
    expect(screen.getByText(FLYER_UPSELL_COPY)).toBeVisible();
    // fake timers 下の userEvent は hang しやすいので fireEvent を使う
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(localStorage.getItem(FLYER_UPSELL_WEEK_KEY)).toBe(jstIsoWeekKey(FIXED_NOW));
    expect(screen.queryByText(FLYER_UPSELL_COPY)).not.toBeInTheDocument();

    unmount();
    // 同週 remount → 出さない
    render(<FlyerUpsellBanner plusEntitled={false} now={FIXED_NOW} />);
    expect(screen.queryByText(FLYER_UPSELL_COPY)).not.toBeInTheDocument();
  });

  it("does not show when Plus entitled", () => {
    localStorage.clear();
    render(<FlyerUpsellBanner plusEntitled now={FIXED_NOW} />);
    expect(screen.queryByText(FLYER_UPSELL_COPY)).not.toBeInTheDocument();
  });

  it("does not show when already dismissed this week", () => {
    localStorage.setItem(FLYER_UPSELL_WEEK_KEY, jstIsoWeekKey(FIXED_NOW));
    render(<FlyerUpsellBanner plusEntitled={false} now={FIXED_NOW} />);
    expect(screen.queryByText(FLYER_UPSELL_COPY)).not.toBeInTheDocument();
  });
});

describe("jstIsoWeekKey", () => {
  it("returns YYYY-Www for a known JST date", () => {
    // 2026-07-29 (Wed JST) is ISO week 31 of 2026
    expect(jstIsoWeekKey(new Date("2026-07-29T05:00:00.000Z"))).toBe("2026-W31");
  });
});
