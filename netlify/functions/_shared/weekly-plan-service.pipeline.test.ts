import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import type { WeeklyPlanDeps } from "./weekly-plan-service.js";

const getServerEnvMock = vi.fn();
const loadEntitlementMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("./env.js", () => ({ getServerEnv: getServerEnvMock }));
vi.mock("./billing-entitlement.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-entitlement.js")>();
  return { ...actual, loadEntitlement: loadEntitlementMock };
});
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock, from: fromMock }),
}));

function rpcCallName(call: unknown[]): string {
  return call[0] as string;
}
function rpcCallArgs(call: unknown[]): Record<string, unknown> {
  return call[1] as Record<string, unknown>;
}
function rpcNames(): string[] {
  return rpcMock.mock.calls.map((call) => rpcCallName(call));
}
function rpcArgsFor(name: string): Record<string, unknown> | undefined {
  const call = rpcMock.mock.calls.find((candidate) => rpcCallName(candidate) === name);
  return call === undefined ? undefined : rpcCallArgs(call);
}

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "in", "limit", "maybeSingle", "single", "insert"];
  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(result));
  query.single = vi.fn(() => Promise.resolve(result));
  (query as { then: unknown }).then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
  ) => Promise.resolve(result).then(resolve);
  return query;
}

const sampleMemberId = "22222222-2222-4222-8222-222222222222";

/**
 * WP-P-6: assertPrivacyConsent のデフォルト実装（flyer-weekly-service.js の
 * assertFlyerPrivacyConsent）は admin.from("privacy_consents") を読む実 DB 呼び出しであり、
 * ensureOpenRouterModelPolicy のデフォルト実装は OpenRouter へ実 HTTP を投げる。
 * このテストファイルの fromMock/rpcMock はどちらも面倒を見ていないため、
 * runWeeklyPlan を呼ぶすべてのテストで deps に注入してスタブ化する
 * （consent 済み・モデル利用可という前提を明示する）。
 */
function baseDeps(overrides?: { openRouterSender?: WeeklyPlanDeps["openRouterSender"] }) {
  return {
    user: { userId: "u1", email: "u1@example.com", accessToken: "tok" },
    openRouterSender: overrides?.openRouterSender ?? vi.fn(),
    assertPrivacyConsent: vi.fn().mockResolvedValue(undefined),
    ensureOpenRouterModelPolicy: vi.fn().mockResolvedValue(undefined),
  };
}

function mockInspectionQueries(options?: { unconfirmed?: boolean }) {
  fromMock.mockImplementation((table: string) => {
    if (table === "household_members") {
      return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
    }
    if (table === "weekly_plans") {
      return thenableQuery({ data: null, error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });
  void options;
}

function sampleRequest() {
  return {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    targetMemberIds: [sampleMemberId],
    cuisineGenre: "japanese" as const,
    budgetPreference: null,
    noveltyPreference: null,
  };
}

function sampleAiMenu() {
  return {
    weekStartJst: "2026-09-07",
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: `day${String(index + 1)}`,
      mainName: "主菜",
      sideName: null,
      ingredients: ["米"],
      notes: null,
    })),
  };
}

const { runWeeklyPlan, getWeeklyPlan } = await import("./weekly-plan-service.js");
const { loadCurrentSafetyContext } = await import("./current-safety.js");

