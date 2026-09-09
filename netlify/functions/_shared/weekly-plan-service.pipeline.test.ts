import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { HttpError } from "./http.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import type { WeeklyPlanDeps } from "./weekly-plan-service.js";

const getServerEnvMock = vi.fn();
const loadEntitlementMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const safeLogMock = vi.fn();

vi.mock("./env.js", () => ({ getServerEnv: getServerEnvMock }));
vi.mock("./billing-entitlement.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-entitlement.js")>();
  return { ...actual, loadEntitlement: loadEntitlementMock };
});
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock, from: fromMock }),
}));
// IMP-A: put_weekly_plan_intent の best-effort 失敗を safeLog 呼び出しで検証するためのモック。
// logger.js からはこのモジュールは safeLog しか import していない。
vi.mock("./logger.js", () => ({ safeLog: safeLogMock }));

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
  it.each([false, true])(
    "reserves, sends, finalizes and inserts for Plus (billing=%s)",
    async (enabled) => {
      getServerEnvMock.mockReturnValue({ ...getServerEnvMock(), billingEnabled: enabled });
      if (!enabled) {
        loadEntitlementMock.mockResolvedValue({
          plan: "free",
          plusEntitled: false,
          developerPlus: true,
        });
      }
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
        if (name === "delete_weekly_plan_intent")
          return Promise.resolve({ data: null, error: null });
        throw new Error(`unexpected rpc: ${name}`);
      });
      fromMock.mockImplementation((table: string) => {
        if (table === "household_members") {
          return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
        }
        if (table === "weekly_plans") {
          return thenableQuery({
            data: { id: "44444444-4444-4444-8444-444444444444" },
            error: null,
          });
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
    },
  );
});

