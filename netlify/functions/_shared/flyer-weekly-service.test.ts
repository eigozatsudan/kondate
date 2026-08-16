import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flyerWeeklyIssueMessages,
  type WeeklyFlyerMenu,
} from "../../../shared/contracts/flyer-weekly.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import {
  appendDraftMemberAllergiesForFlyerInspection,
  assertFlyerMenuAgainstSafety,
  assertFlyerMenuHasNoGuaranteePhrases,
  assertFlyerMenuSafe,
  assertFlyerPrivacyConsent,
  isFlyerPlusAllowed,
  jstWeekStartMonday,
  loadFlyerInspectionSafety,
  runFlyerWeekly,
  runFlyerWeeklyWithReserveStub,
} from "./flyer-weekly-service.js";
import type { Entitlement } from "./billing-entitlement.js";
import { HttpError } from "./http.js";
import { createUserScopedSupabase } from "./supabase-user.js";

const {
  getServerEnvMock,
  loadEntitlementMock,
  rpcMock,
  fromMock,
  prepareFlyerImageMock,
  loadCurrentSafetyContextMock,
} = vi.hoisted(() => ({
  getServerEnvMock: vi.fn(),
  loadEntitlementMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  prepareFlyerImageMock: vi.fn(),
  loadCurrentSafetyContextMock: vi.fn(),
}));

