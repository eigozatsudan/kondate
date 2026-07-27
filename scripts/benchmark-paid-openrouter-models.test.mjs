import assert from "node:assert/strict";
import test from "node:test";
import {
  OPENROUTER_MAX_BODY_BYTES,
  benchTrialCount,
  candidateModelIds,
  evaluateMechanicalFilter,
  filterCandidatesMechanically,
  loadPaidBenchmarkHarness,
  paidOpenRouterModelConfigurations,
  readResponseBodyWithByteCap,
  runConfigurationGate,
  runPaidBenchmark,
  main,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

const usablePricing = {
  prompt: "0.0000001",
  completion: "0.0000002",
};
const bothParams = ["structured_outputs", "response_format"];

test("loads the bundled production harness without network access", async () => {
  const harness = await loadPaidBenchmarkHarness();

  assert.equal(typeof harness.runPaidBenchmarkUnit, "function");
});

function remoteEntry(id, overrides = {}) {
  return {
    id,
    supported_parameters: bothParams,
    pricing: usablePricing,
    ...overrides,
  };
}

function successfulUnit(configuration, outcome = "primary_success") {
  return {
    ok: true,
    configuration: [...configuration],
    sends: [
      {
        models: [...configuration],
        responseModel: configuration[0] ?? null,
        excludedModel: null,
        elapsedMs: 100,
      },
    ],
    outcome,
    failureCodes: [],
    totalElapsedMs: 120,
  };
}

test("candidate shortlist and exact ordered configurations match the approved revision", () => {
  assert.deepEqual(
    [...candidateModelIds],
    ["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct", "openai/gpt-oss-120b"],
  );
  assert.deepEqual(
    paidOpenRouterModelConfigurations.map((configuration) => [...configuration]),
    [
      ["openai/gpt-4.1-nano"],
      ["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"],
      ["openai/gpt-4.1-nano", "openai/gpt-oss-120b"],
    ],
  );
  assert.ok(Object.isFrozen(candidateModelIds));
  assert.ok(Object.isFrozen(paidOpenRouterModelConfigurations));
  assert.ok(
    paidOpenRouterModelConfigurations.every((configuration) => Object.isFrozen(configuration)),
  );
});

test("gate constants lock N=10 and the price ceiling", () => {
  assert.equal(benchTrialCount, 10);
  assert.equal(maxPromptPlusCompletionUsdPerMillion, 0.5);
});

test("mechanical filter applies the structured-output AND and price rules", () => {
  const usable = evaluateMechanicalFilter(
    "vendor/a",
    new Map([["vendor/a", remoteEntry("vendor/a")]]),
  );
  assert.equal(usable.ok, true);

  const missingParameter = evaluateMechanicalFilter(
    "vendor/a",
    new Map([["vendor/a", remoteEntry("vendor/a", { supported_parameters: ["response_format"] })]]),
  );
  assert.equal(missingParameter.ok, false);
  assert.match(missingParameter.reason, /AND/u);

  const overPrice = evaluateMechanicalFilter(
    "vendor/a",
    new Map([
      [
        "vendor/a",
        remoteEntry("vendor/a", {
          pricing: { prompt: "0.0000003", completion: "0.0000003" },
        }),
      ],
    ]),
  );
  assert.equal(overPrice.ok, false);
  assert.match(overPrice.reason, /exceeds/u);
});

test("mechanical filter rejects coercible prices, :free IDs, routers, and missing IDs", () => {
  for (const pricing of [
    { prompt: null, completion: "0.0000001" },
    { prompt: "", completion: "0.0000001" },
    { prompt: false, completion: "0.0000001" },
  ]) {
    const result = evaluateMechanicalFilter(
      "vendor/a",
      new Map([["vendor/a", remoteEntry("vendor/a", { pricing })]]),
    );
    assert.equal(result.ok, false);
  }
  assert.equal(evaluateMechanicalFilter("vendor/a:free", new Map()).ok, false);
  assert.equal(evaluateMechanicalFilter("openrouter/auto", new Map()).ok, false);
  assert.equal(evaluateMechanicalFilter("vendor/missing", new Map()).ok, false);
});

test("usdPerMillion remains fail-closed", () => {
  assert.equal(usdPerMillion(null), null);
  assert.equal(usdPerMillion(""), null);
  assert.equal(usdPerMillion(false), null);
  assert.equal(usdPerMillion("0x0"), null);
  assert.equal(usdPerMillion("1e-6"), null);
  assert.equal(usdPerMillion("0.000001"), 1);
  assert.equal(usdPerMillion(0), 0);
});

test("readResponseBodyWithByteCap accepts max bytes and rejects max+1", async () => {
  assert.equal(OPENROUTER_MAX_BODY_BYTES, 1 * 1024 * 1024);
  const exact = "a".repeat(64);
  assert.equal(await readResponseBodyWithByteCap(new Response(exact), 64), exact);
  await assert.rejects(
    () => readResponseBodyWithByteCap(new Response("a".repeat(65)), 64),
    /response_body_over_byte_cap/u,
  );
});

test("mechanical filtering runs over the union once and rejects any configuration with a failed member", async () => {
  const chatConfigurations = [];
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    configurations: [["vendor/a"], ["vendor/a", "vendor/b"], ["vendor/a", "vendor/c"]],
    trialCount: 1,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/models/u);
      return new Response(
        JSON.stringify({
          data: [
            remoteEntry("vendor/a"),
            remoteEntry("vendor/b"),
            remoteEntry("vendor/c", { supported_parameters: ["response_format"] }),
          ],
        }),
        { status: 200 },
      );
    },
    runUnit: async ({ configuration }) => {
      chatConfigurations.push([...configuration]);
      return successfulUnit(configuration);
    },
    log: () => {},
  });

  assert.deepEqual(result.survivors, ["vendor/a", "vendor/b"]);
  assert.deepEqual(chatConfigurations, [["vendor/a"], ["vendor/a", "vendor/b"]]);
  assert.deepEqual(
    result.configurationResults.map((entry) => entry.configuration),
    [["vendor/a"], ["vendor/a", "vendor/b"]],
  );
});

