import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSafeLogger,
  handleGenerationHttpError,
  logGenerationEvent,
  logGenerationHttpBoundary,
  SAFE_LOG_SERIALIZED_KEYS,
} from "./logger.js";
import { HttpError } from "./http.js";

describe("createSafeLogger", () => {
  it("serializes only the approved operational fields", () => {
    const write = vi.fn();
    const logger = createSafeLogger(write);
    logger({
      level: "error",
      requestId: "req-1",
      code: "openrouter_unavailable",
      durationMs: 123,
      modelId: "vendor/model:free",
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "error",
      request_id: "req-1",
      code: "openrouter_unavailable",
      duration_ms: 123,
      model_id: "vendor/model:free",
    });
  });

  it("omits optional fields and maintenance counts when absent", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "req-2",
      code: "succeeded",
      durationMs: 10,
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      request_id: "req-2",
      code: "succeeded",
      duration_ms: 10,
    });
  });

  it("sanitizes maintenance counts like other numeric fields (SC7)", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "maint-bad",
      code: "maintenance_cleanup",
      durationMs: 50,
      staleReservationsFinalized: "canary@example.com" as unknown as number,
      generationLedgersDeleted: Number.NaN,
      shoppingMutationsDeleted: -3.7,
      authContinuationsDeleted: 4.9,
      userFeedbackDeleted: 5,
    });
    const line = write.mock.calls[0]![0] as string;
    expect(line).not.toContain("canary@example.com");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(
      parsed.stale_reservations_finalized === 0 || parsed.stale_reservations_finalized === null,
    ).toBe(true);
    expect(
      parsed.generation_ledgers_deleted === 0 || parsed.generation_ledgers_deleted === null,
    ).toBe(true);
    expect(parsed.shopping_mutations_deleted).toBe(0);
    expect(parsed.auth_continuations_deleted).toBe(4);
    expect(parsed.user_feedback_deleted).toBe(5);
  });

  it("includes maintenance aggregate counts when provided", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "maint-1",
      code: "maintenance_cleanup",
      durationMs: 50,
      staleReservationsFinalized: 1,
      generationLedgersDeleted: 2,
      shoppingMutationsDeleted: 3,
      authContinuationsDeleted: 4,
      userFeedbackDeleted: 5,
      draftSubmissionsDeleted: 6,
      identityLedgersDeleted: 7,
      flyerLedgersDeleted: 8,
      staleShareJobsReaped: 9,
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      request_id: "maint-1",
      code: "maintenance_cleanup",
      duration_ms: 50,
      stale_reservations_finalized: 1,
      generation_ledgers_deleted: 2,
      shopping_mutations_deleted: 3,
      auth_continuations_deleted: 4,
      user_feedback_deleted: 5,
      draft_submissions_deleted: 6,
      identity_ledgers_deleted: 7,
      flyer_ledgers_deleted: 8,
      stale_share_jobs_reaped: 9,
    });
  });

  it("drops unknown sensitive keys that are not on SafeLogEvent", () => {
    const write = vi.fn();
    // 実行時に余剰キーを混ぜても allowlist 以外は出さない（型上は SafeLogEvent に無い）
    createSafeLogger(write)({
      level: "error",
      requestId: "req-3",
      code: "invalid_ai_response",
      durationMs: 1,
      prompt: "secret-prompt",
      allergyDetails: ["egg"],
    } as Parameters<ReturnType<typeof createSafeLogger>>[0] & {
      prompt: string;
      allergyDetails: string[];
    });
    const line = write.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "error",
      request_id: "req-3",
      code: "invalid_ai_response",
      duration_ms: 1,
    });
    expect(line).not.toContain("secret-prompt");
    expect(line).not.toContain("egg");
  });

  it("serializes emergency non-PII audit fields including null matchMode/emptyReason", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "emg-1",
      code: "emergency_menus",
      durationMs: 42,
      path: "household",
      matchMode: "safety_only",
      emptyReason: null,
      candidateCount: 2,
      mealType: "dinner",
      mainIngredientCount: 1,
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      request_id: "emg-1",
      code: "emergency_menus",
      duration_ms: 42,
      path: "household",
      match_mode: "safety_only",
      empty_reason: null,
      candidate_count: 2,
      meal_type: "dinner",
      main_ingredient_count: 1,
    });
  });

  it("serializes share worker opaque jobId / failureCode / sourceCounts only", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "share-worker",
      code: "share_generalize_job_succeeded",
      durationMs: 90,
      jobId: "d1000000-0000-4000-8000-000000000001",
      failureCode: "consent_revoked",
      sourceCounts: { fixture: 3, community: 1 },
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      request_id: "share-worker",
      code: "share_generalize_job_succeeded",
      duration_ms: 90,
      job_id: "d1000000-0000-4000-8000-000000000001",
      failure_code: "consent_revoked",
      source_counts_fixture: 3,
      source_counts_community: 1,
    });
  });

  it("serializes billing non-PII fields and drops email canaries", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "bill-1",
      code: "billing_checkout_created",
      durationMs: 12,
      plan: "plus",
      billingStatus: "active",
      priceInterval: "month",
      qualityMode: true,
      flyer: false,
      stripeCustomerId: "cus_abc",
      stripeSubscriptionId: "sub_xyz",
      alertMetric: 1,
      email: "secret@example.com",
      receiptEmail: "r@example.com",
    } as Parameters<ReturnType<typeof createSafeLogger>>[0] & {
      email: string;
      receiptEmail: string;
    });
    const line = write.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "info",
      request_id: "bill-1",
      code: "billing_checkout_created",
      duration_ms: 12,
      plan: "plus",
      billing_status: "active",
      price_interval: "month",
      quality_mode: 1,
      flyer: 0,
      stripe_customer_id: "cus_abc",
      stripe_subscription_id: "sub_xyz",
      alert_metric: 1,
    });
    expect(line).not.toContain("secret@example.com");
    expect(line).not.toContain("r@example.com");
  });

  it("does not serialize free-text ingredient or allergy keys on emergency events", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "emg-2",
      code: "emergency_menus",
      durationMs: 1,
      path: "idea",
      matchMode: null,
      emptyReason: "no_matching_fixture",
      candidateCount: 0,
      mealType: "lunch",
      mainIngredientCount: 3,
      mainIngredients: ["鶏肉"],
      allergyNames: ["卵"],
    } as Parameters<ReturnType<typeof createSafeLogger>>[0] & {
      mainIngredients: string[];
      allergyNames: string[];
    });
    const line = write.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "info",
      request_id: "emg-2",
      code: "emergency_menus",
      duration_ms: 1,
      path: "idea",
      match_mode: null,
      empty_reason: "no_matching_fixture",
      candidate_count: 0,
      meal_type: "lunch",
      main_ingredient_count: 3,
    });
    expect(line).not.toContain("鶏肉");
    expect(line).not.toContain("卵");
  });
});