vi.mock("./current-safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./current-safety.js")>();
  return { ...actual, loadCurrentSafetyContext: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnvMock.mockReturnValue({
    billingEnabled: true,
    aiQuotaDisabled: false,
    quotaIdentityHmacKey: "test-key",
    openRouter: {
      apiKey: "key",
      baseUrl: "http://mock",
      models: ["m1"],
      plusModels: ["m1"],
      flyerModels: [],
      globalDailyLimit: 20,
      timeoutMs: 24_000,
      functionTotalBudgetMs: 55_000,
      staleAfterSeconds: 180,
    },
  });
  // applyQuotaPlan は entitlement.plan ではなく plusEntitled を見る
  // （billing-entitlement.ts の restoreKillMaskedEntitlement → plusEntitled）。
  // plusEntitled を落とすと happy path が 403 になる。ここを緑にするために
  // applyQuotaPlan / productSurfacesOpen / isFlyerPlusAllowed 側へ手を入れてはいけない
  // （Plus ゲートは製品ロック）。直すのは常にこのフィクスチャ側。
  loadEntitlementMock.mockResolvedValue({ plan: "plus", plusEntitled: true, killSource: null });
  vi.mocked(loadCurrentSafetyContext).mockResolvedValue({
    dictionaryVersion: "v1",
    foodRuleVersion: "v1",
    requestText: "",
    members: [
      {
        householdMemberId: sampleMemberId,
        anonymousRef: "member_1",
        ageBand: "adult",
        allergyStatus: "none",
        allergenIds: [],
        hasUnmappedCustomAllergy: false,
        customAllergies: [],
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        unsupportedDietKinds: [],
      },
    ],
    // AllergenDictionary は version / catalog / aliases の 3 つが必須（shared/safety/allergens.ts）。
    allergenDictionary: { version: "test", catalog: [], aliases: [] },
    foodSafetyRules: [],
  });
  mockInspectionQueries();
});

describe("runWeeklyPlan — fresh generation happy path", () => {
  it("reserves, marks, sends once, finalizes, and inserts", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "33333333-3333-4333-8333-333333333333",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    const result = await runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest());

    expect(sender).toHaveBeenCalledTimes(1);
    expect(rpcNames()).toContain("put_weekly_plan_intent");
    expect(rpcArgsFor("put_weekly_plan_intent")).toMatchObject({
      p_request_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    expect(rpcNames()).toContain("delete_weekly_plan_intent");
    expect(result.days).toHaveLength(7);
    expect(result.staleSafety).toBe(false);
  });
});

describe("runWeeklyPlan — partialHousehold parity between POST and GET (P2 fix1)", () => {
  it("returns partialHousehold: true on fresh generation success when only some complete members are targeted", async () => {
    const otherMemberId = "12121212-1212-4121-8121-121212121212";
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      // household_members: complete なメンバーが sampleMemberId と otherMemberId の2名いる世帯で、
      // 対象は sampleMemberId 1名だけ → partialHousehold は true になるべき（修正1本体）。
      if (table === "household_members") {
        return thenableQuery({
          data: [{ id: sampleMemberId }, { id: otherMemberId }],
          error: null,
        });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    const result = await runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest());

    expect(result.partialHousehold).toBe(true);
  });
});

describe("runWeeklyPlan — stash recovery via lookup before reserve (P2 fix2)", () => {
  it("recovers a stashed result from the lookup hit before reserve, even when target members are no longer complete", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "12121212-1212-4121-8121-121212121213",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: sampleAiMenu(),
          },
          error: null,
        });
      }
      if (name === "get_weekly_plan_intent") {
        return Promise.resolve({
          data: [
            {
              request_id: "12121212-1212-4121-8121-121212121213",
              user_id: "u1",
              preference_snapshot: {
                targetMemberIds: [sampleMemberId],
                cuisineGenre: "japanese",
                budgetPreference: null,
                noveltyPreference: null,
              },
              safety_fingerprint: "a".repeat(64),
            },
          ],
          error: null,
        });
      }
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      // 対象メンバーが complete でない（削除済み・未確認に戻された）状況を再現するため空にする。
      if (table === "household_members") {
        return thenableQuery({ data: [], error: null });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: { id: "13131313-1313-4131-8131-131313131313" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    expect(result.staleSafety).toBe(true);
  });
});

