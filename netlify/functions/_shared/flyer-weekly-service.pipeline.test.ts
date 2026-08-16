import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import type { WeeklyFlyerMenu } from "../../../shared/contracts/flyer-weekly.js";
import type { Entitlement } from "./billing-entitlement.js";
import { HttpError } from "./http.js";
import { OpenRouterCallError, type OpenRouterGenerationResult } from "./openrouter.js";

const acceptConsent = (): Promise<void> => Promise.resolve();
const acceptModelPolicy = (): Promise<void> => Promise.resolve();

function rpcCallName(call: unknown): string {
  if (!Array.isArray(call)) return "";
  const name: unknown = call.at(0);
  return typeof name === "string" ? name : "";
}

function rpcCallArgs(call: unknown): unknown {
  if (!Array.isArray(call)) return undefined;
  return call.at(1);
}

function rpcNames(): string[] {
  return rpcMock.mock.calls.map((call) => rpcCallName(call));
}

function rpcArgsFor(name: string): unknown {
  const found = rpcMock.mock.calls.find((call) => rpcCallName(call) === name);
  return found === undefined ? undefined : rpcCallArgs(found);
}

const {
  getServerEnvMock,
  loadEntitlementMock,
  prepareFlyerImageMock,
  loadCurrentSafetyContextMock,
  rpcMock,
  fromMock,
} = vi.hoisted(() => ({
  getServerEnvMock: vi.fn(),
  loadEntitlementMock: vi.fn(),
  prepareFlyerImageMock: vi.fn(),
  loadCurrentSafetyContextMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
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

import { runFlyerWeekly } from "./flyer-weekly-service.js";

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

function sampleMenu(): WeeklyFlyerMenu {
  return {
    weekStartJst: "2026-07-27",
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: `Day${String(index + 1)}`,
      mainName: "野菜炒め",
      sideName: "味噌汁",
      ingredients: ["キャベツ", "にんじん"],
      notes: null,
    })),
  };
}

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