describe("logGenerationHttpBoundary", () => {
  it("serializes route and http_status without free-text message", () => {
    const write = vi.fn();
    logGenerationHttpBoundary(
      {
        route: "status",
        code: "billing_entitlement_unavailable",
        durationMs: 32,
        correlationId: "35e5f7fd-5769-47e1-88d0-bc5f2682a9de",
        httpStatus: 503,
      },
      write,
    );
    const line = write.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "error",
      request_id: "35e5f7fd-5769-47e1-88d0-bc5f2682a9de",
      code: "billing_entitlement_unavailable",
      duration_ms: 32,
      generation_route: "status",
      http_status: 503,
    });
    expect(line).not.toContain("プラン");
    expect(line).not.toContain("@");
  });

  it("collapses free-text code into request_failed", () => {
    const write = vi.fn();
    logGenerationHttpBoundary(
      {
        route: "menu",
        code: "Unexpected JSON at position 0",
        durationMs: 1,
        correlationId: "corr-1",
        httpStatus: 500,
      },
      write,
    );
    const parsed = JSON.parse(write.mock.calls[0]![0] as string) as { code: string };
    expect(parsed.code).toBe("request_failed");
  });

  it("handleGenerationHttpError logs closed code from HttpError", () => {
    const write = vi.fn();
    const response = handleGenerationHttpError(
      "menu",
      new HttpError(422, "consent_required", "AIへ送る情報の説明を確認してください。"),
      {
        startedAtMonotonicMs: performance.now() - 10,
        correlationId: "82000000-0000-4000-8000-000000000001",
        handle: (error) => {
          if (error instanceof HttpError) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: { code: error.code, message: error.message },
              }),
              { status: error.status },
            );
          }
          return new Response("{}", { status: 500 });
        },
      },
      write,
    );
    expect(response.status).toBe(422);
    const parsed = JSON.parse(write.mock.calls[0]![0] as string) as {
      code: string;
      generation_route: string;
      http_status: number;
    };
    expect(parsed.code).toBe("consent_required");
    expect(parsed.generation_route).toBe("menu");
    expect(parsed.http_status).toBe(422);
    expect(write.mock.calls[0]![0] as string).not.toContain("AIへ");
  });
});

