import { beforeEach, describe, expect, it, vi } from "vitest";

const runWeeklyPlanMock = vi.fn();
const getWeeklyPlanMock = vi.fn();
const requireUserMock = vi.fn();
const requireUserWithEmailMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../_shared/weekly-plan-service.js", () => ({
  runWeeklyPlan: runWeeklyPlanMock,
  getWeeklyPlan: getWeeklyPlanMock,
}));
vi.mock("../_shared/auth.js", () => ({
  requireUser: requireUserMock,
  requireUserWithEmail: requireUserWithEmailMock,
}));
vi.mock("../_shared/supabase-admin.js", () => ({ getSupabaseAdmin: () => ({}) }));

const handler = (await import("../weekly-plan.js")).default;
const { config } = await import("../weekly-plan.js");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/weekly-plan", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  targetMemberIds: ["22222222-2222-4222-8222-222222222222"],
  cuisineGenre: "japanese",
  budgetPreference: null,
  noveltyPreference: null,
};

describe("POST /api/weekly-plan", () => {
  it("uses requireUserWithEmail (identity-quota path)", async () => {
    requireUserWithEmailMock.mockResolvedValue({
      userId: "u1",
      accessToken: "tok",
      email: "u1@example.com",
    });
    runWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
      weekStartJst: "2026-09-07",
      days: [],
      targetMemberIds: validBody.targetMemberIds,
      cuisineGenre: "japanese",
      partialHousehold: false,
      staleSafety: false,
    });
    const response = await handler(postRequest(validBody));
    expect(response.status).toBe(200);
    expect(requireUserWithEmailMock).toHaveBeenCalledTimes(1);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400 before touching the service", async () => {
    requireUserWithEmailMock.mockResolvedValue({
      userId: "u1",
      accessToken: "tok",
      email: "u1@example.com",
    });
    const request = new Request("http://localhost/api/weekly-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const response = await handler(request);
    expect(response.status).toBe(400);
    expect(runWeeklyPlanMock).not.toHaveBeenCalled();
  });

  it("replays the same idempotencyKey without a new service call shape change", async () => {
    requireUserWithEmailMock.mockResolvedValue({
      userId: "u1",
      accessToken: "tok",
      email: "u1@example.com",
    });
    runWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
      weekStartJst: "2026-09-07",
      days: [],
      targetMemberIds: validBody.targetMemberIds,
      cuisineGenre: "japanese",
      partialHousehold: false,
      staleSafety: true,
    });
    const response = await handler(postRequest(validBody));
    expect(response.status).toBe(200);
    // live 慣習（auth-continuation-create.test.ts）に合わせて unknown で受け、
    // 明示的に絞る。素の payload.data.* は strictTypeChecked の
    // no-unsafe-member-access / TS18046 で lint か typecheck が落ちる。
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({ data: { staleSafety: true } });
  });

  it("has the same rate limit config as flyer-weekly.ts", () => {
    expect(config.rateLimit).toEqual({ windowLimit: 20, windowSize: 180, aggregateBy: ["ip"] });
  });
});

describe("GET /api/weekly-plan/:weeklyPlanId", () => {
  it("uses requireUser (JWT only, no email normalization needed)", async () => {
    requireUserMock.mockResolvedValue({ userId: "u1", accessToken: "tok" });
    getWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
      weekStartJst: "2026-09-07",
      days: [],
      targetMemberIds: [],
      cuisineGenre: "japanese",
      partialHousehold: false,
      staleSafety: false,
    });
    const request = new Request(
      "http://localhost/api/weekly-plan/33333333-3333-4333-8333-333333333333",
      { method: "GET" },
    );
    const response = await handler(request);
    expect(response.status).toBe(200);
    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(requireUserWithEmailMock).not.toHaveBeenCalled();
  });
});
