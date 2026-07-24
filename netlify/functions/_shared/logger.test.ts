import { describe, expect, it, vi } from "vitest";
import { createSafeLogger, logGenerationEvent } from "./logger.js";

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
