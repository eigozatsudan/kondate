import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
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
  | { kind: "http_error"; status: number; elapsedMs?: number };

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
    if (step.kind === "http_error") {
      return Promise.resolve(
        new Response("provider detail must not escape", { status: step.status }),
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

  it("does not repair a known invalid response when a single-model configuration is exhausted", async () => {
    const { result, requests } = await runWithSteps(
      [{ kind: "output", model: primaryModel, output: invalidIdeaOutput() }],
      { configuration: [primaryModel] },
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "failure",
      failureCodes: ["invalid_ai_response"],
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    {
      name: "timeout",
      steps: [
        { kind: "output", model: primaryModel, output: validIdeaOutput(), elapsedMs: 20_000 },
      ],
      expectedCode: "generation_timeout",
    },
    {
      name: "model unavailable",
      steps: [{ kind: "http_error", status: 503 }],
      expectedCode: "model_unavailable",
    },
    {
      name: "constraint conflict",
      steps: [{ kind: "output", model: primaryModel, output: conflictOutput() }],
      expectedCode: "constraint_conflict",
    },
  ] satisfies readonly {
    name: string;
    steps: readonly FetchStep[];
    expectedCode: string;
  }[])("does not repair $name", async ({ steps, expectedCode }) => {
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
        "reserve",
        "mark_sent",
        "record_model",
        "reserve_repair",
        "mark_sent",
        "record_model",
        "finalize_success",
        "status",
      ]);
      expect(transitions.filter((transition) => transition.kind === "mark_sent")).toHaveLength(2);
      expect(transitions.at(-2)).toMatchObject({
        kind: "finalize_success",
        attemptsReserved: 2,
        sends: 2,
        successes: 1,
      });
    }
  });

  it("enforces the 22s pre-send boundary through runGeneration", async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 28_001;
    };
    const blocked = await runWithSteps([], { now });
    expect(blocked.result.failureCodes).toEqual(["generation_timeout"]);
    expect(blocked.requests).toHaveLength(0);

    calls = 0;
    const boundaryNow = () => {
      calls += 1;
      return calls === 1 ? 0 : 28_000;
    };
    const allowed = await runWithSteps(
      [{ kind: "output", model: primaryModel, output: validIdeaOutput() }],
      { now: boundaryNow },
    );
    expect(allowed.result.ok).toBe(true);
    expect(allowed.requests).toHaveLength(1);
  });

  it("fails closed at the 50s total boundary", async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 50_000;
    };
    const { result, requests } = await runWithSteps([], { now });
    expect(result.failureCodes).toEqual(["generation_timeout"]);
    expect(result.totalElapsedMs).toBeGreaterThanOrEqual(50_000);
    expect(requests).toHaveLength(0);
  });

  it("returns code-only evidence without prompts, paths, messages, raw output, or provider bodies", async () => {
    const { result } = await runWithSteps([{ kind: "http_error", status: 503 }]);
    expect(Object.keys(result).sort()).toEqual(
      ["configuration", "failureCodes", "ok", "outcome", "sends", "totalElapsedMs"].sort(),
    );
    expect(Object.keys(result.sends[0] ?? {}).sort()).toEqual(
      ["elapsedMs", "excludedModel", "models", "responseModel"].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /prompt|message|path|provider detail|raw|test-key/iu,
    );
  });
});
