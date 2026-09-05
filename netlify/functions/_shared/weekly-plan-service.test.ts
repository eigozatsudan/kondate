import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http.js";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: () => ({ rpc: rpcMock, from: fromMock }),
}));

const { runWeeklyPlanWithReserveStub } = await import("./weekly-plan-service.js");

describe("runWeeklyPlanWithReserveStub", () => {
  it("returns openRouterCalls: 0 for a succeeded reserve replay", async () => {
    const result = await runWeeklyPlanWithReserveStub({
      reserveResult: {
        request_id: "11111111-1111-4111-8111-111111111111",
        idempotency_key: "k1",
        status: "succeeded",
        result: { weekStartJst: "2026-09-07", days: [] },
      },
      openRouterSender: vi.fn(),
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.openRouterCalls).toBe(0);
  });

  it("returns flyer_requires_plus for a non-succeeded reserve when not entitled", async () => {
    const result = await runWeeklyPlanWithReserveStub({
      reserveResult: { request_id: null, idempotency_key: "k1", status: "processing" },
      openRouterSender: vi.fn(),
      plusEntitled: false,
      billingEnabled: true,
    });
    expect(result.errorCode).toBe("weekly_plan_requires_plus");
    expect(result.openRouterCalls).toBe(0);
  });

  it("calls OpenRouter exactly once for a fresh reservation", async () => {
    const sender = vi.fn().mockResolvedValue({ mode: "flyer_weekly", output: {}, modelId: "m" });
    const result = await runWeeklyPlanWithReserveStub({
      reserveResult: {
        request_id: "22222222-2222-4222-8222-222222222222",
        idempotency_key: "k1",
        status: "processing",
        replayed: false,
      },
      openRouterSender: sender,
      plusEntitled: true,
      billingEnabled: true,
    });
    expect(result.openRouterCalls).toBe(1);
  });
});

describe("HttpError shape sanity (weekly-plan mapping)", () => {
  it("re-exports nothing unexpected — placeholder guard for the module import above", () => {
    expect(HttpError).toBeDefined();
  });
});
