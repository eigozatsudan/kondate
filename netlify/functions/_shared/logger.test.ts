import { expect, it, vi } from "vitest";
import { logGenerationEvent } from "./logger.js";

it("serializes only the approved log fields", () => {
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
    requestId: "50000000-0000-4000-8000-000000000001",
    errorCode: "invalid_ai_response",
    durationMs: 321,
    modelId: "model:free",
  });
  expect(line).not.toContain("egg");
  expect(line).not.toContain("sensitive-prompt");
  expect(line).not.toContain("sensitive-response");
});
