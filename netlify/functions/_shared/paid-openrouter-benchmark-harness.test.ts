import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import {
  resetOpenRouterRuntimeModelPolicyCacheForTests,
  seedOpenRouterRuntimeModelPolicyOkForTests,
} from "./openrouter.js";
import {
  runPaidBenchmarkUnit,
  type PaidBenchmarkRepositoryTransition,
} from "./paid-openrouter-benchmark-harness.js";

const primaryModel = "openai/gpt-4.1-nano";
const repairModel = "meta-llama/llama-3.1-8b-instruct";
const configuration = [primaryModel, repairModel] as const;

type FetchStep =
  | { kind: "output"; model: string; output: unknown; elapsedMs?: number }
  | { kind: "unknown_invalid"; elapsedMs?: number }
  | { kind: "http_error"; status: number; elapsedMs?: number }
  | {
      kind: "non_200_output";
      status: 201 | 206;
      model: string;
      output: unknown;
      elapsedMs?: number;
    }
  | { kind: "transport_error"; elapsedMs?: number }
  | { kind: "body_error"; elapsedMs?: number };

function wireOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("outcome" in output)) {
    return output;
  }
  if (output.outcome === "success") {
    return { ...output, conflicts: null };
  }
  return { ...output, menu: null };
}

function makeFetch(
  steps: readonly FetchStep[],
  requests: Array<{ models: string[]; messages: unknown[] }>,
  advance: (elapsedMs: number) => void = () => {},
): typeof fetch {
  let index = 0;
  return vi.fn<typeof fetch>((_input, init) => {
    const body = z
      .looseObject({
        models: z.array(z.string()),
        messages: z.array(z.unknown()),
      })
      .parse(typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null);
    requests.push({ models: [...body.models], messages: [...body.messages] });
    const step = steps[index];
    index += 1;
    if (step === undefined) throw new Error("unexpected benchmark send");
    advance(step.elapsedMs ?? 0);
    if (step.kind === "transport_error") {
      return Promise.reject(new Error("transport detail must not escape"));
    }
    if (step.kind === "body_error") {
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("body detail must not escape"));
        },
      });
      return Promise.resolve(new Response(bodyStream, { status: 200 }));
    }
    if (step.kind === "http_error") {
      return Promise.resolve(
        new Response(step.status === 204 ? null : "provider detail must not escape", {
          status: step.status,
        }),
      );
    }
    if (step.kind === "non_200_output") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: step.model,
            choices: [{ message: { content: JSON.stringify(wireOutput(step.output)) } }],
          }),
          { status: step.status },
        ),
      );
    }
    if (step.kind === "unknown_invalid") {
      return Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: step.model,
          choices: [{ message: { content: JSON.stringify(wireOutput(step.output)) } }],
        }),
        { status: 200 },
      ),
    );
  });
}

function validIdeaOutput(): unknown {
  return structuredClone(scenarios["idea-servings-2"]);
}

function invalidIdeaOutput(): unknown {
  return structuredClone(scenarios["idea-servings-20"]);
}

function conflictOutput(): unknown {
  return {
    outcome: "constraint_conflict",
    conflicts: [
      {
        code: "dish_count_conflict",
        message: "provider detail must not escape",
        conditionRefs: [],
      },
    ],
  };
}

async function runWithSteps(
  steps: readonly FetchStep[],
  overrides: {
    configuration?: readonly string[];
    now?: () => number;
    onRepositoryTransition?: (transition: PaidBenchmarkRepositoryTransition) => void;
  } = {},
) {
  const requests: Array<{ models: string[]; messages: unknown[] }> = [];
  const result = await runPaidBenchmarkUnit({
    configuration: overrides.configuration ?? configuration,
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl: makeFetch(steps, requests),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    ...(overrides.onRepositoryTransition === undefined
      ? {}
      : { onRepositoryTransition: overrides.onRepositoryTransition }),
  });
  return { result, requests };
}