describe("runWeeklyPlan — ordering and quota", () => {
  it("checks lookup before the Plus gate (succeeded lookup hit needs no reserve call)", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "55555555-5555-4555-8555-555555555555",
            idempotency_key: "k1",
            status: "succeeded",
            result: sampleAiMenu(),
          },
          error: null,
        });
      }
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "weekly_plans") {
        return thenableQuery({
          data: {
            id: "55555555-5555-4555-8555-555555555555",
            week_start: "2026-09-07",
            preference_snapshot: {
              targetMemberIds: [sampleMemberId],
              cuisineGenre: "japanese",
              budgetPreference: null,
              noveltyPreference: null,
            },
            safety_fingerprint: "a".repeat(64),
            days: sampleAiMenu().days,
          },
          error: null,
        });
      }
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    loadEntitlementMock.mockResolvedValue({ plan: "free", plusEntitled: false, killSource: null });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
    expect(result.weeklyPlanId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("throws weekly_plan_weekly_limit (429) mapped from flyer_weekly_limit and burns no attempt", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: null,
            idempotency_key: "k1",
            status: "failed",
            failure_code: "flyer_weekly_limit",
          },
          error: null,
        });
      }
      throw new Error(`unexpected rpc: ${name}`);
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 429,
      code: "weekly_plan_weekly_limit",
    });
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });
});

describe("runWeeklyPlan — replayed + stash re-assert (N-I-10)", () => {
  it("returns 200 + staleSafety instead of calling finalize_flyer_weekly_failure", async () => {
    // WP-P-6: 手順5（reserve 前 422 集合）は household_members を「対象メンバー全員 complete」で
    // 通す必要がある。ここを [] にすると reserve へ到達する前に手順5自体が 422 を投げてしまい、
    // replayStashedWeeklyPlan の catch（本テストの主眼）に一度も届かない。
    // 再 assert 失敗は「メンバーが読めない」ではなく「stash された本文が保証フレーズを含む」で誘発する
    // （assertFlyerMenuHasNoGuaranteePhrases は本文だけで判定するため member 側の細工が不要）。
    const stashedMenuWithGuaranteePhrase = {
      ...sampleAiMenu(),
      days: sampleAiMenu().days.map((day, index) =>
        index === 0 ? { ...day, notes: "小麦アレルギーでも安全です" } : day,
      ),
    };
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "66666666-6666-4666-8666-666666666666",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: stashedMenuWithGuaranteePhrase,
          },
          error: null,
        });
      }
      if (name === "get_weekly_plan_intent") {
        return Promise.resolve({
          data: [
            {
              request_id: "66666666-6666-4666-8666-666666666666",
              user_id: "u1",
              preference_snapshot: {
                targetMemberIds: [sampleMemberId],
                cuisineGenre: "japanese",
                budgetPreference: null,
                noveltyPreference: null,
              },
              safety_fingerprint: "a".repeat(64),
            },
          ],
          error: null,
        });
      }
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: { id: "77777777-7777-4777-8777-777777777777" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    expect(result.staleSafety).toBe(true);
  });

  it("returns partialHousehold: true when the intent's target members are only a subset of the complete household (P2 fix1)", async () => {
    const otherMemberId = "12121212-1212-4121-8121-121212121214";
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "66666666-6666-4666-8666-666666666667",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: sampleAiMenu(),
          },
          error: null,
        });
      }
      if (name === "get_weekly_plan_intent") {
        return Promise.resolve({
          data: [
            {
              request_id: "66666666-6666-4666-8666-666666666667",
              user_id: "u1",
              preference_snapshot: {
                targetMemberIds: [sampleMemberId],
                cuisineGenre: "japanese",
                budgetPreference: null,
                noveltyPreference: null,
              },
              safety_fingerprint: "a".repeat(64),
            },
          ],
          error: null,
        });
      }
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      // complete なメンバーが2名いる世帯で intent の対象は sampleMemberId 1名のみ → partial true。
      if (table === "household_members") {
        return thenableQuery({
          data: [{ id: sampleMemberId }, { id: otherMemberId }],
          error: null,
        });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: { id: "77777777-7777-4777-8777-777777777778" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(result.partialHousehold).toBe(true);
  });
});