function mockInspectionQueries(options?: {
  completeError?: { message: string };
  draftError?: { message: string };
  allergyError?: { message: string };
}) {
  const complete = thenableQuery(
    options?.completeError !== undefined
      ? { data: null, error: options.completeError }
      : { data: [{ id: "55000000-0000-4000-8000-000000000001" }], error: null },
  );
  const draft = thenableQuery(
    options?.draftError !== undefined
      ? { data: null, error: options.draftError }
      : { data: [], error: null },
  );
  const allergies = thenableQuery(
    options?.allergyError !== undefined
      ? { data: null, error: options.allergyError }
      : { data: [], error: null },
  );
  fromMock.mockImplementation((table: string) => {
    if (table === "member_allergies") return allergies;
    // complete / draft は eq("status", ...) で分岐。pre-mark と persist 前で 2 回呼ばれる。
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
  prepareFlyerImageMock.mockResolvedValue({
    mediaType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,QQ==",
    width: 100,
    height: 100,
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
  mockInspectionQueries();
});

describe("runFlyerWeekly pipeline (PE1/PE2/PE4/PE5/PE6/PE11)", () => {
  it("PE1: fails unconfirmed allergy before mark and OpenRouter (p_sent false)", async () => {
    loadCurrentSafetyContextMock.mockResolvedValue(
      makeCurrentSafetyContext({
        members: [
          {
            ...makeCurrentSafetyContext().members[0]!,
            householdMemberId: "55000000-0000-4000-8000-000000000001",
            allergyStatus: "unconfirmed",
            allergenIds: [],
            customAllergies: [],
          },
        ],
      }),
    );
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000001",
            idempotency_key: "idem-pe1",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender,
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe1",
      ),
    ).rejects.toMatchObject({ status: 422, code: "allergy_unconfirmed" });

    expect(rpcNames()).toContain("reserve_flyer_weekly");
    expect(rpcNames()).toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_sent: false,
      p_failure_code: "allergy_unconfirmed",
    });
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE11: rejects cut_small before mark so try is not consumed", async () => {
    loadCurrentSafetyContextMock.mockResolvedValue(
      makeCurrentSafetyContext({
        members: [
          {
            ...makeCurrentSafetyContext().members[0]!,
            householdMemberId: "55000000-0000-4000-8000-000000000001",
            ageBand: "age_3_5",
            allergyStatus: "none",
            allergenIds: [],
            customAllergies: [],
            requiredSafetyConstraints: ["cut_small"],
          },
        ],
      }),
    );
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000001",
            idempotency_key: "idem-pe11-cut",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender,
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe11-cut",
      ),
    ).rejects.toMatchObject({ status: 422, code: "current_safety_revalidation_required" });

    expect(rpcNames()).toContain("reserve_flyer_weekly");
    expect(rpcNames()).toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_sent: false,
      p_failure_code: "current_safety_revalidation_required",
    });
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE2: replays succeeded ledger before Plus 403 without calling reserve", async () => {
    loadEntitlementMock.mockResolvedValue(freeEntitlement);
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            kind: "hit",
            request_id: "00000000-0000-4000-8000-000000000099",
            idempotency_key: "idem-pe2",
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
        assertPrivacyConsent: acceptConsent,
      },
      new Uint8Array([1, 2, 3]),
      "idem-pe2",
    );
    expect(result.menu.days).toHaveLength(7);
    expect(result.requestId).toBe("00000000-0000-4000-8000-000000000099");
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
  });

  it("PE7: succeeded replay without weekStartJst is 400 internal_error", async () => {
    loadEntitlementMock.mockResolvedValue(freeEntitlement);
    const menuWithoutWeekStart = { days: sampleMenu().days };
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            kind: "hit",
            request_id: "00000000-0000-4000-8000-000000000099",
            idempotency_key: "idem-pe7",
            status: "succeeded",
            result: menuWithoutWeekStart,
            replayed: true,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe7",
      ),
    ).rejects.toMatchObject({ status: 400, code: "internal_error" });
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
  });

  it("PE2: 403s a miss without creating a new reserve", async () => {
    loadEntitlementMock.mockResolvedValue(freeEntitlement);
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
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe2-miss",
      ),
    ).rejects.toMatchObject({ status: 403, code: "flyer_requires_plus" });
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
  });

  it("PE-R2: empty image still replays succeeded lookup when server is Plus", async () => {
    // UI 失効面の画像なし再 POST が、サーバ Plus のまま空バイト検証へ落ちないこと。
    loadEntitlementMock.mockResolvedValue(plusEntitlement);
    prepareFlyerImageMock.mockImplementation(() => {
      throw new Error("empty image must not reach prepareFlyerImage");
    });
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
        assertPrivacyConsent: acceptConsent,
      },
      new Uint8Array(0),
      "idem-pe-r2",
    );
    expect(result.menu.days).toHaveLength(7);
    expect(result.requestId).toBe("00000000-0000-4000-8000-000000000099");
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
    expect(prepareFlyerImageMock).not.toHaveBeenCalled();
  });

  it("PE-R2: Plus + empty image without succeeded lookup is 400 without reserve", async () => {
    loadEntitlementMock.mockResolvedValue(plusEntitlement);
    prepareFlyerImageMock.mockImplementation(() => {
      throw new Error("empty image must not reach prepareFlyerImage");
    });
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
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array(0),
        "idem-pe-r2-miss",
      ),
    ).rejects.toMatchObject({ status: 400, code: "flyer_invalid_image" });
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
    expect(prepareFlyerImageMock).not.toHaveBeenCalled();
  });

  it("PE4: draft household_members DB error is 500 safety_context_failed", async () => {
    mockInspectionQueries({ draftError: { message: "db down" } });
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000005",
            idempotency_key: "idem-pe4",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe4",
      ),
    ).rejects.toMatchObject({ status: 500, code: "safety_context_failed" });
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_sent: false,
      p_failure_code: "safety_context_failed",
    });
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
  });

  it("PE5: ensure model policy failure finalizes unsent and skips mark", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000002",
            idempotency_key: "idem-pe5",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender,
          assertPrivacyConsent: acceptConsent,
          ensureOpenRouterModelPolicy: () =>
            Promise.reject(new OpenRouterCallError("model_unavailable")),
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe5",
      ),
    ).rejects.toMatchObject({ status: 503, code: "model_unavailable" });

    expect(rpcNames()).toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
    expect(rpcArgsFor("finalize_flyer_weekly_failure")).toMatchObject({
      p_sent: false,
      p_failure_code: "model_unavailable",
    });
    expect(openRouterSender).not.toHaveBeenCalled();
  });

  it("PE11: does not return 200 when finalize success RPC fails after stash", async () => {
    // PE6: 検証済み本文は stash して残す。PE11: success 未計上の 200 は禁止。
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000003",
            idempotency_key: "idem-pe11",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      if (name === "mark_flyer_weekly_sent") {
        return Promise.resolve({ data: { sent: true }, error: null });
      }
      if (name === "finalize_flyer_weekly_success") {
        return Promise.resolve({
          data: null,
          error: { message: "flyer_success_reservation_corrupt" },
        });
      }
      if (name === "stash_flyer_weekly_result") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: () =>
            Promise.resolve({
              mode: "flyer_weekly",
              output: sampleMenu(),
              modelId: "mock/flyer:free",
            } satisfies OpenRouterGenerationResult),
          assertPrivacyConsent: acceptConsent,
          ensureOpenRouterModelPolicy: acceptModelPolicy,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe11",
      ),
    ).rejects.toMatchObject({ status: 500, code: "internal_error" });

    expect(rpcNames()).toContain("stash_flyer_weekly_result");
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
    const stashArgs = rpcArgsFor("stash_flyer_weekly_result");
    expect(stashArgs).toMatchObject({
      p_request_id: "00000000-0000-4000-8000-000000000003",
    });
    expect(
      typeof stashArgs === "object" &&
        stashArgs !== null &&
        "p_result" in stashArgs &&
        typeof stashArgs.p_result === "object" &&
        stashArgs.p_result !== null &&
        "weekStartJst" in stashArgs.p_result &&
        stashArgs.p_result.weekStartJst === "2026-07-27",
    ).toBe(true);
  });

  it("PE11: same-key processing replay with stashed result retries finalize only", async () => {
    const openRouterSender = vi.fn(() => Promise.reject(new Error("should not be called")));
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000013",
            idempotency_key: "idem-pe11-replay",
            status: "processing",
            replayed: true,
            week_start: "2026-07-27",
            result: sampleMenu(),
          },
          error: null,
        });
      }
      if (name === "finalize_flyer_weekly_success") {
        return Promise.resolve({
          data: { status: "succeeded" },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    const result = await runFlyerWeekly(
      {
        user,
        openRouterSender,
        assertPrivacyConsent: acceptConsent,
        ensureOpenRouterModelPolicy: acceptModelPolicy,
      },
      new Uint8Array([1, 2, 3]),
      "idem-pe11-replay",
    );
    expect(result.menu.days).toHaveLength(7);
    expect(result.menu.weekStartJst).toBe("2026-07-27");
    expect(result.requestId).toBe("00000000-0000-4000-8000-000000000013");
    expect(openRouterSender).not.toHaveBeenCalled();
    expect(rpcNames()).toContain("finalize_flyer_weekly_success");
    expect(rpcNames()).not.toContain("mark_flyer_weekly_sent");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
  });

  it("PE3: succeeded replay rejects guarantee phrases without persisting", async () => {
    loadEntitlementMock.mockResolvedValue(freeEntitlement);
    const guaranteed = sampleMenu();
    guaranteed.days[0] = { ...guaranteed.days[0]!, mainName: "安全です煮" };
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly") {
        return Promise.resolve({
          data: {
            kind: "hit",
            request_id: "00000000-0000-4000-8000-000000000099",
            idempotency_key: "idem-pe3-replay",
            status: "succeeded",
            result: guaranteed,
            replayed: true,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe3-replay",
      ),
    ).rejects.toMatchObject({ status: 400, code: "flyer_invalid_ai_response" });
    expect(rpcNames()).toEqual(["lookup_flyer_weekly"]);
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_failure");
  });

  it("PE3: processing stash replay rejects guarantee phrases", async () => {
    const guaranteed = sampleMenu();
    guaranteed.days[0] = { ...guaranteed.days[0]!, mainName: "アレルギーでも安心チキン" };
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000014",
            idempotency_key: "idem-pe3-stash",
            status: "processing",
            replayed: true,
            week_start: "2026-07-27",
            result: guaranteed,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: vi.fn(() => Promise.reject(new Error("should not be called"))),
          assertPrivacyConsent: acceptConsent,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe3-stash",
      ),
    ).rejects.toMatchObject({ status: 400, code: "flyer_invalid_ai_response" });
    expect(rpcNames()).toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
  });

  it("PE3: does not persist a menu that contains a guarantee phrase", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "00000000-0000-4000-8000-000000000004",
            idempotency_key: "idem-pe3",
            status: "processing",
            replayed: false,
            week_start: "2026-07-27",
          },
          error: null,
        });
      }
      if (name === "mark_flyer_weekly_sent") {
        return Promise.resolve({ data: { sent: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const guaranteed = sampleMenu();
    guaranteed.days[0] = { ...guaranteed.days[0]!, mainName: "安全です煮" };

    await expect(
      runFlyerWeekly(
        {
          user,
          openRouterSender: () =>
            Promise.resolve({
              mode: "flyer_weekly",
              output: guaranteed,
              modelId: "mock/flyer:free",
            } satisfies OpenRouterGenerationResult),
          assertPrivacyConsent: acceptConsent,
          ensureOpenRouterModelPolicy: acceptModelPolicy,
        },
        new Uint8Array([1, 2, 3]),
        "idem-pe3",
      ),
    ).rejects.toMatchObject({ status: 400, code: "flyer_invalid_ai_response" });

    expect(rpcNames()).toContain("finalize_flyer_weekly_failure");
    expect(rpcNames()).not.toContain("finalize_flyer_weekly_success");
  });
});

describe("HttpError mapping", () => {
  it("does not treat safety_context_failed as a 400", () => {
    const error = new HttpError(
      500,
      "safety_context_failed",
      "現在の安全条件を読み込めませんでした",
    );
    expect(error.status).toBe(500);
  });
});
