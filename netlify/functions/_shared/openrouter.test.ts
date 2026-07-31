import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import * as generationContracts from "../../../shared/contracts/generation.js";
import { menuResponseFormat } from "../../../shared/contracts/generation.js";
import { parseServerEnv, type ServerEnv } from "./env.js";
import {
  createOpenRouterGenerationSender,
  OPENROUTER_MAX_BODY_BYTES,
  OpenRouterCallError,
  readResponseBodyWithByteCap,
  sendMenuGeneration,
  type OpenRouterGenerationInput,
  type OpenRouterMessage,
} from "./openrouter.js";

const { getServerEnvMock } = vi.hoisted(() => ({
  getServerEnvMock: vi.fn<() => ServerEnv>(),
}));

vi.mock("./env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env.js")>();
  return { ...actual, getServerEnv: getServerEnvMock };
});

// 正常系: 公式 base + 有料 ID（有料 allowlist）。mock path は別ケースで検証する。
const models = ["first/model", "second/model"] as const;
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
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  GENERATION_REQUEST_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  QUOTA_IDENTITY_HMAC_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
  USER_DAILY_AI_LIMIT: "3",
  USER_DAILY_EXTERNAL_CALL_LIMIT: "6",
  USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4",
  USER_SHORT_WINDOW_SECONDS: "600",
  OPENROUTER_TIMEOUT_MS: "24000",
  FUNCTION_TOTAL_BUDGET_MS: "55000",
  AI_PROCESSING_STALE_SECONDS: "180",
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

function successfulResponse(model: string = models[0], status: number = 200): Response {
  return new Response(
    JSON.stringify({
      model,
      choices: [
        {
          message: {
            content: JSON.stringify({ ...conflictOutput, menu: null }),
          },
        },
      ],
    }),
    { status },
  );
}

function mockElapsed(elapsedMs: number): void {
  vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(elapsedMs);
}

function mockDeadlineAtCall(deadlineCall: number): void {
  let callCount = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    callCount += 1;
    if (callCount === 1) return 0;
    return callCount >= deadlineCall ? 20_000 : 19_999;
  });
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
  expectTypeOf<OpenRouterGenerationInput>().not.toHaveProperty("models");
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
    "https://openrouter.ai/api/v1/chat/completions",
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
    stream: false,
  });
  // temperature 非対応モデル（gpt-5.6-luna 等）で require_parameters が 404 になるため送らない
  expect(requestBody(fetchImpl)).not.toHaveProperty("temperature");
  expect(result).toEqual({ mode: "full_menu", output: conflictOutput, modelId: models[1] });
});

it.each([201, 206])(
  "rejects HTTP %i even with a valid configured-model response body",
  async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulResponse(models[0], status));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
      new OpenRouterCallError("model_unavailable"),
    );
  },
);

it("rejects an empty HTTP 204 response as terminal model unavailability", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
  );

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable"),
  );
});

it("preserves the benchmark factory exact ordered model configuration in the request body", async () => {
  const injectedModels = ["openai/gpt-4.1-nano", "openai/gpt-oss-120b"] as const;
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse(injectedModels[1]));
  const sender = createOpenRouterGenerationSender({
    apiKey: "benchmark-key",
    baseUrl: "https://openrouter.ai/api/v1",
    models: injectedModels,
    timeoutMs: 20_000,
    fetchImpl,
  });

  await sender({
    messages: [{ role: "user", content: "data" }],
    timeoutMs: 1_000,
  });

  expect((requestBody(fetchImpl) as { models: readonly string[] }).models).toEqual(injectedModels);
});