describe("logGenerationEvent", () => {
  it("serializes only the approved log fields in snake_case with level", () => {
    const sink = {
      info: vi.fn<(line: string) => void>(),
      warn: vi.fn<(line: string) => void>(),
      error: vi.fn<(line: string) => void>(),
    };
    const eventWithSensitiveCanaries = {
      requestId: "50000000-0000-4000-8000-000000000001",
      errorCode: "invalid_ai_response",
      durationMs: 321,
      modelId: "model:free",
      allergyDetails: ["egg"],
      prompt: "sensitive-prompt",
      rawResponse: "sensitive-response",
    };
    logGenerationEvent("error", eventWithSensitiveCanaries, sink);
    const line = sink.error.mock.calls[0]?.[0];
    expect(line).toBeTypeOf("string");
    if (typeof line !== "string") throw new Error("Expected serialized log output to be a string");
    expect(JSON.parse(line)).toEqual({
      level: "error",
      request_id: "50000000-0000-4000-8000-000000000001",
      code: "invalid_ai_response",
      duration_ms: 321,
      model_id: "model:free",
    });
    expect(line).not.toContain("egg");
    expect(line).not.toContain("sensitive-prompt");
    expect(line).not.toContain("sensitive-response");
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("omits model_id when modelId is null", () => {
    const sink = {
      info: vi.fn<(line: string) => void>(),
      warn: vi.fn<(line: string) => void>(),
      error: vi.fn<(line: string) => void>(),
    };
    logGenerationEvent(
      "info",
      {
        requestId: "50000000-0000-4000-8000-000000000002",
        errorCode: "succeeded",
        durationMs: 12,
        modelId: null,
      },
      sink,
    );
    const infoLine = sink.info.mock.calls[0]?.[0];
    expect(infoLine).toBeTypeOf("string");
    if (typeof infoLine !== "string") throw new Error("Expected info log line");
    expect(JSON.parse(infoLine)).toEqual({
      level: "info",
      request_id: "50000000-0000-4000-8000-000000000002",
      code: "succeeded",
      duration_ms: 12,
    });
  });
});

describe("closedErrorCode on all logger sinks", () => {
  it("collapses free-text code on createSafeLogger", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "error",
      requestId: "req-free",
      code: "Unexpected JSON at position 0",
      durationMs: 1,
    });
    const parsed = JSON.parse(write.mock.calls[0]![0] as string) as { code: string };
    expect(parsed.code).toBe("request_failed");
  });

  it("collapses free-text code on logGenerationEvent", () => {
    const info = vi.fn();
    logGenerationEvent(
      "error",
      {
        requestId: "req-gen",
        errorCode: "provider said: boom!",
        durationMs: 2,
        modelId: null,
      },
      { info, warn: vi.fn(), error: info },
    );
    const parsed = JSON.parse(info.mock.calls[0]![0] as string) as { code: string };
    expect(parsed.code).toBe("request_failed");
  });
});