test("runConfigurationGate requires exactly ten fresh successful units and counts first attempts", async () => {
  const configuration = ["vendor/a", "vendor/b"];
  let calls = 0;
  const result = await runConfigurationGate({
    configuration,
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    trialCount: 10,
    runUnit: async ({ configuration: received }) => {
      calls += 1;
      assert.notEqual(received, configuration);
      return successfulUnit(received, calls <= 7 ? "primary_success" : "repair_success");
    },
    log: () => {},
  });

  assert.equal(calls, 10);
  assert.equal(result.passed, true);
  assert.equal(result.passedUnits, 10);
  assert.equal(result.firstAttemptSuccesses, 7);
  assert.equal(result.units.length, 10);
});

test("runConfigurationGate stops a configuration after its first failed fresh unit", async () => {
  let calls = 0;
  const result = await runConfigurationGate({
    configuration: ["vendor/a"],
    apiKey: "test-key",
    baseUrl: "https://openrouter.ai/api/v1",
    trialCount: 10,
    runUnit: async ({ configuration }) => {
      calls += 1;
      if (calls === 3) {
        return {
          ...successfulUnit(configuration),
          ok: false,
          outcome: "failure",
          failureCodes: ["model_unavailable"],
        };
      }
      return successfulUnit(configuration);
    },
    log: () => {},
  });

  assert.equal(calls, 3);
  assert.equal(result.passed, false);
  assert.equal(result.passedUnits, 2);
  assert.equal(result.firstAttemptSuccesses, 2);
});

test("runPaidBenchmark recommends only a passing exact configuration without recombining IDs", async () => {
  const configurations = [["vendor/a"], ["vendor/a", "vendor/b"]];
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    configurations,
    trialCount: 2,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [remoteEntry("vendor/a"), remoteEntry("vendor/b")] }), {
        status: 200,
      }),
    runUnit: async ({ configuration }) =>
      configuration.length === 1
        ? successfulUnit(configuration)
        : {
            ...successfulUnit(configuration),
            ok: false,
            outcome: "failure",
            failureCodes: ["invalid_ai_response"],
          },
    log: () => {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.passedConfigurations, [["vendor/a"]]);
  assert.deepEqual(result.recommendedConfiguration, ["vendor/a"]);
  assert.ok(
    configurations.some(
      (configuration) =>
        JSON.stringify(configuration) === JSON.stringify(result.recommendedConfiguration),
    ),
  );
});

test("zero passing configurations returns failure and never synthesizes a recommendation", async () => {
  const result = await runPaidBenchmark({
    apiKey: "test-key",
    configurations: [["vendor/a", "vendor/b"]],
    trialCount: 10,
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: [remoteEntry("vendor/a"), remoteEntry("vendor/b")] }), {
        status: 200,
      }),
    runUnit: async ({ configuration }) => ({
      ...successfulUnit(configuration),
      ok: false,
      outcome: "failure",
      failureCodes: ["model_unavailable"],
    }),
    log: () => {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.passedConfigurations, []);
  assert.equal(result.recommendedConfiguration, null);
});

test("main returns a non-zero process exit code when no exact configuration passes", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await main(
      { OPENROUTER_API_KEY: "test-key" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              data: candidateModelIds.map((modelId) => remoteEntry(modelId)),
            }),
            { status: 200 },
          ),
        runUnit: async ({ configuration }) => ({
          ...successfulUnit(configuration),
          ok: false,
          outcome: "failure",
          failureCodes: ["model_unavailable"],
        }),
        log: () => {},
      },
    );
    assert.equal(result.ok, false);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("runPaidBenchmark requires an API key", async () => {
  await assert.rejects(
    () =>
      runPaidBenchmark({
        apiKey: "",
        runUnit: async ({ configuration }) => successfulUnit(configuration),
        fetchImpl: async () => new Response("{}", { status: 200 }),
        log: () => {},
      }),
    /OPENROUTER_API_KEY/u,
  );
});

test("filterCandidatesMechanically returns ordered survivors and exclusions", () => {
  const result = filterCandidatesMechanically(["keep/me", "drop/me"], [remoteEntry("keep/me")]);
  assert.deepEqual(result.survivors, ["keep/me"]);
  assert.deepEqual(
    result.exclusions.map((entry) => entry.id),
    ["drop/me"],
  );
});