it("uses dish regeneration schema in replacement_dish mode and rejects full-menu bodies", async () => {
  const dishOutput = {
    replacementDish: {
      dishRef: "dish_1",
      role: "main",
      position: 1,
      name: "炒め物",
      description: "主菜",
      cookingTimeMinutes: 15,
      ingredients: [
        {
          ingredientRef: "ingredient_1",
          position: 1,
          name: "豚肉",
          quantityValue: 100,
          quantityText: "100g",
          unit: "g",
          storeSection: "meat_fish",
          pantryRef: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [{ stepRef: "step_1", position: 1, instruction: "炒める" }],
    },
    timeline: [
      {
        timelineRef: "timeline_1",
        position: 1,
        startMinute: 0,
        durationMinutes: 15,
        instruction: "炒める",
        dishRef: "dish_1",
        stepRef: "step_1",
      },
    ],
    adaptations: [],
    pantryUsage: [],
    labelConfirmations: [],
  };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: models[0],
        choices: [{ message: { content: JSON.stringify(dishOutput) } }],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchImpl);

  const result = await sendMenuGeneration({
    messages: [{ role: "user", content: "data" }],
    timeoutMs: 1_000,
    mode: "replacement_dish",
  });

  expect(result).toEqual({
    mode: "replacement_dish",
    output: dishOutput,
    modelId: models[0],
  });
  const body = requestBody(fetchImpl) as { response_format: { json_schema: { name: string } } };
  expect(body.response_format.json_schema.name).toBe("kondate_dish_regeneration");

  // full_menu ボディは replacement モードで拒否
  fetchImpl.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        model: models[0],
        choices: [
          {
            message: {
              content: JSON.stringify({ ...conflictOutput, menu: null }),
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  await expect(
    sendMenuGeneration({
      messages: [],
      timeoutMs: 1_000,
      mode: "replacement_dish",
    }),
  ).rejects.toMatchObject({ code: "invalid_ai_response" });
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

it("keeps a conservative response model ID as terminal evidence", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(successfulResponse("other/model"));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable", "other/model"),
  );
});

it("drops an unsafe outside response model from terminal evidence", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(successfulResponse("other/model\nprovider detail"));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable", null),
  );
});

it("rejects OpenRouter bodies larger than 1MiB as invalid_ai_response", async () => {
  // A-I11: 固定上限超過は repair 適格の invalid に落とす
  const oversized = "x".repeat(OPENROUTER_MAX_BODY_BYTES + 1);
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(oversized, { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toMatchObject({
    code: "invalid_ai_response",
  });
});

it("keeps byte-cap classification when reader cancellation rejects", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(OPENROUTER_MAX_BODY_BYTES + 1));
    },
    cancel() {
      return Promise.reject(new Error("cancel cleanup failed"));
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 })),
  );

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).rejects.toEqual(
    new OpenRouterCallError("invalid_ai_response"),
  );
});

it("readResponseBodyWithByteCap accepts exactly max bytes and rejects max+1", async () => {
  const exact = "a".repeat(64);
  await expect(readResponseBodyWithByteCap(new Response(exact), 64)).resolves.toBe(exact);
  await expect(readResponseBodyWithByteCap(new Response("a".repeat(65)), 64)).rejects.toMatchObject(
    { code: "invalid_ai_response" },
  );
});

it("rejects a malformed envelope from an unconfigured model as terminal", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ model: "other/model", choices: [] }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 1_000 })).rejects.toEqual(
    new OpenRouterCallError("model_unavailable", "other/model"),
  );
});

it.each([
  ["3", "2026-07-11T00:00:03.000Z"],
  ["Sat, 11 Jul 2026 00:00:05 GMT", "2026-07-11T00:00:05.000Z"],
  ["invalid", null],
  ["-1", null],
  ["Fri, 10 Jul 2026 00:00:00 GMT", null],
  ["2026-07-11T00:00:05.000Z", null],
  // 巨大秒数・遠い HTTP-date は 24h 上限にクランプする
  ["999999999999999999999999", "2026-07-12T00:00:00.000Z"],
  ["Fri, 01 Jan 2100 00:00:00 GMT", "2026-07-12T00:00:00.000Z"],
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
      excludedModelIds: ["unknown/model"],
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
  ["automatic", ["openrouter/auto"]],
  ["router free", ["openrouter/free"]],
  ["router auto-beta", ["openrouter/auto-beta"]],
  ["free-on-real-api", ["vendor/a:free"]],
  ["free-on-real-api-Free", ["vendor/a:Free"]],
  ["free-on-real-api-FREE", ["vendor/a:FREE"]],
  ["router-auto-mixed-case", ["OpenRouter/Auto"]],
  ["mock-on-real-api", ["mock/vendor-paid"]],
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

it("accepts completion at 19,999ms", async () => {
  mockElapsed(19_999);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()));

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).resolves.toMatchObject({
    modelId: models[0],
    output: conflictOutput,
  });
});