describe("runPaidBenchmarkUnit", () => {
  beforeEach(() => {
    // 公式 base の sender は markSent 前に Models API 政策を走らせる。
    // 本ファイルの fetch mock は chat completions 専用なので、G4 専用でない
    // 既存 chat 経路と同じく seed で remote をスキップする。
    // CI の mock env では本番 Models API 成功キャッシュが無く、未 seed だと
    // model_unavailable で 25 件落ちる。
    seedOpenRouterRuntimeModelPolicyOkForTests();
  });

  afterEach(() => {
    resetOpenRouterRuntimeModelPolicyCacheForTests();
    vi.unstubAllEnvs();
  });

  it("finalizes a primary success when process env is the CI mock OpenRouter allowlist", async () => {
    // GHA generate-local-secrets は mock base。公式 base の sender 政策が
    // chat 専用 fetch mock に当たると model_unavailable になる（本番 env の
    // Models API 成功キャッシュに依存してはいけない）。
    vi.stubEnv("OPENROUTER_BASE_URL", "http://openrouter-mock:8787/api/v1");
    vi.stubEnv("OPENROUTER_MODELS", "mock/kondate-primary:free,mock/kondate-repair:free");
    vi.stubEnv("OPENROUTER_PLUS_MODELS", "mock/kondate-primary:free,mock/kondate-repair:free");
    vi.stubEnv("OPENROUTER_FLYER_MODELS", "");

    const { result, requests } = await runWithSteps([
      { kind: "output", model: primaryModel, output: validIdeaOutput() },
    ]);

    expect(result).toMatchObject({
      ok: true,
      outcome: "primary_success",
      failureCodes: [],
    });
    expect(requests).toHaveLength(1);
  });

  it("finalizes a primary success after one production-service send", async () => {
    const { result, requests } = await runWithSteps([
      { kind: "output", model: primaryModel, output: validIdeaOutput() },
    ]);

    expect(result).toMatchObject({
      ok: true,
      configuration,
      outcome: "primary_success",
      failureCodes: [],
    });
    expect(result.sends).toHaveLength(1);
    expect(requests.map((request) => request.models)).toEqual([configuration]);
  });

  it("excludes a known invalid primary model from the single repair send", async () => {
    const { result, requests } = await runWithSteps([
      { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
      { kind: "output", model: repairModel, output: validIdeaOutput() },
    ]);

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("repair_success");
    expect(requests.map((request) => request.models)).toEqual([configuration, [repairModel]]);
    expect(result.sends.map((send) => send.excludedModel)).toEqual([null, primaryModel]);
  });

  it("reuses the exact configuration when an invalid response model is unknown", async () => {
    const { result, requests } = await runWithSteps([
      { kind: "unknown_invalid" },
      { kind: "output", model: repairModel, output: validIdeaOutput() },
    ]);

    expect(result.outcome).toBe("repair_success");
    expect(requests.map((request) => request.models)).toEqual([configuration, configuration]);
    expect(result.sends.map((send) => send.responseModel)).toEqual([null, repairModel]);
  });

  it("repairs with the same model when a single-model configuration fails primary", async () => {
    // generation-service: 1 本構成では exclude せず同モデルで 1 回 repair する
    const { result, requests } = await runWithSteps(
      [
        { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
        { kind: "output", model: primaryModel, output: validIdeaOutput() },
      ],
      { configuration: [primaryModel] },
    );

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("repair_success");
    expect(requests.map((request) => request.models)).toEqual([[primaryModel], [primaryModel]]);
    expect(result.sends.map((send) => send.excludedModel)).toEqual([null, null]);
  });

  it("fails after same-model repair exhausts a single-model configuration", async () => {
    const { result, requests } = await runWithSteps(
      [
        { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
        { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
      ],
      { configuration: [primaryModel] },
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "failure",
      failureCodes: ["invalid_ai_response"],
    });
    // compose 失敗時は closed subcode が diagnosticCodes に載る（raw なし）
    expect(result.diagnosticCodes.length).toBeGreaterThan(0);
    expect(result.diagnosticCodes.every((code) => typeof code === "string")).toBe(true);
    expect(JSON.stringify(result.diagnosticCodes)).not.toMatch(/prompt|message|raw/iu);
    expect(requests).toHaveLength(2);
  });

  it.each([
    {
      name: "timeout",
      steps: [
        { kind: "output", model: primaryModel, output: validIdeaOutput(), elapsedMs: 60_000 },
      ],
      expectedCode: "generation_timeout",
      expectedResponseModel: null,
    },
    {
      name: "non-2xx",
      steps: [{ kind: "http_error", status: 503 }],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "HTTP 201 with valid configured-model body",
      steps: [
        {
          kind: "non_200_output",
          status: 201,
          model: primaryModel,
          output: validIdeaOutput(),
        },
      ],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "HTTP 206 with valid configured-model body",
      steps: [
        {
          kind: "non_200_output",
          status: 206,
          model: primaryModel,
          output: validIdeaOutput(),
        },
      ],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "empty HTTP 204",
      steps: [{ kind: "http_error", status: 204 }],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "transport failure",
      steps: [{ kind: "transport_error" }],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "body read failure",
      steps: [{ kind: "body_error" }],
      expectedCode: "model_unavailable",
      expectedResponseModel: null,
    },
    {
      name: "response model mismatch",
      steps: [{ kind: "output", model: "outside/model", output: validIdeaOutput() }],
      expectedCode: "model_unavailable",
      expectedResponseModel: "outside/model",
    },
    {
      name: "constraint conflict",
      steps: [{ kind: "output", model: primaryModel, output: conflictOutput() }],
      expectedCode: "constraint_conflict",
      expectedResponseModel: primaryModel,
    },
  ] satisfies readonly {
    name: string;
    steps: readonly FetchStep[];
    expectedCode: string;
    expectedResponseModel?: string | null;
  }[])("does not repair $name", async ({ steps, expectedCode, expectedResponseModel }) => {
    let nowMs = 0;
    const requests: Array<{ models: string[]; messages: unknown[] }> = [];
    const result = await runPaidBenchmarkUnit({
      configuration,
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      fetchImpl: makeFetch(steps, requests, (elapsedMs) => {
        nowMs += elapsedMs;
      }),
      now: () => nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.failureCodes).toEqual([expectedCode]);
    expect(requests).toHaveLength(1);
    expect(result.sends[0]?.responseModel).toBe(expectedResponseModel);
  });

  it.each([
    {
      name: "invalid",
      second: { kind: "output", model: repairModel, output: invalidIdeaOutput() },
      expectedCode: "invalid_ai_response",
    },
    {
      name: "conflict",
      second: { kind: "output", model: repairModel, output: conflictOutput() },
      expectedCode: "constraint_conflict",
    },
    {
      name: "call error",
      second: { kind: "http_error", status: 503 },
      expectedCode: "model_unavailable",
    },
  ] satisfies readonly {
    name: string;
    second: FetchStep;
    expectedCode: string;
  }[])("never sends a third request after repair $name", async ({ second, expectedCode }) => {
    const { result, requests } = await runWithSteps([
      { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
      second,
    ]);

    expect(result.ok).toBe(false);
    expect(result.failureCodes).toEqual([expectedCode]);
    expect(requests).toHaveLength(2);
  });

  it("starts every unit with a fresh repository while preserving transitions inside the unit", async () => {
    const transitionRuns: PaidBenchmarkRepositoryTransition[][] = [[], []];
    for (let index = 0; index < transitionRuns.length; index += 1) {
      const transitions = transitionRuns[index];
      if (transitions === undefined) throw new Error("transition run missing");
      const { result } = await runWithSteps(
        [
          { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
          { kind: "output", model: repairModel, output: validIdeaOutput() },
        ],
        {
          onRepositoryTransition: (transition) => transitions.push(transition),
        },
      );
      expect(result.outcome).toBe("repair_success");
    }

    for (const transitions of transitionRuns) {
      expect(transitions.map((transition) => transition.kind)).toEqual([
        "lookup",
        "reserve_new",
        "mark_sent",
        "record_model",
        "reserve_repair",
        "mark_sent",
        "record_model",
        "finalize_success",
        "status",
      ]);
      expect(transitions.filter((transition) => transition.kind === "mark_sent")).toHaveLength(2);
      expect(transitions.some((transition) => transition.kind === "replay_existing")).toBe(false);
      expect(transitions[1]).toMatchObject({
        kind: "reserve_new",
        userSuccessReserved: 1,
        userSuccessConsumed: 0,
        attemptReserved: 1,
        attemptSent: 0,
        globalReserved: 1,
        globalSent: 0,
      });
      expect(transitions[2]).toMatchObject({
        kind: "mark_sent",
        userSuccessReserved: 1,
        attemptReserved: 0,
        attemptSent: 1,
        globalReserved: 0,
        globalSent: 1,
      });
      expect(transitions[4]).toMatchObject({
        kind: "reserve_repair",
        userSuccessReserved: 1,
        attemptReserved: 1,
        attemptSent: 1,
        globalReserved: 1,
        globalSent: 1,
      });
      expect(transitions.at(-2)).toMatchObject({
        kind: "finalize_success",
        userSuccessReserved: 0,
        userSuccessConsumed: 1,
        attemptReserved: 0,
        attemptSent: 2,
        globalReserved: 0,
        globalSent: 2,
      });
    }
  });

  it.each([
    {
      name: "failure",
      step: { kind: "http_error", status: 503 } as const,
      terminalKind: "finalize_failure" as const,
    },
    {
      name: "conflict",
      step: { kind: "output", model: primaryModel, output: conflictOutput() } as const,
      terminalKind: "finalize_conflict" as const,
    },
  ])(
    "releases outstanding quota reservations on $name finalize",
    async ({ step, terminalKind }) => {
      const transitions: PaidBenchmarkRepositoryTransition[] = [];
      await runWithSteps([step], {
        onRepositoryTransition: (transition) => transitions.push(transition),
      });

      expect(transitions.find((transition) => transition.kind === terminalKind)).toMatchObject({
        userSuccessReserved: 0,
        userSuccessConsumed: 0,
        attemptReserved: 0,
        attemptSent: 1,
        globalReserved: 0,
        globalSent: 1,
      });
    },
  );

  it("enforces the 26s pre-send boundary through runGeneration", async () => {
    // 総予算 55s − REQUIRED_SEND 26s = 29s。29_001 で残 < 26s → 送信前中止
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 29_001;
    };
    const blocked = await runWithSteps([], { now });
    expect(blocked.result.failureCodes).toEqual(["generation_timeout"]);
    expect(blocked.requests).toHaveLength(0);

    calls = 0;
    const boundaryNow = () => {
      calls += 1;
      return calls === 1 ? 0 : 29_000;
    };
    const allowed = await runWithSteps(
      [{ kind: "output", model: primaryModel, output: validIdeaOutput() }],
      { now: boundaryNow },
    );
    expect(allowed.result.ok).toBe(true);
    expect(allowed.requests).toHaveLength(1);
  });

  it("enforces the independent 26s pre-repair boundary", async () => {
    for (const [elapsedMs, expectedOk, expectedRequests] of [
      [29_000, true, 2],
      [29_001, false, 1],
    ] as const) {
      let nowMs = 0;
      const { result, requests } = await runWithSteps(
        [
          { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
          ...(expectedOk
            ? [{ kind: "output" as const, model: repairModel, output: validIdeaOutput() }]
            : []),
        ],
        {
          now: () => nowMs,
          onRepositoryTransition: (transition) => {
            if (transition.kind === "reserve_repair") nowMs = elapsedMs;
          },
        },
      );
      expect(result.ok).toBe(expectedOk);
      expect(result.failureCodes).toEqual(expectedOk ? [] : ["generation_timeout"]);
      expect(requests).toHaveLength(expectedRequests);
    }
  });

  it.each([
    ["primary", 54_999, true],
    ["primary", 55_000, false],
    ["repair", 54_999, true],
    ["repair", 55_000, false],
  ] as const)("fails closed after %s finalize at %dms", async (path, elapsedMs, expectedOk) => {
    let nowMs = 0;
    const steps: FetchStep[] =
      path === "primary"
        ? [{ kind: "output", model: primaryModel, output: validIdeaOutput() }]
        : [
            { kind: "output", model: primaryModel, output: invalidIdeaOutput() },
            { kind: "output", model: repairModel, output: validIdeaOutput() },
          ];
    const { result } = await runWithSteps(steps, {
      now: () => nowMs,
      onRepositoryTransition: (transition) => {
        if (transition.kind === "finalize_success") nowMs = elapsedMs;
      },
    });

    expect(result.ok).toBe(expectedOk);
    expect(result.outcome).toBe(
      expectedOk ? (path === "primary" ? "primary_success" : "repair_success") : "failure",
    );
    expect(result.failureCodes).toEqual(expectedOk ? [] : ["generation_timeout"]);
    expect(result.totalElapsedMs).toBe(elapsedMs);
  });

  it("fails before any send when the total deadline is already exhausted", async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 55_000;
    };
    const { result, requests } = await runWithSteps([], { now });
    expect(result.failureCodes).toEqual(["generation_timeout"]);
    expect(result.totalElapsedMs).toBeGreaterThanOrEqual(55_000);
    expect(requests).toHaveLength(0);
  });

  it("returns code-only evidence without prompts, paths, messages, raw output, or provider bodies", async () => {
    const { result } = await runWithSteps([{ kind: "http_error", status: 503 }]);
    expect(Object.keys(result).sort()).toEqual(
      [
        "configuration",
        "diagnosticCodes",
        "failureCodes",
        "ok",
        "outcome",
        "sends",
        "totalElapsedMs",
      ].sort(),
    );
    expect(Object.keys(result.sends[0] ?? {}).sort()).toEqual(
      ["elapsedMs", "excludedModel", "models", "responseModel"].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /prompt|message|path|provider detail|raw|test-key/iu,
    );
  });
});
