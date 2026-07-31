import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  OPENROUTER_MAX_BODY_BYTES,
  benchTrialCount,
  candidateModelIds,
  cfgRepairSlowIds,
  evaluateMechanicalFilter,
  filterCandidatesMechanically,
  loadPaidBenchmarkHarness,
  paidOpenRouterModelConfigurations,
  readResponseBodyWithByteCap,
  runConfigurationGate,
  runPaidBenchmark,
  main,
  parseBenchmarkCliArgs,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

const usablePricing = {
  prompt: "0.0000001",
  completion: "0.0000002",
};
const bothParams = ["structured_outputs", "response_format"];

test("loads the bundled production harness without network access", async () => {
  const [first, second] = await Promise.all([
    loadPaidBenchmarkHarness(),
    loadPaidBenchmarkHarness(),
  ]);

  assert.strictEqual(first, second);
  assert.equal(typeof first.runPaidBenchmarkUnit, "function");
});

async function withIsolatedTmp(run) {
  const sandbox = await mkdtemp(join(tmpdir(), "kondate-paid-openrouter-loader-test-"));
  const previousTmpDir = process.env.TMPDIR;
  process.env.TMPDIR = sandbox;
  try {
    await run(sandbox);
  } finally {
    if (previousTmpDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTmpDir;
    }
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function importFreshBenchmarkModule(label) {
  const moduleUrl = new URL("./benchmark-paid-openrouter-models.mjs", import.meta.url);
  moduleUrl.searchParams.set("loader-test", label);
  return import(moduleUrl.href);
}

test("does not use, replace, or remove an adversarial legacy fixed-path symlink", async () => {
  await withIsolatedTmp(async (sandbox) => {
    const legacyDir = join(sandbox, "kondate-paid-openrouter-benchmark");
    const legacyLeaf = join(legacyDir, "paid-openrouter-benchmark-harness.mjs");
    const canary = join(sandbox, "legacy-canary.mjs");
    const canaryBody = "export const untouched = true;\n";
    await mkdir(legacyDir);
    await writeFile(canary, canaryBody);
    await symlink(canary, legacyLeaf);

    const benchmark = await importFreshBenchmarkModule(`canary-${basename(sandbox)}`);
    const harness = await benchmark.loadPaidBenchmarkHarness();

    assert.equal(typeof harness.runPaidBenchmarkUnit, "function");
    assert.equal(await readFile(canary, "utf8"), canaryBody);
    assert.equal((await lstat(legacyLeaf)).isSymbolicLink(), true);
    assert.equal(await readlink(legacyLeaf), canary);
  });
});

test("independent concurrent loaders do not create a shared fixed leaf", async () => {
  await withIsolatedTmp(async (sandbox) => {
    const [firstModule, secondModule] = await Promise.all([
      importFreshBenchmarkModule(`concurrent-a-${basename(sandbox)}`),
      importFreshBenchmarkModule(`concurrent-b-${basename(sandbox)}`),
    ]);
    const [first, second] = await Promise.all([
      firstModule.loadPaidBenchmarkHarness(),
      secondModule.loadPaidBenchmarkHarness(),
    ]);

    assert.equal(typeof first.runPaidBenchmarkUnit, "function");
    assert.equal(typeof second.runPaidBenchmarkUnit, "function");
    assert.deepEqual(await readdir(sandbox), []);
  });
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
    diagnosticCodes: [],
    totalElapsedMs: 120,
  };
}

test("candidate shortlist and exact ordered configurations match the N=10 freeze", () => {
  assert.deepEqual(
    [...candidateModelIds],
    [
      "openai/gpt-5.6-luna",
      "openai/gpt-4.1-mini",
      "inception/mercury-2",
      "openai/gpt-4.1-nano",
      "x-ai/grok-4.3",
    ],
  );
  assert.deepEqual(
    paidOpenRouterModelConfigurations.map((configuration) => [...configuration]),
    [
      ["openai/gpt-5.6-luna"],
      ["openai/gpt-4.1-mini"],
      ["inception/mercury-2"],
      ["inception/mercury-2", "openai/gpt-4.1-nano"],
      ["x-ai/grok-4.3"],
    ],
  );
  assert.ok(Object.isFrozen(candidateModelIds));
  assert.ok(Object.isFrozen(paidOpenRouterModelConfigurations));
  assert.ok(
    paidOpenRouterModelConfigurations.every((configuration) => Object.isFrozen(configuration)),
  );
  // R1 KD-R1-11: shortlist set equals configuration member union
  assert.deepEqual(
    [...new Set(candidateModelIds)].sort(),
    [
      ...new Set(paidOpenRouterModelConfigurations.flatMap((configuration) => [...configuration])),
    ].sort(),
  );
  // KD-R1-17: frozen IDs ⊆ committed survivor artifact（P*=$4 snapshot）
  const artifactPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-28.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const survivorIds = new Set(artifact.survivors.map((row) => row.id));
  for (const id of candidateModelIds) {
    assert.ok(survivorIds.has(id), `shortlist id missing from survivor artifact: ${id}`);
  }
  // CFG-REPAIR-SLOW must not appear as configuration[1]
  for (const configuration of paidOpenRouterModelConfigurations) {
    if (configuration.length === 2) {
      assert.equal(cfgRepairSlowIds.includes(configuration[1]), false);
    }
  }
  // Round-4 identical arrays must not be in the mandatory set
  const r4Identical = new Set([
    JSON.stringify(["openai/gpt-4.1-nano"]),
    JSON.stringify(["openai/gpt-4.1-nano", "meta-llama/llama-3.1-8b-instruct"]),
    JSON.stringify(["openai/gpt-4.1-nano", "openai/gpt-oss-120b"]),
  ]);
  for (const configuration of paidOpenRouterModelConfigurations) {
    assert.equal(r4Identical.has(JSON.stringify([...configuration])), false);
  }
});

test("parseBenchmarkCliArgs accepts trial count and configurations JSON", () => {
  assert.deepEqual(parseBenchmarkCliArgs([]), {});
  assert.deepEqual(parseBenchmarkCliArgs(["--trial-count=1"]), { trialCount: 1 });
  assert.deepEqual(
    parseBenchmarkCliArgs(['--configurations-json=[["a/b"],["a/b","c/d"]]', "--trial-count=3"]),
    {
      trialCount: 3,
      configurations: [["a/b"], ["a/b", "c/d"]],
    },
  );
  assert.throws(() => parseBenchmarkCliArgs(["--trial-count=0"]), /trial-count/);
  assert.throws(() => parseBenchmarkCliArgs(["--trial-count=11"]), /trial-count/);
  assert.throws(() => parseBenchmarkCliArgs(["--configurations-json=not-json"]), /valid JSON/);
  assert.throws(() => parseBenchmarkCliArgs(['--configurations-json=[["a","a"]]']), /duplicate/);
  assert.throws(() => parseBenchmarkCliArgs(["--unknown"]), /Unknown argument/);
});

test("main forwards CLI trialCount and configurations to runPaidBenchmark", async () => {
  const seen = [];
  const unit = {
    ok: true,
    configuration: ["vendor/a"],
    sends: [],
    outcome: "primary_success",
    failureCodes: [],
    totalElapsedMs: 1,
  };
  await main(
    { OPENROUTER_API_KEY: "test-key" },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "vendor/a",
                supported_parameters: bothParams,
                pricing: usablePricing,
              },
            ],
          }),
          { status: 200 },
        ),
      runUnit: async (input) => {
        seen.push(input);
        return { ...unit, configuration: [...input.configuration] };
      },
      log: () => {},
    },
    ["--trial-count=1", '--configurations-json=[["vendor/a"]]'],
  );
  assert.equal(seen.length, 1);
  assert.deepEqual([...seen[0].configuration], ["vendor/a"]);
});

test("gate constants lock N=10 and the price ceiling", () => {
  assert.equal(benchTrialCount, 10);
  assert.equal(maxPromptPlusCompletionUsdPerMillion, 4);
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
          // $2.10 + $2.10 = $4.20 / 1M > P*=4
          pricing: { prompt: "0.0000021", completion: "0.0000021" },
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
