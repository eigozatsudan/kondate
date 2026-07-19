import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { menuResponseFormat } from "../../../shared/contracts/generation.js";
import { parseServerEnv, type ServerEnv } from "./env.js";
import {
  OpenRouterCallError,
  sendMenuGeneration,
  type OpenRouterGenerationInput,
} from "./openrouter.js";

const { getServerEnvMock } = vi.hoisted(() => ({
  getServerEnvMock: vi.fn<() => ServerEnv>(),
}));

vi.mock("./env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env.js")>();
  return { ...actual, getServerEnv: getServerEnvMock };
});

const models = ["first/model:free", "second/model:free"] as const;
const config = parseServerEnv({
  VITE_SUPABASE_URL: "http://127.0.0.1:8000",
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  OPENROUTER_API_KEY: "secret",
  OPENROUTER_MODELS: models.join(","),
  OPENROUTER_BASE_URL: "http://mock.invalid/v1",
  USER_DAILY_AI_LIMIT: "5",
  USER_DAILY_EXTERNAL_CALL_LIMIT: "12",
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
  USER_SHORT_WINDOW_SECONDS: "600",
});

const conflictOutput = {
  outcome: "constraint_conflict",
  conflicts: [
    {
      code: "must_use_conflict",
      message: "条件を同時に満たせません。",
      conditionRefs: ["pantry_1"],
    },
  ],
} as const;

function successfulResponse(model: string = models[0]): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: JSON.stringify(conflictOutput) } }],
    }),
    { status: 200 },
  );
}

function requestBody(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
  const body = fetchImpl.mock.calls[0]?.[1]?.body;
  expect(body).toBeTypeOf("string");
  if (typeof body !== "string") {
    throw new Error("Expected OpenRouter request body to be a string");
  }
  return JSON.parse(body) as unknown;
}

getServerEnvMock.mockReturnValue(config);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("exposes only the constrained single-argument production input", () => {
  expectTypeOf<Parameters<typeof sendMenuGeneration>>().toEqualTypeOf<
    [OpenRouterGenerationInput]
  >();
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("model");
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("apiKey");
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("baseUrl");
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("fetch");
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("env");
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("mockScenario");
});

it("uses models fallback, strict schema, and required parameters", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse(models[1]));
  vi.stubGlobal("fetch", fetchImpl);

  const result = await sendMenuGeneration({
    messages: [{ role: "user", content: "data" }],
    timeoutMs: 1_000,
  });

  expect(fetchImpl).toHaveBeenCalledWith(
    "http://mock.invalid/v1/chat/completions",
    expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
    }),
  );
  expect(requestBody(fetchImpl)).toEqual({
    models,
    messages: [{ role: "user", content: "data" }],
    provider: { require_parameters: true },
    response_format: menuResponseFormat,
    temperature: 0.2,
    stream: false,
  });
  expect(result).toEqual({ output: conflictOutput, modelId: models[1] });
});

it.each([
  ["top-level JSON", new Response("not-json", { status: 200 }), null],
  [
    "envelope",
    new Response(JSON.stringify({ model: models[0], choices: [] }), { status: 200 }),
    models[0],
  ],
  [
    "content JSON",
    new Response(
      JSON.stringify({ model: models[0], choices: [{ message: { content: "not-json" } }] }),
      { status: 200 },
    ),
    models[0],
  ],
  [
    "content schema",
    new Response(JSON.stringify({ model: models[0], choices: [{ message: { content: "{}" } }] }), {
      status: 200,
    }),
    models[0],
  ],
] as const)("maps invalid %s to invalid_ai_response", async (_case, response, modelId) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toMatchObject({
    code: "invalid_ai_response",
    modelId,
  });
});

it("rejects an unconfigured response model without repair metadata", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse("other/model:free"));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable"),
  );
});

it("rejects a malformed envelope from an unconfigured model as terminal", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ model: "other/model:free", choices: [] }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable"),
  );
});

it.each([
  ["3", "2026-07-11T00:00:03.000Z"],
  ["Sat, 11 Jul 2026 00:00:05 GMT", "2026-07-11T00:00:05.000Z"],
  ["invalid", null],
  ["-1", null],
  ["Fri, 10 Jul 2026 00:00:00 GMT", null],
  ["2026-07-11T00:00:05.000Z", null],
  ["999999999999999999999999", null],
  ["Sat, 31 Feb 2026 00:00:05 GMT", null],
  ["Fri, 11 Jul 2026 00:00:05 GMT", null],
] as const)("parses Retry-After %s", async (value, expectedRetryAt) => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-07-11T00:00:00.000Z");
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("provider error", {
      status: 429,
      headers: { "Retry-After": value },
    }),
  );
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toMatchObject({
    code: "model_unavailable",
    retryAt: expectedRetryAt,
  });
});

it("maps a signal-aware fetch timeout to generation_timeout and clears its timer", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );
  vi.stubGlobal("fetch", fetchImpl);

  const pending = sendMenuGeneration({ messages: [], timeoutMs: 10 });
  const rejection = expect(pending).rejects.toMatchObject({ code: "generation_timeout" });
  await vi.advanceTimersByTimeAsync(10);

  await rejection;
  expect(vi.getTimerCount()).toBe(0);
});