describe("runWeeklyPlan — persisted safety_fingerprint must match the condition that validated the menu (P2 advレビュー修正A)", () => {
  it("stores freshSafety's fingerprint (post-generation re-check), not preReserveSafety's", async () => {
    // loadWeeklyPlanInspectionSafety は新規生成パスで4回呼ばれる:
    // 1回目 手順5（reserve 前 422 集合、結果は破棄）、2回目 preReserveSafety（条件A）、
    // 3回目 markGateSafety、4回目 freshSafety（条件C）。
    // dictionaryVersion を2回目まで固定し3回目以降で変えて、A と C の fingerprint を分ける。
    let safetyCallCount = 0;
    vi.mocked(loadCurrentSafetyContext).mockImplementation(() => {
      safetyCallCount += 1;
      return Promise.resolve({
        dictionaryVersion: safetyCallCount <= 2 ? "v1" : "v2",
        foodRuleVersion: "v1",
        requestText: "",
        members: [
          {
            householdMemberId: sampleMemberId,
            anonymousRef: "member_1",
            ageBand: "adult" as const,
            allergyStatus: "none" as const,
            allergenIds: [],
            hasUnmappedCustomAllergy: false,
            customAllergies: [],
            requiredSafetyConstraints: [],
            unsupportedDietStatus: "none" as const,
            unsupportedDietKinds: [],
          },
        ],
        allergenDictionary: { version: "test", catalog: [], aliases: [] },
        foodSafetyRules: [],
      });
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "17171717-1717-4171-8171-171717171717",
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

    let capturedInsertPayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        const query = thenableQuery({
          data: { id: "18181818-1818-4181-8181-181818181818" },
          error: null,
        });
        query.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return query;
        });
        return query;
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    await runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest());

    const baseSafetyContext = {
      foodRuleVersion: "v1",
      requestText: "",
      members: [
        {
          householdMemberId: sampleMemberId,
          anonymousRef: "member_1",
          ageBand: "adult" as const,
          allergyStatus: "none" as const,
          allergenIds: [],
          hasUnmappedCustomAllergy: false,
          customAllergies: [],
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none" as const,
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    };
    const conditionAFingerprint = createCurrentSafetyFingerprint({
      ...baseSafetyContext,
      dictionaryVersion: "v1",
    });
    const conditionCFingerprint = createCurrentSafetyFingerprint({
      ...baseSafetyContext,
      dictionaryVersion: "v2",
    });

    expect(conditionAFingerprint).not.toBe(conditionCFingerprint);
    expect(capturedInsertPayload?.safety_fingerprint).toBe(conditionCFingerprint);
  });
});

describe("runWeeklyPlan — intent fingerprint is refreshed to the validated condition before finalize (I-2 fresh path)", () => {
  it("re-issues put_weekly_plan_intent with freshSafety's fingerprint before commitWeeklyPlanFinalize", async () => {
    // 前段のテストと同じ4回呼び出しの数え方。2回目まで v1、3回目以降 v2 に変える。
    let safetyCallCount = 0;
    vi.mocked(loadCurrentSafetyContext).mockImplementation(() => {
      safetyCallCount += 1;
      return Promise.resolve({
        dictionaryVersion: safetyCallCount <= 2 ? "v1" : "v2",
        foodRuleVersion: "v1",
        requestText: "",
        members: [
          {
            householdMemberId: sampleMemberId,
            anonymousRef: "member_1",
            ageBand: "adult" as const,
            allergyStatus: "none" as const,
            allergenIds: [],
            hasUnmappedCustomAllergy: false,
            customAllergies: [],
            requiredSafetyConstraints: [],
            unsupportedDietStatus: "none" as const,
            unsupportedDietKinds: [],
          },
        ],
        allergenDictionary: { version: "test", catalog: [], aliases: [] },
        foodSafetyRules: [],
      });
    });

    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "23232323-2323-4232-8232-232323232323",
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
        return thenableQuery({ data: { id: "24242424-2424-4242-8242-242424242424" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    await runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest());

    const conditionCFingerprint = createCurrentSafetyFingerprint({
      dictionaryVersion: "v2",
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
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    });

    const putIntentCalls = rpcMock.mock.calls.filter(
      (call) => rpcCallName(call) === "put_weekly_plan_intent",
    );
    expect(putIntentCalls).toHaveLength(2);
    expect(rpcCallArgs(putIntentCalls[1] as unknown[])).toMatchObject({
      p_request_id: "23232323-2323-4232-8232-232323232323",
      p_fingerprint: conditionCFingerprint,
    });

    // MIN-2(b): 2本目の put_weekly_plan_intent は commitWeeklyPlanFinalize
    // （finalize_flyer_weekly_success の呼び出し）より前でなければならない。
    // 引数の値だけでなく呼び出し順序そのものを固定する。
    const names = rpcNames();
    const secondPutIndex = names.lastIndexOf("put_weekly_plan_intent");
    const finalizeSuccessIndex = names.indexOf("finalize_flyer_weekly_success");
    expect(secondPutIndex).toBeGreaterThan(-1);
    expect(finalizeSuccessIndex).toBeGreaterThan(-1);
    expect(secondPutIndex).toBeLessThan(finalizeSuccessIndex);
  });

  it("continues (200, no finalize_flyer_weekly_failure) when the intent refresh put fails (IMP-1 best-effort)", async () => {
    let putIntentCallCount = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "30303030-3030-4303-8303-303030303030",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      // 1本目（手順6'）は成功、2本目（手順10後の指紋更新）だけ失敗させる。
      if (name === "put_weekly_plan_intent") {
        putIntentCallCount += 1;
        return Promise.resolve(
          putIntentCallCount <= 1
            ? { data: null, error: null }
            : { data: null, error: { message: "transient" } },
        );
      }
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
        return thenableQuery({ data: { id: "31313131-3131-4313-8313-313131313131" }, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    const result = await runWeeklyPlan(baseDeps({ openRouterSender: sender }), sampleRequest());

    expect(result.days).toHaveLength(7);
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    // IMP-A: 握りつぶす代わりに safeLog で可観測にする。新しいログフィールドは足さず、
    // 既存の共有台帳系イベントのフラグ（flyer / plan）を流用する。PII・指紋は載せない。
    expect(safeLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        code: "weekly_plan_intent_refresh_failed",
        durationMs: 0,
        flyer: true,
        plan: "plus",
      }),
    );
  });
});

describe("replayStashedWeeklyPlan — persists the validated fingerprint when re-assert succeeds (I-2 stash path)", () => {
  it("stores currentFingerprint (not the intent's) when the stash re-assert succeeds", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "25252525-2525-4252-8252-252525252525",
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
              request_id: "25252525-2525-4252-8252-252525252525",
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

    let capturedInsertPayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        const query = thenableQuery({
          data: { id: "26262626-2626-4262-8262-262626262626" },
          error: null,
        });
        query.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return query;
        });
        return query;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    // beforeEach のデフォルト loadCurrentSafetyContext フィクスチャ（dictionaryVersion v1 など）
    // から計算される現行条件の指紋。intent の safety_fingerprint（"a".repeat(64)）とは別物。
    const currentFingerprint = createCurrentSafetyFingerprint({
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
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    });

    expect(capturedInsertPayload?.safety_fingerprint).toBe(currentFingerprint);
    expect(capturedInsertPayload?.safety_fingerprint).not.toBe("a".repeat(64));
    // IMP-2: 再 assert が成功し保存指紋を現行条件に更新した以上、返却 staleSafety も false。
    // true のままだと同一リソースについて POST は true・直後の GET は false（buildResultFromRow
    // が保存指紋 == 現行指紋で false を返す）という反転が起きる。
    expect(result.staleSafety).toBe(false);
  });

  it("keeps staleSafety: true and persists the intent's fingerprint when the stash re-assert fails (N-I-10 契約は変えない)", async () => {
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
            request_id: "28282828-2828-4282-8282-282828282828",
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
              request_id: "28282828-2828-4282-8282-282828282828",
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

    let capturedInsertPayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        const query = thenableQuery({
          data: { id: "29292929-2929-4292-8292-292929292929" },
          error: null,
        });
        query.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return query;
        });
        return query;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(capturedInsertPayload?.safety_fingerprint).toBe("a".repeat(64));
    expect(result.staleSafety).toBe(true);
  });
});