vi.mock("./supabase-user.js", () => ({
  createUserScopedSupabase: vi.fn(),
}));
vi.mock("./env.js", () => ({ getServerEnv: getServerEnvMock }));
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("./billing-entitlement.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-entitlement.js")>();
  return { ...actual, loadEntitlement: loadEntitlementMock };
});
vi.mock("./flyer-image.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./flyer-image.js")>();
  return { ...actual, prepareFlyerImage: prepareFlyerImageMock };
});
vi.mock("./current-safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./current-safety.js")>();
  return { ...actual, loadCurrentSafetyContext: loadCurrentSafetyContextMock };
});

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

  it("PE2: replays terminal succeeded ledger even when Plus is lost", async () => {
    // 新規 reserve は 403 のまま。既 succeeded の同一キーだけ Plus 短絡を越えて再生する。
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "succeeded",
        result: sampleMenu(),
        replayed: true,
      },
      openRouterSender,
      plusEntitled: false,
      billingEnabled: true,
    });
    expect(result.errorCode).toBeUndefined();
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE2: kill switch still 403s a fresh processing reserve (no new send)", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
        replayed: false,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: false,
    });
    expect(result.errorCode).toBe("flyer_requires_plus");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
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

  it("PE11: processing + replayed + stashed result is finalize-only (no OpenRouter)", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "processing",
        replayed: true,
        result: sampleMenu(),
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBeUndefined();
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

  it("PE1: failed generation_timeout is terminal replay without OpenRouter", async () => {
    // cleanup→failed 後の同一 key は failed 再生のみ（reopen なし）。クライアント sticky clear と対。
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "failed",
        failure_code: "generation_timeout",
        replayed: true,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("generation_timeout");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE13: succeeded with null result does not enter mark/OpenRouter", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "succeeded",
        result: null,
        replayed: true,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("internal_error");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE13: succeeded with corrupt result does not enter mark/OpenRouter", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "succeeded",
        // days 欠落など Zod 非適合
        result: { weekStartJst: "2026-07-27" },
        replayed: true,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("internal_error");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE7: succeeded replay without weekStartJst is fail-closed", async () => {
    // weeklyFlyerMenuSchema は weekStartJst 任意。再生は Result 必須で閉じる。
    const menuWithoutWeekStart = { days: sampleMenu().days };
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    const result = await runFlyerWeeklyWithReserveStub({
      reserveResult: {
        request_id: "00000000-0000-4000-8000-000000000001",
        idempotency_key: "k",
        status: "succeeded",
        result: menuWithoutWeekStart,
        replayed: true,
      },
      openRouterSender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("internal_error");
    expect(result.openRouterCalls).toBe(0);
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE11: flyer_invalid_ai_response discloses try may be consumed", () => {
    expect(flyerWeeklyIssueMessages.flyer_invalid_ai_response).toContain("試行回数");
  });

  it("blocks flyer when only stale kill_source would have granted plus (B2)", () => {
    const killMasked: Entitlement = {
      plan: "free",
      status: "unpaid",
      plusEntitled: false,
      pastDueGrace: false,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEnd: null,
      dbPlusEntitled: false,
      killSourceStatus: "active",
    };
    expect(killMasked.plusEntitled).toBe(false);
    expect(isFlyerPlusAllowed(killMasked, true)).toBe(false);
    expect(isFlyerPlusAllowed(killMasked, false)).toBe(false);
  });

  it("still blocks flyer when restore cannot grant plus (B-R2)", () => {
    const freeEntitlement: Entitlement = {
      plan: "free",
      status: "none",
      plusEntitled: false,
      pastDueGrace: false,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      dbPlusEntitled: false,
    };
    expect(isFlyerPlusAllowed(freeEntitlement, true)).toBe(false);
  });
});

describe("PE-R2 empty-image lookup while Plus", () => {
  const user = {
    userId: "11111111-1111-4111-8111-111111111111",
    email: "plus@example.com",
    accessToken: "token",
  };
  const plusEntitlement: Entitlement = {
    plan: "plus",
    status: "active",
    plusEntitled: true,
    pastDueGrace: false,
    currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    trialEnd: null,
    dbPlusEntitled: true,
  };

  function thenableQuery(result: { data: unknown; error: unknown }) {
    const query: {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
    } = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      in: vi.fn(),
      limit: vi.fn(),
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    return query;
  }

  function rpcNames(): string[] {
    return rpcMock.mock.calls.map((call) => {
      const name: unknown = Array.isArray(call) ? call.at(0) : undefined;
      return typeof name === "string" ? name : "";
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getServerEnvMock.mockReturnValue({
      billingEnabled: true,
      aiQuotaDisabled: false,
      quotaIdentityHmacKey: Buffer.alloc(32, 9),
      openRouter: {
        apiKey: "sk-test",
        baseUrl: "http://127.0.0.1:4010/v1",
        models: ["mock/primary:free"],
        plusModels: ["mock/plus:free"],
        flyerModels: ["mock/flyer:free"],
        timeoutMs: 24_000,
        functionTotalBudgetMs: 55_000,
        globalDailyLimit: 20,
      },
    });
    loadEntitlementMock.mockResolvedValue(plusEntitlement);
    prepareFlyerImageMock.mockImplementation(() => {
      throw new Error("empty image must not reach prepareFlyerImage");
    });
    loadCurrentSafetyContextMock.mockResolvedValue(
      makeCurrentSafetyContext({
        members: [
          {
            ...makeCurrentSafetyContext().members[0]!,
            householdMemberId: "55000000-0000-4000-8000-000000000001",
            allergyStatus: "none",
            allergenIds: [],
            customAllergies: [],
            unsupportedDietStatus: "none",
          },
        ],
      }),
    );
    const complete = thenableQuery({
      data: [{ id: "55000000-0000-4000-8000-000000000001" }],
      error: null,
    });
    const draft = thenableQuery({ data: [], error: null });
    fromMock.mockImplementation(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        in: vi.fn(),
        limit: vi.fn(),
        then: undefined as
          | ((resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>)
          | undefined,
      };
      const self = () => query;
      query.select.mockImplementation(self);
      query.order.mockImplementation(self);
      query.in.mockImplementation(self);
      query.limit.mockImplementation(self);
      query.eq.mockImplementation((_column: string, value: string) => {
        if (value === "complete") {
          query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
        } else if (value === "draft") {
          query.then = (resolve) => Promise.resolve(draft).then((row) => resolve(row));
        }
        return query;
      });
      query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
      return query;
    });
  });

  it("replays succeeded lookup on empty image without prepareFlyerImage", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            kind: "hit",
            request_id: "00000000-0000-4000-8000-000000000099",
            idempotency_key: "idem-pe-r2",
            status: "succeeded",
            result: sampleMenu(),
            replayed: true,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    const result = await runFlyerWeekly(
      {
        user,
        openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
        assertPrivacyConsent: () => Promise.resolve(),
      },
      new Uint8Array(0),
      "idem-pe-r2",
    );
    expect(result.menu.days).toHaveLength(7);
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
    expect(prepareFlyerImageMock).not.toHaveBeenCalled();
  });

  it("returns flyer_invalid_image on Plus empty miss without reserve", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
          assertPrivacyConsent: () => Promise.resolve(),
        },
        new Uint8Array(0),
        "idem-pe-r2-miss",
      ),
    ).rejects.toMatchObject({ status: 400, code: "flyer_invalid_image" });
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
    expect(prepareFlyerImageMock).not.toHaveBeenCalled();
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