describe("S1 closed allowed string values", () => {
  it("collapses free-text requestId and omits free-text modelId / billingStatus", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "error",
      requestId: "vendor said: canary@example.com / 太郎",
      code: "openrouter_unavailable",
      durationMs: 1,
      modelId: 'vendor said: "egg" allergy canary@example.com',
      billingStatus: "active; name=太郎 email=canary@example.com",
    });
    const line = write.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toEqual({
      level: "error",
      request_id: "invalid_request_id",
      code: "openrouter_unavailable",
      duration_ms: 1,
    });
    expect(line).not.toContain("canary@example.com");
    expect(line).not.toContain("太郎");
    expect(line).not.toContain("egg");
    expect(parsed).not.toHaveProperty("model_id");
    expect(parsed).not.toHaveProperty("billing_status");
  });

  it("keeps closed billingStatus enum and opaque Stripe / job ids; drops free-text ids", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "bill-s1",
      code: "billing_webhook_ok",
      durationMs: 5,
      billingStatus: "past_due",
      stripeCustomerId: "cus_abc123",
      stripeSubscriptionId: "sub_xyz789",
      jobId: "d1000000-0000-4000-8000-000000000001",
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toEqual({
      level: "info",
      request_id: "bill-s1",
      code: "billing_webhook_ok",
      duration_ms: 5,
      billing_status: "past_due",
      stripe_customer_id: "cus_abc123",
      stripe_subscription_id: "sub_xyz789",
      job_id: "d1000000-0000-4000-8000-000000000001",
    });

    const writeBad = vi.fn();
    createSafeLogger(writeBad)({
      level: "warn",
      requestId: "bill-s1-bad",
      code: "billing_webhook_ok",
      durationMs: 1,
      stripeCustomerId: "not-a-customer email=canary@example.com",
      stripeSubscriptionId: "sub_ has space",
      jobId: "not-a-uuid free text",
      billingStatus: "completely_unknown_status",
    });
    const badLine = writeBad.mock.calls[0]![0] as string;
    const badParsed = JSON.parse(badLine) as Record<string, unknown>;
    expect(badParsed).toEqual({
      level: "warn",
      request_id: "bill-s1-bad",
      code: "billing_webhook_ok",
      duration_ms: 1,
    });
    expect(badLine).not.toContain("canary@example.com");
    expect(badLine).not.toContain("free text");
    expect(badParsed).not.toHaveProperty("stripe_customer_id");
    expect(badParsed).not.toHaveProperty("stripe_subscription_id");
    expect(badParsed).not.toHaveProperty("job_id");
    expect(badParsed).not.toHaveProperty("billing_status");
  });

  it("collapses free-text level to error and keeps info/warn/error", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "error canary@example.com" as "error",
      requestId: "req-level",
      code: "succeeded",
      durationMs: 1,
    });
    const line = write.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as { level: string };
    expect(parsed.level).toBe("error");
    expect(line).not.toContain("canary@example.com");

    for (const level of ["info", "warn", "error"] as const) {
      const keep = vi.fn();
      createSafeLogger(keep)({
        level,
        requestId: "req-keep-level",
        code: "succeeded",
        durationMs: 1,
      });
      expect((JSON.parse(keep.mock.calls[0]![0] as string) as { level: string }).level).toBe(level);
    }
  });

  it("pins SAFE_LOG_SERIALIZED_KEYS to serialized output and assert-privacy-logs (SC8)", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "sc8-full",
      code: "maintenance_cleanup",
      durationMs: 1,
      modelId: "vendor/model:free",
      staleReservationsFinalized: 1,
      generationLedgersDeleted: 1,
      shoppingMutationsDeleted: 1,
      authContinuationsDeleted: 1,
      userFeedbackDeleted: 1,
      draftSubmissionsDeleted: 1,
      identityLedgersDeleted: 1,
      flyerLedgersDeleted: 1,
      staleShareJobsReaped: 1,
      path: "household",
      matchMode: "none",
      emptyReason: "allergen_missing",
      candidateCount: 1,
      mealType: "lunch",
      mainIngredientCount: 1,
      plan: "plus",
      billingStatus: "active",
      priceInterval: "month",
      qualityMode: true,
      flyer: true,
      stripeCustomerId: "cus_sc8",
      stripeSubscriptionId: "sub_sc8",
      alertMetric: 1,
      generationRoute: "menu",
      httpStatus: 200,
      jobId: "d1000000-0000-4000-8000-000000000001",
      failureCode: "consent_revoked",
      sourceCounts: { fixture: 1, community: 1 },
    });
    const serializedKeys = new Set(
      Object.keys(JSON.parse(write.mock.calls[0]![0] as string) as Record<string, unknown>),
    );
    expect(serializedKeys).toEqual(SAFE_LOG_SERIALIZED_KEYS);

    const scriptPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../scripts/assert-privacy-logs.mjs",
    );
    const script = readFileSync(scriptPath, "utf8");
    const block = script.match(/const allowedLogKeys = new Set\(\[([\s\S]*?)\]\)/u)?.[1];
    expect(block).toBeTypeOf("string");
    const scriptKeys = new Set([...(block ?? "").matchAll(/"([^"]+)"/gu)].map((match) => match[1]));
    expect(scriptKeys).toEqual(SAFE_LOG_SERIALIZED_KEYS);
  });

  it("keeps valid modelId shape matching OpenRouter id pattern", () => {
    const write = vi.fn();
    createSafeLogger(write)({
      level: "info",
      requestId: "req-model",
      code: "succeeded",
      durationMs: 2,
      modelId: "vendor/model:free",
    });
    expect(JSON.parse(write.mock.calls[0]![0] as string)).toMatchObject({
      model_id: "vendor/model:free",
    });
  });
});