describe("runWeeklyPlan — consent guard", () => {
  it("rejects with 422 consent_required when privacy consent is missing, without reserving", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    const deps = baseDeps();
    deps.assertPrivacyConsent = vi
      .fn()
      .mockRejectedValue(new HttpError(422, "consent_required", "consent required"));

    await expect(runWeeklyPlan(deps, sampleRequest())).rejects.toMatchObject({
      status: 422,
      code: "consent_required",
    });
    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
  });
});

describe("runWeeklyPlan — pre-reserve 422 branches (WP-P-6 手順5)", () => {
  it("rejects with weekly_plan_unsatisfiable_member (422) for a cut_small constraint, before reserve", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    vi.mocked(loadCurrentSafetyContext).mockResolvedValue({
      dictionaryVersion: "v1",
      foodRuleVersion: "v1",
      requestText: "",
      members: [
        {
          householdMemberId: sampleMemberId,
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          hasUnmappedCustomAllergy: false,
          customAllergies: [],
          requiredSafetyConstraints: ["cut_small"],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 422,
      code: "weekly_plan_unsatisfiable_member",
    });
    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });

  it("rejects with unmapped_custom_allergy (422) when custom allergy text is entirely blank, before reserve", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    vi.mocked(loadCurrentSafetyContext).mockResolvedValue({
      dictionaryVersion: "v1",
      foodRuleVersion: "v1",
      requestText: "",
      members: [
        {
          householdMemberId: sampleMemberId,
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "registered",
          allergenIds: [],
          hasUnmappedCustomAllergy: true,
          customAllergies: [{ name: "", aliases: [""] }],
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 422,
      code: "unmapped_custom_allergy",
    });
    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });
});

describe("runWeeklyPlan — finalize / persist failure branches", () => {
  it("stashes and returns 500 when finalize_flyer_weekly_success fails, without calling finalize_flyer_weekly_failure", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "88888888-8888-4888-8888-888888888888",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: null, error: { message: "boom" } });
      if (name === "stash_flyer_weekly_result") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    await expect(
      runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest()),
    ).rejects.toMatchObject({ status: 500, code: "internal_error" });
    expect(rpcNames()).toContain("stash_flyer_weekly_result");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
  });

  it("returns 500 weekly_plan_persist_failed when the weekly_plans insert fails, without calling finalize_flyer_weekly_failure", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "99999999-9999-4999-8999-999999999999",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: null, error: { message: "insert failed" } });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    await expect(
      runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest()),
    ).rejects.toMatchObject({ status: 500, code: "weekly_plan_persist_failed" });
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
  });
});

describe("runWeeklyPlan — reserve leak on pre-generation safety re-read failure (P2 fix3)", () => {
  it("calls finalize_flyer_weekly_failure with p_sent: false when the post-reserve safety re-read fails", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "14141414-1414-4141-8141-141414141414",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "finalize_flyer_weekly_failure")
        return Promise.resolve({ data: { sent: false }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    let householdCallCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        householdCallCount += 1;
        // 1回目（手順5: reserve 前 422 集合）は成功させ reserve へ進ませる。
        // 2回目（手順6': reserve 後の preReserveSafety 再読取）を失敗させ、
        // 予約が処理中のまま残らないことを確認する。
        if (householdCallCount === 1) {
          return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
        }
        return thenableQuery({ data: null, error: { message: "boom" } });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: null, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 500,
      code: "safety_context_failed",
    });

    expect(rpcNames()).toContain("reserve_flyer_weekly");
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_request_id: "14141414-1414-4141-8141-141414141414",
      p_failure_code: "safety_context_failed",
      p_sent: false,
    });
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });
});

describe("runWeeklyPlan — replayed without stash", () => {
  it("returns 409 generation_in_progress when replayed with no stashed result", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: null,
          },
          error: null,
        });
      }
      throw new Error(`unexpected rpc: ${name}`);
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 409,
      code: "generation_in_progress",
    });
  });
});