describe("runWeeklyPlan → getWeeklyPlan — staleSafety agrees between POST and GET (IMP-2 契約)", () => {
  it("returns the same staleSafety (false) from POST and a follow-up GET when the stash re-assert succeeded despite a stale intent fingerprint", async () => {
    // stash 経路: intent の safety_fingerprint はわざと現行条件と食い違わせておく（"a".repeat(64)）。
    // 再 assert 自体は現行の household_members / loadCurrentSafetyContext（beforeEach の v1
    // フィクスチャ）に対して成功するので、IMP-2 により POST の staleSafety は false になり、
    // 保存指紋も currentFingerprint（intent 指紋ではない）になるはず。
    // GET はその保存済み行を再度同じ v1 フィクスチャで検査するので、一致していれば false のまま。
    let phase: "post" | "get" = "post";
    let capturedInsertPayload: Record<string, unknown> | undefined;
    const insertedId = "34343434-3434-4343-8343-343434343434";

    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "35353535-3535-4353-8353-353535353535",
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
              request_id: "35353535-3535-4353-8353-353535353535",
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
        if (phase === "post") {
          const query = thenableQuery({ data: { id: insertedId }, error: null });
          query.insert = vi.fn((payload: Record<string, unknown>) => {
            capturedInsertPayload = payload;
            return query;
          });
          return query;
        }
        // phase === "get": POST が insert した行をそのまま select で返す
        // （getWeeklyPlan は select().eq("id", …).eq("user_id", …).maybeSingle() を使う）。
        return thenableQuery({
          data: {
            id: insertedId,
            week_start: capturedInsertPayload?.week_start,
            preference_snapshot: capturedInsertPayload?.preference_snapshot,
            safety_fingerprint: capturedInsertPayload?.safety_fingerprint,
            days: capturedInsertPayload?.days,
          },
          error: null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const postResult = await runWeeklyPlan(baseDeps(), sampleRequest());

    phase = "get";
    const admin = { rpc: rpcMock, from: fromMock } as unknown as AdminSupabaseClient;
    const getResult = await getWeeklyPlan(admin, "u1", postResult.weeklyPlanId);

    expect(getResult.weeklyPlanId).toBe(postResult.weeklyPlanId);
    // 期待値をハードコードせず、POST と GET の返り値そのものを直接比較する。
    expect(getResult.staleSafety).toBe(postResult.staleSafety);
    // sanity: IMP-2 が意図した分岐（再 assert 成功→false）を実際に通っていることの確認。
    expect(postResult.staleSafety).toBe(false);
  });
});

describe("replayStashedWeeklyPlan — insert conflict recovery preserves reassert staleSafety (I-1)", () => {
  it("keeps staleSafety: true after insert-conflict recovery when the stash re-assert had failed", async () => {
    // 保証フレーズ検査で再 assert を失敗させる（staleSafety = true, validatedFingerprint = null）。
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
            request_id: "21212121-2121-4212-8212-212121212121",
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
              request_id: "21212121-2121-4212-8212-212121212121",
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
      throw new Error(`unexpected rpc: ${name}`);
    });

    // 再取得で見つかる「勝者の行」の指紋を、現行条件の指紋と一致させる。
    // buildResultFromRow は指紋比較だけで staleSafety を再計算するため、これだけだと
    // false になってしまう（= I-1 の主眼: 再 assert 失敗の true が握りつぶされていないか）。
    const currentSafetyFingerprint = createCurrentSafetyFingerprint({
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
      allergenDictionary: { version: "test", catalog: [], aliases: [] },
      foodSafetyRules: [],
    });

    let weeklyPlansCallCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        weeklyPlansCallCount += 1;
        if (weeklyPlansCallCount === 1) {
          // insert → unique 制約違反を模した失敗。
          return thenableQuery({ data: null, error: { message: "duplicate key" } });
        }
        // 再取得 → 同時実行の勝者が既に保存した行（指紋は現行条件と一致させておく）。
        return thenableQuery({
          data: {
            id: "22222222-2222-4222-8222-222222222299",
            week_start: "2026-09-07",
            preference_snapshot: {
              targetMemberIds: [sampleMemberId],
              cuisineGenre: "japanese",
              budgetPreference: null,
              noveltyPreference: null,
            },
            safety_fingerprint: currentSafetyFingerprint,
            days: sampleAiMenu().days,
          },
          error: null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(result.staleSafety).toBe(true);
  });
});

describe("replayStashedWeeklyPlan — insert conflict recovery finds no row rethrows the original error (M-3)", () => {
  it("rethrows weekly_plan_persist_failed (500) when the recovery re-select also finds nothing", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "27272727-2727-4272-8272-272727272727",
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
              request_id: "27272727-2727-4272-8272-272727272727",
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
      throw new Error(`unexpected rpc: ${name}`);
    });

    let weeklyPlansCallCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        weeklyPlansCallCount += 1;
        if (weeklyPlansCallCount === 1) {
          return thenableQuery({ data: null, error: { message: "duplicate key" } });
        }
        // 復元用の再取得も見つからない（勝者が別要因で失敗した等）→ 元の insert エラーを再送出。
        return thenableQuery({ data: null, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(runWeeklyPlan(baseDeps(), sampleRequest())).rejects.toMatchObject({
      status: 500,
      code: "weekly_plan_persist_failed",
    });
  });
});

describe("replaySucceededWeeklyPlan — concurrent insert conflict recovers the winner's row (P3 advレビュー修正C)", () => {
  it("returns 200 with the existing row's weeklyPlanId when insert fails and a concurrent winner already saved it", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "19191919-1919-4191-8191-191919191919",
            idempotency_key: "k1",
            status: "succeeded",
            result: sampleAiMenu(),
          },
          error: null,
        });
      }
      if (name === "get_weekly_plan_intent") {
        return Promise.resolve({
          data: [
            {
              request_id: "19191919-1919-4191-8191-191919191919",
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
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });

    let weeklyPlansCallCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        weeklyPlansCallCount += 1;
        if (weeklyPlansCallCount === 1) {
          // 1回目: request_id で既存行チェック → まだ無い。
          return thenableQuery({ data: null, error: null });
        }
        if (weeklyPlansCallCount === 2) {
          // 2回目: insert → unique 制約違反を模した失敗（エラーコードには依存しない実装）。
          return thenableQuery({ data: null, error: { message: "duplicate key" } });
        }
        // 3回目: 再取得 → 同時実行の勝者が既に保存した行が見つかる。
        return thenableQuery({
          data: {
            id: "20202020-2020-4202-8202-202020202020",
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
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await runWeeklyPlan(baseDeps(), sampleRequest());

    expect(result.weeklyPlanId).toBe("20202020-2020-4202-8202-202020202020");
    expect(rpcNames()).not.toContain("reserve_flyer_weekly");
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

describe("runWeeklyPlan — lookup hit without a valid stashed result must not replay (P2 fix2 負側)", () => {
  it("does not enter replayStashedWeeklyPlan when the lookup hit's result is null (concurrent in-progress request)", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "15151515-1515-4151-8151-151515151515",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: null,
          },
          error: null,
        });
      }
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "15151515-1515-4151-8151-151515151515",
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

    expect(rpcNames()).toContain("reserve_flyer_weekly");
    expect(rpcNames()).not.toContain("get_weekly_plan_intent");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
  });

  it("does not enter replayStashedWeeklyPlan when the lookup hit's result fails weeklyPlanAiMenuSchema", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "16161616-1616-4161-8161-161616161616",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            // days が7件必須（weeklyPlanResultSchema/weeklyPlanAiObjectSchema, shared/contracts/weekly-plan.ts）
            // のスキーマ違反値。safeParse が false になることを狙った不正 result。
            result: { days: [] },
          },
          error: null,
        });
      }
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "16161616-1616-4161-8161-161616161616",
            idempotency_key: "k1",
            status: "processing",
            replayed: true,
            week_start: "2026-09-07",
            result: { days: [] },
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

    expect(rpcNames()).toContain("reserve_flyer_weekly");
    expect(rpcNames()).not.toContain("get_weekly_plan_intent");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
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

