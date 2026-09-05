import { describe, expect, it, vi, beforeEach } from "vitest";
import { postWeeklyPlan, getWeeklyPlanById, WeeklyPlanApiError } from "./weekly-plan-api.js";

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
