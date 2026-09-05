import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  FUNCTION_TOTAL_BUDGET_MS,
  GENERATION_POST_CLIENT_TIMEOUT_MS,
} from "@shared/contracts/function-budget";
import {
  postWeeklyPlan,
  getWeeklyPlanById,
  WeeklyPlanApiError,
  WEEKLY_PLAN_CLIENT_TIMEOUT_MS,
} from "./weekly-plan-api.js";

// weeklyPlanResultSchema.days は .length(7)。postWeeklyPlan / getWeeklyPlanById が
// 内部で parse するため、fixture は必ず 7 日ぶん埋める（.length(7) は緩めない）。
const sampleDays = Array.from({ length: 7 }, (_, index) => ({
  dayIndex: index + 1,
  label: `${String(index + 1)}日目`,
  mainName: "肉じゃが",
  ingredients: ["じゃがいも", "牛肉"],
}));

const sampleResult = {
  weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  weekStartJst: "2026-09-07",
  days: sampleDays,
  targetMemberIds: [],
  cuisineGenre: "japanese",
  partialHousehold: false,
  staleSafety: false,
};

describe("postWeeklyPlan", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, data: sampleResult }), { status: 200 }),
        ),
    );
  });

  it("sends a POST with the Authorization header and JSON body", async () => {
    await postWeeklyPlan("tok", {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
      cuisineGenre: "japanese",
      budgetPreference: null,
      noveltyPreference: null,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("throws a WeeklyPlanApiError with the server's issue code on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "weekly_plan_requires_plus", message: "Plus限定です" },
          }),
          { status: 403 },
        ),
      ),
    );
    const promise = postWeeklyPlan("tok", {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
      cuisineGenre: "japanese",
      budgetPreference: null,
      noveltyPreference: null,
    });
    await expect(promise).rejects.toBeInstanceOf(WeeklyPlanApiError);
    await expect(promise).rejects.toMatchObject({ code: "weekly_plan_requires_plus", status: 403 });
  });
});

describe("POST abort timeout must stay outside the server budget (P2 fix B)", () => {
  it("uses a POST abort ceiling larger than the GET ceiling and the server's total budget", () => {
    // 数値リテラルでは書かない。POST は GENERATION_POST_CLIENT_TIMEOUT_MS
    // （FUNCTION_TOTAL_BUDGET_MS + headroom, shared/contracts/function-budget.ts 由来）を
    // 使うべきで、GET 用の WEEKLY_PLAN_CLIENT_TIMEOUT_MS（30s 固定）より短くなってはいけない。
    // これが崩れると、サーバが finalize/insert を完了しているのに POST が先に abort し、
    // クライアント側だけ失敗扱いになる（Plus の週次成功枠は限られているため実害が出る）。
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeGreaterThan(WEEKLY_PLAN_CLIENT_TIMEOUT_MS);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeGreaterThan(FUNCTION_TOTAL_BUDGET_MS);
  });
});

describe("POST/GET actually wire AbortSignal.timeout to the intended ceiling (I-3)", () => {
  // I-3: 上の定数比較テストは GENERATION_POST_CLIENT_TIMEOUT_MS > WEEKLY_PLAN_CLIENT_TIMEOUT_MS
  // という定数同士の関係しか見ておらず、postWeeklyPlan / getWeeklyPlanById が実際にどちらを
  // fetch の signal に渡しているかは検証していなかった（配線ミスがあっても検出できない）。
  // AbortSignal は組み込みオブジェクトなので vi.spyOn は禁止対象外
  // （ESM 名前空間スパイのみ禁止。built-in へのスパイは許可）。
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("postWeeklyPlan calls AbortSignal.timeout with GENERATION_POST_CLIENT_TIMEOUT_MS", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, data: sampleResult }), { status: 200 }),
        ),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await postWeeklyPlan("tok", {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
      cuisineGenre: "japanese",
      budgetPreference: null,
      noveltyPreference: null,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(GENERATION_POST_CLIENT_TIMEOUT_MS);
  });

  it("getWeeklyPlanById calls AbortSignal.timeout with WEEKLY_PLAN_CLIENT_TIMEOUT_MS", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, data: sampleResult }), { status: 200 }),
        ),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await getWeeklyPlanById("tok", "33333333-3333-4333-8333-333333333333");

    expect(timeoutSpy).toHaveBeenCalledWith(WEEKLY_PLAN_CLIENT_TIMEOUT_MS);
  });
});

describe("getWeeklyPlanById", () => {
  it("sends a GET with the id in the path", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, data: sampleResult }), { status: 200 }),
        ),
    );
    const result = await getWeeklyPlanById("tok", "33333333-3333-4333-8333-333333333333");
    expect(result.weeklyPlanId).toBe(sampleResult.weeklyPlanId);
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain("/api/weekly-plan/33333333-3333-4333-8333-333333333333");
  });
});