describe("loadFlyerInspectionSafety", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  function thenableQuery(result: { data: unknown; error: unknown }) {
    const query: {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
    } = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      in: vi.fn(),
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.in.mockReturnValue(query);
    return query;
  }

  it("PE4: maps household_members DB error to 500 safety_context_failed", async () => {
    const query = thenableQuery({ data: null, error: { message: "connection reset" } });
    const admin = { from: vi.fn(() => query) };
    await expect(loadFlyerInspectionSafety(admin as never, userId)).rejects.toMatchObject({
      status: 500,
      code: "safety_context_failed",
    });
  });

  it("PE11: rejects cut_small on complete members before caller can mark", async () => {
    const complete = thenableQuery({
      data: [{ id: "55000000-0000-4000-8000-000000000001" }],
      error: null,
    });
    const draft = thenableQuery({ data: [], error: null });
    const admin = {
      from: vi.fn(() => {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          in: vi.fn(),
          then: undefined as
            | ((resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>)
            | undefined,
        };
        const self = () => query;
        query.select.mockImplementation(self);
        query.order.mockImplementation(self);
        query.in.mockImplementation(self);
        query.eq.mockImplementation((_column: string, value: string) => {
          if (value === "complete") {
            query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
          } else if (value === "draft") {
            query.then = (resolve) => Promise.resolve(draft).then((row) => resolve(row));
          }
          return query;
        });
        query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
        return query;
      }),
    };
    const base = makeCurrentSafetyContext();
    loadCurrentSafetyContextMock.mockResolvedValue(
      makeCurrentSafetyContext({
        members: [
          {
            ...base.members[0]!,
            householdMemberId: "55000000-0000-4000-8000-000000000001",
            ageBand: "age_3_5",
            allergyStatus: "none",
            allergenIds: [],
            requiredSafetyConstraints: ["cut_small"],
          },
        ],
      }),
    );
    await expect(loadFlyerInspectionSafety(admin as never, userId)).rejects.toMatchObject({
      status: 422,
      code: "current_safety_revalidation_required",
    });
  });

  it("PE-R2: rejects null-age draft tag rules before caller can mark", async () => {
    const complete = thenableQuery({
      data: [{ id: "55000000-0000-4000-8000-000000000001" }],
      error: null,
    });
    const draft = thenableQuery({
      data: [
        {
          id: "55000000-0000-4000-8000-000000000099",
          age_band: null,
          required_safety_constraints: [],
        },
      ],
      error: null,
    });
    const allergies = thenableQuery({
      data: [
        {
          member_id: "55000000-0000-4000-8000-000000000099",
          allergen_id: null,
          custom_name: "ピーナッツ",
          custom_aliases: [],
          custom_confirmed: true,
        },
      ],
      error: null,
    });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "member_allergies") return allergies;
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          in: vi.fn(),
          then: undefined as
            | ((resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>)
            | undefined,
        };
        const self = () => query;
        query.select.mockImplementation(self);
        query.order.mockImplementation(self);
        query.in.mockImplementation(self);
        query.eq.mockImplementation((_column: string, value: string) => {
          if (value === "complete") {
            query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
          } else if (value === "draft") {
            query.then = (resolve) => Promise.resolve(draft).then((row) => resolve(row));
          }
          return query;
        });
        query.then = (resolve) => Promise.resolve(complete).then((row) => resolve(row));
        return query;
      }),
    };
    const base = makeCurrentSafetyContext();
    loadCurrentSafetyContextMock.mockResolvedValue(
      makeCurrentSafetyContext({
        members: [
          {
            ...base.members[0]!,
            householdMemberId: "55000000-0000-4000-8000-000000000001",
            ageBand: "adult",
            allergyStatus: "none",
            allergenIds: [],
            requiredSafetyConstraints: [],
          },
        ],
      }),
    );
    await expect(loadFlyerInspectionSafety(admin as never, userId)).rejects.toMatchObject({
      status: 422,
      code: "current_safety_revalidation_required",
    });
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
    // PE-R1: 年齢未設定 draft は幼児+シニアの2枠。針は先頭だけ。
    expect(inspection.members).toHaveLength(3);
    expect(inspection.members[1]?.allergenIds).toEqual(["egg"]);
    expect(inspection.members[1]?.ageBand).toBe("post_weaning_to_2");
    expect(inspection.members[2]?.ageBand).toBe("senior");
    expect(inspection.members[2]?.allergenIds).toEqual([]);
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "卵焼き" }), inspection);
    }).toThrow(HttpError);
  });

  it("PE3: rejects guarantee phrases in mainName before persist", () => {
    expect(() => {
      assertFlyerMenuHasNoGuaranteePhrases(sampleMenu({ mainName: "アレルギーでも安心チキン" }));
    }).toThrow(HttpError);
    try {
      assertFlyerMenuHasNoGuaranteePhrases(sampleMenu({ mainName: "安全です煮" }));
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "flyer_invalid_ai_response" });
    }
  });

  it("PE3: accepts ordinary names that are not guarantee phrases", () => {
    expect(() => {
      assertFlyerMenuHasNoGuaranteePhrases(sampleMenu());
    }).not.toThrow();
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

  it("PE5: draft age_3_5 without allergens still applies toddler food rules", () => {
    const base = makeCurrentSafetyContext();
    const completeOnly = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          customAllergies: [],
          requiredSafetyConstraints: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "お雑煮（餅入り）" }), completeOnly);
    }).not.toThrow();

    const inspection = appendDraftMemberAllergiesForFlyerInspection(
      completeOnly,
      [],
      [
        {
          id: "55000000-0000-4000-8000-000000000099",
          age_band: "age_3_5",
          required_safety_constraints: [],
        },
      ],
    );
    expect(inspection.members).toHaveLength(2);
    expect(inspection.members[1]?.ageBand).toBe("age_3_5");
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "お雑煮（餅入り）" }), inspection);
    }).toThrow(HttpError);
  });

  it("PE2: draft null age_band with confirmed needles is not treated as adult", () => {
    // complete 成人 + draft（age_band null・確認済み針）を adult 既定にすると餅が通る
    const base = makeCurrentSafetyContext();
    const completeOnly = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          customAllergies: [],
          requiredSafetyConstraints: [],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "お雑煮（餅入り）" }), completeOnly);
    }).not.toThrow();

    const inspection = appendDraftMemberAllergiesForFlyerInspection(
      completeOnly,
      [
        {
          member_id: "55000000-0000-4000-8000-000000000099",
          allergen_id: null,
          custom_name: "ピーナッツ",
          custom_aliases: [],
          custom_confirmed: true,
        },
      ],
      [
        {
          id: "55000000-0000-4000-8000-000000000099",
          age_band: null,
          required_safety_constraints: [],
        },
      ],
    );
    expect(inspection.members).toHaveLength(3);
    expect(inspection.members[1]?.ageBand).not.toBe("adult");
    expect(inspection.members[1]?.ageBand).toBe("post_weaning_to_2");
    expect(inspection.members[2]?.ageBand).toBe("senior");
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "お雑煮（餅入り）" }), inspection);
    }).toThrow(HttpError);
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "ピーナッツ和え" }), inspection);
    }).toThrow(HttpError);
  });

  it("PE-R1: draft null age_band also applies senior hard-food rules", () => {
    // 幼児帯だけだと hard_food_for_senior（根菜 / 硬い）が外れる
    const base = makeCurrentSafetyContext();
    const completeOnly = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          ageBand: "adult",
          allergyStatus: "none",
          allergenIds: [],
          customAllergies: [],
          requiredSafetyConstraints: [],
        },
      ],
    });
    const inspection = appendDraftMemberAllergiesForFlyerInspection(
      completeOnly,
      [
        {
          member_id: "55000000-0000-4000-8000-000000000099",
          allergen_id: null,
          custom_name: "ピーナッツ",
          custom_aliases: [],
          custom_confirmed: true,
        },
      ],
      [
        {
          id: "55000000-0000-4000-8000-000000000099",
          age_band: null,
          required_safety_constraints: [],
        },
      ],
    );
    expect(inspection.members.map((member) => member.ageBand)).toEqual([
      "adult",
      "post_weaning_to_2",
      "senior",
    ]);
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ mainName: "根菜の煮物" }), inspection);
    }).toThrow(HttpError);
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ ingredients: ["硬いごぼう"] }), inspection);
    }).toThrow(HttpError);
  });

  it("PE6: rejects flyer menu when cut_small is required and flyer cannot attach evidence", () => {
    const base = makeCurrentSafetyContext();
    const safety = makeCurrentSafetyContext({
      members: [
        {
          ...base.members[0]!,
          ageBand: "age_3_5",
          allergyStatus: "none",
          allergenIds: [],
          requiredSafetyConstraints: ["cut_small"],
        },
      ],
    });
    expect(() => {
      assertFlyerMenuAgainstSafety(sampleMenu({ ingredients: ["りんご"] }), safety);
    }).toThrow(HttpError);
  });
});