describe("runWeeklyPlan — fresh generation guarantee-phrase / safety gate (weekly-plan-service.ts:872-893)", () => {
  it("rejects with weekly_plan_invalid_ai_response (400) when the AI menu contains a guarantee phrase, finalizing failure with p_sent: true", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_failure")
        return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    const menuWithGuaranteePhrase = {
      ...sampleAiMenu(),
      days: sampleAiMenu().days.map((day, index) =>
        index === 0 ? { ...day, notes: "小麦アレルギーでも安全です" } : day,
      ),
    };
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: menuWithGuaranteePhrase,
      modelId: "m1",
    });

    await expect(
      runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest()),
    ).rejects.toMatchObject({ status: 400, code: "weekly_plan_invalid_ai_response" });

    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      p_failure_code: "weekly_plan_invalid_ai_response",
      p_sent: true,
    });
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
    expect(fromMock.mock.calls.map((call) => call[0] as string)).not.toContain("weekly_plans");
  });

  it("rejects with weekly_plan_invalid_ai_response (400) when the AI menu names a target member's allergen, finalizing failure with p_sent: true", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_failure")
        return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    vi.mocked(loadCurrentSafetyContext).mockResolvedValue({
      dictionaryVersion: "v1",
      foodRuleVersion: "v1",
      requestText: "",
      members: [
        {
          householdMemberId: sampleMemberId,
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "registered",
          allergenIds: ["egg"],
          hasUnmappedCustomAllergy: false,
          customAllergies: [],
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: {
        version: "test",
        catalog: [],
        aliases: [
          {
            allergenId: "egg",
            alias: "卵",
            normalizedAlias: "卵",
            aliasKind: "direct",
            requiresLabelConfirmation: false,
            dictionaryVersion: "v1",
          },
        ],
      },
      foodSafetyRules: [],
    });
    const menuWithAllergen = {
      ...sampleAiMenu(),
      days: sampleAiMenu().days.map((day, index) =>
        index === 0 ? { ...day, ingredients: ["卵"] } : day,
      ),
    };
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: menuWithAllergen,
      modelId: "m1",
    });

    await expect(
      runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest()),
    ).rejects.toMatchObject({ status: 400, code: "weekly_plan_invalid_ai_response" });

    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      p_failure_code: "weekly_plan_invalid_ai_response",
      p_sent: true,
    });
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
    expect(fromMock.mock.calls.map((call) => call[0] as string)).not.toContain("weekly_plans");
  });
});

describe("runWeeklyPlan — Plus 403 gate on the real pipeline (weekly-plan-service.ts:649-652)", () => {
  it("rejects with weekly_plan_requires_plus (403) for a free entitlement on a lookup miss, without reserving or marking sent", async () => {
    loadEntitlementMock.mockResolvedValue({ plan: "free", plusEntitled: false, killSource: null });
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 403,
      code: "weekly_plan_requires_plus",
    });
    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });
});

describe("getWeeklyPlan", () => {
  it("returns 404 for another user's id", async () => {
    const admin = {
      from: vi.fn(() => thenableQuery({ data: null, error: null })),
    } as unknown as AdminSupabaseClient;

    await expect(getWeeklyPlan(admin, "other-user", "weekly-plan-id")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("returns 503 when the row read itself fails", async () => {
    const admin = {
      from: vi.fn(() => thenableQuery({ data: null, error: { message: "boom" } })),
    } as unknown as AdminSupabaseClient;

    await expect(getWeeklyPlan(admin, "u1", "weekly-plan-id")).rejects.toMatchObject({
      status: 503,
      code: "request_failed",
    });
  });

  it("returns 200 with staleSafety: true when target members are missing", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "weekly_plans") {
          return thenableQuery({
            data: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              week_start: "2026-09-07",
              preference_snapshot: {
                targetMemberIds: [sampleMemberId],
                cuisineGenre: "japanese",
                budgetPreference: null,
                noveltyPreference: null,
              },
              safety_fingerprint: "a".repeat(64),
              days: sampleAiMenu().days,
            },
            error: null,
          });
        }
        if (table === "household_members") {
          return thenableQuery({ data: [], error: null });
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as AdminSupabaseClient;

    const result = await getWeeklyPlan(admin, "u1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    expect(result.staleSafety).toBe(true);
  });
});
