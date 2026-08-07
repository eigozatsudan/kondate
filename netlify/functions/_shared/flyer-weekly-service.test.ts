import { describe, expect, it, vi } from "vitest";
import {
  flyerWeeklyIssueMessages,
  type WeeklyFlyerMenu,
} from "../../../shared/contracts/flyer-weekly.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import {
  appendDraftMemberAllergiesForFlyerInspection,
  assertFlyerMenuAgainstSafety,
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

  it("PE1: processing + replayed is in-progress without OpenRouter (no pipeline re-entry)", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
        replayed: true,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("generation_in_progress");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE1: fresh processing (not replayed) still proceeds to OpenRouter path in stub", async () => {
    const openRouterSender = vi.fn(() =>
      Promise.resolve({
        content: "{}",
        modelId: "mock",
        usage: { promptTokens: 1, completionTokens: 1 },
      } as never),
    );
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
        replayed: false,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBeUndefined();
    expect(result.openRouterCalls).toBe(1);
    expect(openRouterSender).toHaveBeenCalledOnce();
  });

  it("PE11: flyer_invalid_ai_response discloses try may be consumed", () => {
    expect(flyerWeeklyIssueMessages.flyer_invalid_ai_response).toContain("試行回数");
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

  it("PE2: does not false-positive 豆乳 for 乳 needle via foodTextContainsAlias", () => {
    // 素の includes だと「乳⊂豆乳」で誤検知する。evaluateAllergens 同型マッチャでは除外。
    expect(() => {
      assertFlyerMenuSafe(sampleMenu({ ingredients: ["豆乳"] }), ["乳"]);
    }).not.toThrow();
  });
});

describe("assertFlyerMenuAgainstSafety", () => {
  // PE2: succeeded 冪等 replay も同じ assert を通す（loadFlyerInspectionSafety 後）。
  // 成功後に卵アレルギー追加 → 旧「たまご焼き」献立を再生しない核をここで固定。
  it("PE2: rejects catalog allergen via dictionary aliases", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          allergyStatus: "registered",
          allergenIds: ["egg"],
        },
      ],
      allergenDictionary: {
        version: "jp-caa-2026-04.v1",
        catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
        aliases: [
          {
            allergenId: "egg",
            alias: "卵",
            normalizedAlias: "卵",
            aliasKind: "direct",
            requiresLabelConfirmation: false,
            dictionaryVersion: "jp-caa-2026-04.v1",
          },
          {
            allergenId: "egg",
            alias: "たまご",
            normalizedAlias: "たまご",
            aliasKind: "direct",
            requiresLabelConfirmation: false,
            dictionaryVersion: "jp-caa-2026-04.v1",
          },
        ],
      },
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "たまご焼き" }), safety);
    }).toThrow(HttpError);
  });

  it("PE2: rejects confirmed custom allergy needles", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          allergyStatus: "registered",
          allergenIds: [],
          customAllergies: [{ name: "パクチー", aliases: ["香菜"] }],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ ingredients: ["香菜"] }), safety);
    }).toThrow(HttpError);
  });

  it("accepts menu free of registered allergens", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          allergyStatus: "registered",
          allergenIds: ["egg"],
        },
      ],
      allergenDictionary: {
        version: "jp-caa-2026-04.v1",
        catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
        aliases: [
          {
            allergenId: "egg",
            alias: "卵",
            normalizedAlias: "卵",
            aliasKind: "direct",
            requiresLabelConfirmation: false,
            dictionaryVersion: "jp-caa-2026-04.v1",
          },
        ],
      },
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu(), safety);
    }).not.toThrow();
  });

  it("R1: rejects age-banded forbidden food rule (mochi under 6)", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          ageBand: "age_3_5",
          allergyStatus: "none",
          allergenIds: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "お雑煮（餅入り）" }), safety);
    }).toThrow(HttpError);
  });

  it("R1: rejects age-banded requires_tag food without adaptation path (grapes)", () => {
    // flyer は quarter_round_food 証拠を持てないため、命中は fail-closed
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          ageBand: "post_weaning_to_2",
          allergyStatus: "none",
          allergenIds: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ ingredients: ["ぶどう", "ヨーグルト"] }), safety);
    }).toThrow(HttpError);
  });

  it("R1: adult-only household accepts mochi (no age rule applies)", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "磯辺焼き餅" }), safety);
    }).not.toThrow();
  });

  it("R1: rejects senior forbidden mochi rule", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          ageBand: "senior",
          allergyStatus: "none",
          allergenIds: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ sideName: "おしるこ（餅）" }), safety);
    }).toThrow(HttpError);
  });

  it("PE1: rejects egg when only draft member has egg registered (complete is none)", () => {
    // 混在世帯: complete「アレルギーなし」+ draft に卵 → 検査 union 後は卵メニュー拒否
    const base = makeCurrentSafetyContext();
    const completeOnly = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          allergyStatus: "none",
          allergenIds: [],
          customAllergies: [],
        },
      ],
    });
    // draft 針を union する前は卵メニューが通ってしまう（false-safe 再現）
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "卵焼き" }), completeOnly);
    }).not.toThrow();

    const inspection = appendDraftMemberAllergiesForFlyerInspection(completeOnly, [
      {
        member_id: "55000000-0000-4000-8000-000000000099",
        allergen_id: "egg",
        custom_name: null,
        custom_aliases: null,
        custom_confirmed: false,
      },
    ]);
    expect(inspection.members).toHaveLength(2);
    expect(inspection.members[1]?.allergenIds).toEqual(["egg"]);
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "卵焼き" }), inspection);
    }).toThrow(HttpError);
  });

  it("PE1: does not invent members when draft allergies are empty", () => {
    const base = makeCurrentSafetyContext();
    const merged = appendDraftMemberAllergiesForFlyerInspection(base, [
      {
        member_id: "55000000-0000-4000-8000-000000000099",
        allergen_id: null,
        custom_name: "未確認自由文",
        custom_aliases: [],
        custom_confirmed: false,
      },
    ]);
    expect(merged.members).toHaveLength(base.members.length);
  });
});