describe("runWeeklyPlan — idempotency key namespace is separated from flyer (F11)", () => {
  it("prefixes p_idempotency_key with wp: for both lookup_flyer_weekly and reserve_flyer_weekly", async () => {
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

    const request = sampleRequest();
    await runWeeklyPlan(baseDeps({ openRouterSender: sender }), request);

    const namespaced = `wp:${request.idempotencyKey}`;
    expect(rpcArgsFor("lookup_flyer_weekly")).toMatchObject({
      p_idempotency_key: namespaced,
    });
    expect(rpcArgsFor("reserve_flyer_weekly")).toMatchObject({
      p_idempotency_key: namespaced,
    });
    // 生値がそのまま渡っていないこと（チラシ側の名前空間と構造的に一致しない）
    expect(rpcArgsFor("lookup_flyer_weekly")?.p_idempotency_key).not.toBe(request.idempotencyKey);
    expect(rpcArgsFor("reserve_flyer_weekly")?.p_idempotency_key).not.toBe(request.idempotencyKey);
  });
});

describe("runWeeklyPlan — post-generation inspection failure (A-M1)", () => {
  it("keeps safety_context_failed as 500 after mark instead of mapping it to invalid_ai_response", async () => {
    let safetyCallCount = 0;
    vi.mocked(loadCurrentSafetyContext).mockImplementation(() => {
      safetyCallCount += 1;
      if (safetyCallCount >= 4) {
        return Promise.reject(
          new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした"),
        );
      }
      return Promise.resolve({
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
        allergenDictionary: { version: "test", catalog: [], aliases: [] },
        foodSafetyRules: [],
      });
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "55555555-5555-4555-8555-555555555555",
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
        return Promise.resolve({ data: { sent: true }, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        return thenableQuery({ data: null, error: null });
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
    ).rejects.toMatchObject({
      status: 500,
      code: "safety_context_failed",
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_request_id: "55555555-5555-4555-8555-555555555555",
      p_failure_code: "safety_context_failed",
      p_sent: true,
    });
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
