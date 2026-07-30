import { describe, expect, it, vi } from "vitest";
import {
  flyerWeeklyIssueMessages,
  type WeeklyFlyerMenu,
} from "../../../shared/contracts/flyer-weekly.js";
import {
  assertFlyerMenuSafe,
  assertFlyerPrivacyConsent,
  jstWeekStartMonday,
  runFlyerWeeklyWithReserveStub,
} from "./flyer-weekly-service.js";
import { HttpError } from "./http.js";
import { createUserScopedSupabase } from "./supabase-user.js";

vi.mock("./supabase-user.js", () => ({
  createUserScopedSupabase: vi.fn(),
}));

function sampleMenu(overrides: Partial<WeeklyFlyerMenu["days"][number]> = {}): WeeklyFlyerMenu {
  const baseDay = {
    label: "Day1",
    mainName: "野菜炒め",
    sideName: "味噌汁",
    ingredients: ["キャベツ", "にんじん"],
    notes: null as string | null,
  };
  // day1 に overrides を適用。dayIndex は 1..7 を固定で採番する
  const days = Array.from({ length: 7 }, (_, i) => {
    if (i === 0) {
      return {
        ...baseDay,
        ...overrides,
        dayIndex: 1,
      };
    }
    return {
      ...baseDay,
      dayIndex: i + 1,
      label: `Day${String(i + 1)}`,
    };
  });
  return { days, weekStartJst: "2026-07-27" };
}

describe("flyer-weekly-service", () => {
  it("does not call OpenRouter when reserve returns flyer_weekly_limit", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: null,
        idempotency_key: "k",
        status: "failed",
        failure_code: "flyer_weekly_limit",
        replayed: false,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.openRouterCalls).toBe(0);
    expect(result.errorCode).toBe("flyer_weekly_limit");
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("returns flyer_requires_plus without reserve when not plus entitled", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
      },
      openRouterSender,
      plusEntitled: false,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("flyer_requires_plus");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
    expect(flyerWeeklyIssueMessages.flyer_requires_plus).toContain("Plus");
  });

  it("PRIV-1: returns consent_required without OpenRouter when privacy not accepted", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
      hasPrivacyConsent: false,
    });
    expect(result.errorCode).toBe("consent_required");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });
});

describe("assertFlyerPrivacyConsent", () => {
  const user = {
    userId: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    accessToken: "token",
  };

  it("rejects when no current privacy_consents row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createUserScopedSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(assertFlyerPrivacyConsent(user)).rejects.toMatchObject({
      status: 422,
      code: "consent_required",
    });
  });

  it("accepts when current notice version is recorded for the user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: user.userId,
        notice_version: "2026-07-29.v1",
        accepted_at: "2026-07-29T00:00:00.000Z",
      },
      error: null,
    });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    vi.mocked(createUserScopedSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(assertFlyerPrivacyConsent(user)).resolves.toBeUndefined();
  });
});

describe("jstWeekStartMonday", () => {
  it("returns JST Monday even near UTC midnight (not raw UTC calendar day)", () => {
    // 2026-07-27 15:30 UTC = 2026-07-28 00:30 JST (火曜) → 月曜 2026-07-27
    expect(jstWeekStartMonday(new Date("2026-07-27T15:30:00.000Z"))).toBe("2026-07-27");
    // 2026-07-26 15:00 UTC = 2026-07-27 00:00 JST (月曜)
    expect(jstWeekStartMonday(new Date("2026-07-26T15:00:00.000Z"))).toBe("2026-07-27");
  });
});

describe("assertFlyerMenuSafe", () => {
  it("rejects banned allergen only present in label", () => {
    expect(() => {
      assertFlyerMenuSafe(sampleMenu({ label: "えび特集", mainName: "野菜炒め" }), ["えび"]);
    }).toThrow(HttpError);
  });

  it("rejects banned allergen only present in notes", () => {
    expect(() => {
      assertFlyerMenuSafe(sampleMenu({ notes: "仕上げに牛乳を少し" }), ["牛乳"]);
    }).toThrow(HttpError);
  });

  it("rejects fullwidth / zero-width evasion in mainName", () => {
    // 全角カタカナ + zero-width joiner で「えび」を隠す
    expect(() => {
      assertFlyerMenuSafe(sampleMenu({ mainName: "エ\u200dビフライ", ingredients: ["パン粉"] }), [
        "えび",
      ]);
    }).toThrow(HttpError);
  });

  it("accepts safe menu without banned needles", () => {
    expect(() => {
      assertFlyerMenuSafe(sampleMenu(), ["えび", "牛乳"]);
    }).not.toThrow();
  });
});