it("includes fetch-side preparation in the deadline", async () => {
  mockDeadlineAtCall(2);
  const fetchImpl = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchImpl);

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).rejects.toEqual(
    new OpenRouterCallError("generation_timeout"),
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("rejects completion at 20,000ms even before the timer callback can run", async () => {
  // body・JSON・envelope・wire・adapter は境界内で終え、成功 return 直前だけ境界へ達する。
  mockDeadlineAtCall(11);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()));

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).rejects.toEqual(
    new OpenRouterCallError("generation_timeout"),
  );
});

it.each([
  ["top-level JSON", new Response("not-json", { status: 200 }), 5],
  ["envelope", new Response(JSON.stringify({ model: models[0], choices: [] }), { status: 200 }), 7],
  [
    "content JSON",
    new Response(
      JSON.stringify({
        model: models[0],
        choices: [{ message: { content: "not-json" } }],
      }),
      { status: 200 },
    ),
    8,
  ],
  ["outside model", successfulResponse("other/model"), 6],
  [
    "wire",
    new Response(
      JSON.stringify({
        model: models[0],
        choices: [
          {
            message: {
              content: JSON.stringify({
                outcome: "constraint_conflict",
                menu: null,
                conflicts: [],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    ),
    9,
  ],
  [
    "body",
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("body connection lost"));
        },
      }),
      { status: 200 },
    ),
    4,
  ],
] as const)(
  "prioritizes an elapsed deadline over invalid %s",
  async (_name, response, deadlineCall) => {
    // 対象処理の直前までは19,999msに留め、競合errorを捕捉する時点で20,000msにする。
    mockDeadlineAtCall(deadlineCall);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).rejects.toEqual(
      new OpenRouterCallError("generation_timeout"),
    );
  },
);

it("prioritizes an elapsed deadline over an adapter failure", async () => {
  mockDeadlineAtCall(10);
  const adapterSpy = vi
    .spyOn(generationContracts, "toAiGenerationResponse")
    .mockImplementation(() => {
      throw new Error("adapter failure");
    });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()));

  await expect(sendMenuGeneration({ messages: [], timeoutMs: 20_000 })).rejects.toEqual(
    new OpenRouterCallError("generation_timeout"),
  );
  expect(adapterSpy).toHaveBeenCalledOnce();
});

it("settles a permanently pending byte-cap cancellation on Abort and removes its listener", async () => {
  vi.useFakeTimers();
  const addEventListenerSpy = vi.spyOn(AbortSignal.prototype, "addEventListener");
  const removeEventListenerSpy = vi.spyOn(AbortSignal.prototype, "removeEventListener");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(OPENROUTER_MAX_BODY_BYTES + 1));
    },
    cancel() {
      return new Promise<void>(() => {});
    },
  });
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);

  const pending = sendMenuGeneration({ messages: [], timeoutMs: 20_000 });
  const capturedError = pending.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  const didNotSettle = new Promise<"did_not_settle">((resolve) => {
    setTimeout(() => {
      resolve("did_not_settle");
    }, 20_001);
  });
  const outcome = Promise.race([capturedError, didNotSettle]);
  await vi.advanceTimersByTimeAsync(20_001);

  const error = await outcome;
  expect(error).toEqual(new OpenRouterCallError("generation_timeout"));
  expect(vi.getTimerCount()).toBe(0);
  const abortRegistration = addEventListenerSpy.mock.calls.find(([type]) => type === "abort");
  expect(abortRegistration).toBeDefined();
  expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", abortRegistration?.[1]);
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

it("accepts content parts array for vision messages", () => {
  const msg: OpenRouterMessage = {
    role: "user",
    content: [
      { type: "text", text: "チラシから1週間の献立を作ってください" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc" } },
    ],
  };
  expect(Array.isArray(msg.content)).toBe(true);
});