it("maps a network rejection to model_unavailable without leaking its detail", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("network secret request body"));
  vi.stubGlobal("fetch", fetchImpl);

  const error = await sendMenuGeneration({ messages: [], timeoutMs: 1_000 }).catch(
    (reason: unknown) => reason,
  );
  expect(error).toEqual(new OpenRouterCallError("model_unavailable"));
  expect(String(error)).not.toContain("network secret request body");
});

it("maps an HTTP failure without exposing the provider response body", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("provider secret response body", { status: 503 }));
  vi.stubGlobal("fetch", fetchImpl);

  const error = await sendMenuGeneration({ messages: [], timeoutMs: 1_000 }).catch(
    (reason: unknown) => reason,
  );
  expect(error).toEqual(new OpenRouterCallError("model_unavailable"));
  expect(String(error)).not.toContain("provider secret response body");
});

it("maps a response body read failure to terminal model_unavailable", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("body connection lost"));
        },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable"),
  );
});

it("keeps configured order while excluding only the actual model", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("provider error", { status: 503 }));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(
    sendMenuGeneration({
      messages: [],
      timeoutMs: 1_000,
      excludedModelIds: [models[0]],
    }),
  ).rejects.toMatchObject({ code: "model_unavailable" });
  expect(requestBody(fetchImpl)).toMatchObject({ models: [models[1]] });
});

it("ignores unknown exclusions without changing configured order", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("provider error", { status: 503 }));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(
    sendMenuGeneration({
      messages: [],
      timeoutMs: 1_000,
      excludedModelIds: ["unknown/model:free"],
    }),
  ).rejects.toMatchObject({ code: "model_unavailable" });
  expect(requestBody(fetchImpl)).toMatchObject({ models });
});

it("rejects all configured models being excluded before fetch", async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchImpl);

  await expect(
    sendMenuGeneration({ messages: [], timeoutMs: 1_000, excludedModelIds: models }),
  ).rejects.toEqual(new OpenRouterCallError("model_unavailable"));
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
  ["empty", []],
  ["duplicate", [models[0], models[0]]],
  ["non-free", ["paid/model"]],
  ["automatic", ["openrouter/auto"]],
] as const)("rejects %s configured models before fetch", async (_case, configuredModels) => {
  getServerEnvMock.mockReturnValueOnce({
    ...config,
    openRouter: { ...config.openRouter, models: configuredModels },
  });
  const fetchImpl = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable"),
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
  "rejects invalid input timeout %s before fetch",
  async (timeoutMs) => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(sendMenuGeneration({ messages: [], timeoutMs })).rejects.toEqual(
      new OpenRouterCallError("generation_timeout"),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
  "rejects invalid configured timeout %s before fetch",
  async (timeoutMs) => {
    getServerEnvMock.mockReturnValueOnce({
      ...config,
      openRouter: { ...config.openRouter, timeoutMs },
    });
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
      new OpenRouterCallError("generation_timeout"),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it("uses the lower configured timeout and classifies body abort as terminal timeout", async () => {
  vi.useFakeTimers();
  getServerEnvMock.mockReturnValueOnce({
    ...config,
    openRouter: { ...config.openRouter, timeoutMs: 5 },
  });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        }),
        { status: 200 },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchImpl);

  const pending = sendMenuGeneration({ messages: [], timeoutMs: 100 });
  const rejection = expect(pending).rejects.toMatchObject({ code: "generation_timeout" });
  await vi.advanceTimersByTimeAsync(5);

  await rejection;
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the timer after a successful response", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse());
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).resolves.toMatchObject({
    modelId: models[0],
  });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  ["http://openrouter-mock:8787/api/v1", true],
  ["http://openrouter-mock:8787@evil.example/api/v1", false],
  ["http://openrouter-mock.evil.example:8787/api/v1", false],
  ["https://openrouter-mock:8787/api/v1", false],
  ["http://user@openrouter-mock:8787/api/v1", false],
  ["http://user:password@openrouter-mock:8787/api/v1", false],
  ["http://:password@openrouter-mock:8787/api/v1", false],
  ["http://openrouter-mock:8788/api/v1", false],
  ["http://openrouter-mock:8787/api/v1/extra", false],
  ["http://openrouter-mock:8787/api/v1?scenario=success", false],
  ["http://openrouter-mock:8787/api/v1#fragment", false],
] as const)(
  "sends the mock scenario header only to the exact local base %s",
  async (baseUrl, expected) => {
    vi.stubEnv("OPENROUTER_MOCK_SCENARIO", "success");
    getServerEnvMock.mockReturnValueOnce({
      ...config,
      openRouter: { ...config.openRouter, baseUrl },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider error", { status: 503 }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toMatchObject({
      code: "model_unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.has("X-Kondate-Mock-Scenario")).toBe(expected);
  },
);
