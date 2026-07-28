/**
 * 警告: 実行すると OpenRouter の有料課金が発生する。
 *
 * 候補IDのunionを機械フィルタした後、承認済みのexact順序付き構成ごとに
 * production runGeneration harnessをN=10単位実行する。個別IDの結果は再結合しない。
 */

import * as esbuild from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const harnessEntry = join(
  repoRoot,
  "netlify/functions/_shared/paid-openrouter-benchmark-harness.ts",
);

/** 本番 openrouter.ts と同じ1 MiB上限。Models APIにも適用する。 */
export const OPENROUTER_MAX_BODY_BYTES = 1 * 1024 * 1024;
export const benchTrialCount = 10;
export const modelsApiTimeoutMs = 5_000;
export const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";
export const officialModelsUrl = `${officialOpenRouterBaseUrl}/models?output_modalities=text`;

/** 上位モデル検証 shortlist — decision: docs/bugfix/artifacts/r1-higher-tier-decision-record-2026-07-28.md */
export const candidateModelIds = Object.freeze([
  "openai/gpt-4o-mini",
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-v3.2",
  "qwen/qwen-2.5-72b-instruct",
  "openai/gpt-4.1-nano",
]);

export const paidOpenRouterModelConfigurations = Object.freeze([
  Object.freeze(["openai/gpt-4o-mini"]),
  Object.freeze(["meta-llama/llama-3.3-70b-instruct"]),
  Object.freeze(["deepseek/deepseek-v3.2"]),
  Object.freeze(["qwen/qwen-2.5-72b-instruct"]),
  // nano 単独は第4 identical のため禁止。高速 repair スロット。
  Object.freeze(["openai/gpt-4o-mini", "openai/gpt-4.1-nano"]),
  Object.freeze(["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4.1-nano"]),
]);

/** 設計 §5.3.0c — configuration[1] 禁止集合 */
export const cfgRepairSlowIds = Object.freeze(["openai/gpt-oss-120b"]);

/**
 * @param {Response} response
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
export async function readResponseBodyWithByteCap(response, maxBytes = OPENROUTER_MAX_BODY_BYTES) {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("response_body_over_byte_cap");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("response_body_over_byte_cap");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/**
 * @param {unknown} tokenPrice
 * @returns {number | null}
 */
export function usdPerMillion(tokenPrice) {
  if (typeof tokenPrice === "number") {
    if (!Number.isFinite(tokenPrice) || tokenPrice < 0) return null;
    return tokenPrice * 1e6;
  }
  if (typeof tokenPrice === "string") {
    const trimmed = tokenPrice.trim();
    if (trimmed === "" || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed * 1e6;
  }
  return null;
}

/**
 * @param {string} modelId
 * @param {Map<string, object>} remoteById
 * @returns {{ ok: true, model: object } | { ok: false, reason: string }}
 */
export function evaluateMechanicalFilter(modelId, remoteById) {
  if (typeof modelId !== "string" || modelId.length === 0) {
    return { ok: false, reason: "empty model id" };
  }
  if (modelId.endsWith(":free")) {
    return { ok: false, reason: "rejects :free on real API path" };
  }
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  if (routers.has(modelId)) {
    return { ok: false, reason: "rejects router model ID" };
  }
  const model = remoteById.get(modelId);
  if (!model) {
    return { ok: false, reason: "not present in OpenRouter Models API" };
  }
  const parameters = new Set(
    Array.isArray(model.supported_parameters) ? model.supported_parameters : [],
  );
  if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
    return {
      ok: false,
      reason: "missing structured_outputs AND/OR response_format (AND required)",
    };
  }
  const prompt = usdPerMillion(model.pricing?.prompt);
  const completion = usdPerMillion(model.pricing?.completion);
  if (prompt === null || completion === null) {
    return { ok: false, reason: "missing usable pricing.prompt/completion" };
  }
  if (prompt + completion > maxPromptPlusCompletionUsdPerMillion) {
    return {
      ok: false,
      reason: `exceeds max prompt+completion USD per 1M tokens (${prompt + completion} > ${maxPromptPlusCompletionUsdPerMillion})`,
    };
  }
  return { ok: true, model };
}

/**
 * @param {readonly string[]} candidateIds
 * @param {unknown} remoteModels
 * @returns {{ survivors: string[], exclusions: { id: string, reason: string }[] }}
 */
export function filterCandidatesMechanically(candidateIds, remoteModels) {
  const remoteById = new Map(
    (Array.isArray(remoteModels) ? remoteModels : []).map((model) => [model.id, model]),
  );
  const survivors = [];
  const exclusions = [];
  for (const id of candidateIds) {
    const result = evaluateMechanicalFilter(id, remoteById);
    if (result.ok) {
      survivors.push(id);
    } else {
      exclusions.push({ id, reason: result.reason });
    }
  }
  return { survivors, exclusions };
}

let harnessModulePromise = null;

/**
 * TypeScript production harnessを一度だけbundleし、単位計測の外で読み込む。
 */
export async function loadPaidBenchmarkHarness() {
  if (harnessModulePromise) return harnessModulePromise;
  harnessModulePromise = (async () => {
    const outDir = await mkdtemp(join(tmpdir(), "kondate-paid-openrouter-benchmark-"));
    const outfile = join(outDir, "paid-openrouter-benchmark-harness.mjs");
    try {
      await esbuild.build({
        entryPoints: [harnessEntry],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        outfile,
        packages: "bundle",
        logLevel: "silent",
      });
      return await import(outfile);
    } finally {
      // この実行が作成した一意なprivate directoryだけを削除し、共有pathへ触れない。
      await rm(outDir, { recursive: true, force: true });
    }
  })();
  return harnessModulePromise;
}

/**
 * @param {{
 *   configuration: readonly string[];
 *   apiKey: string;
 *   baseUrl: string;
 *   trialCount?: number;
 *   fetchImpl?: typeof fetch;
 *   runUnit: (input: {
 *     configuration: readonly string[];
 *     apiKey: string;
 *     baseUrl: string;
 *     fetchImpl?: typeof fetch;
 *   }) => Promise<{
 *     ok: boolean;
 *     configuration: readonly string[];
 *     sends: readonly object[];
 *     outcome: "primary_success" | "repair_success" | "failure";
 *     failureCodes: readonly string[];
 *     diagnosticCodes?: readonly string[];
 *     totalElapsedMs: number;
 *   }>;
 *   log?: (line: string) => void;
 * }} input
 */
export async function runConfigurationGate({
  configuration,
  apiKey,
  baseUrl,
  trialCount = benchTrialCount,
  fetchImpl,
  runUnit,
  log = () => {},
}) {
  const units = [];
  let passedUnits = 0;
  let firstAttemptSuccesses = 0;
  for (let index = 0; index < trialCount; index += 1) {
    // 呼び出しごとに配列もfresh化し、harness内のfresh repositoryと単位境界を一致させる。
    const unit = await runUnit({
      configuration: Object.freeze([...configuration]),
      apiKey,
      baseUrl,
      fetchImpl,
    });
    units.push(unit);
    if (unit.ok) {
      passedUnits += 1;
      if (unit.outcome === "primary_success") firstAttemptSuccesses += 1;
    }
    log(
      JSON.stringify({
        configuration,
        unit: index + 1,
        ok: unit.ok,
        outcome: unit.outcome,
        failureCodes: unit.failureCodes,
        // closed materialize/validate codes only（raw 出力なし）
        diagnosticCodes: unit.diagnosticCodes ?? [],
        sends: unit.sends,
        totalElapsedMs: unit.totalElapsedMs,
      }),
    );
    if (!unit.ok) break;
  }
  return {
    configuration: [...configuration],
    passed: passedUnits === trialCount,
    passedUnits,
    firstAttemptSuccesses,
    units,
  };
}

/**
 * 候補unionを一度だけ機械フィルタし、全memberが残ったexact構成だけを評価する。
 */
export async function runPaidBenchmark({
  apiKey,
  configurations = paidOpenRouterModelConfigurations,
  trialCount = benchTrialCount,
  fetchImpl = fetch,
  createModelsSignal = () => AbortSignal.timeout(modelsApiTimeoutMs),
  runUnit,
  log = (line) => {
    process.stdout.write(`${line}\n`);
  },
}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required (live paid benchmark incurs charges)");
  }
  const exactConfigurations = configurations.map((configuration) =>
    Object.freeze([...configuration]),
  );
  const candidateUnion = [...new Set(exactConfigurations.flat())];

  log("=== Paid OpenRouter exact-configuration benchmark (DESIGN §4.4.2) ===");
  log("WARNING: This run incurs paid OpenRouter usage.");
  let modelsResponse;
  try {
    modelsResponse = await fetchImpl(officialModelsUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: createModelsSignal(),
    });
  } catch {
    throw new Error("openrouter_models_unavailable");
  }
  if (!modelsResponse.ok) {
    throw new Error(`OpenRouter Models API returned ${modelsResponse.status}`);
  }

  let body;
  try {
    body = JSON.parse(await readResponseBodyWithByteCap(modelsResponse, OPENROUTER_MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof Error && error.message === "response_body_over_byte_cap") {
      throw new Error("OpenRouter Models API body exceeds byte cap");
    }
    throw new Error("OpenRouter Models API returned an invalid body");
  }
  if (!body || !Array.isArray(body.data)) {
    throw new Error("OpenRouter Models API returned an invalid body");
  }

  const { survivors, exclusions } = filterCandidatesMechanically(candidateUnion, body.data);
  const survivorSet = new Set(survivors);
  const eligibleConfigurations = exactConfigurations.filter(
    (configuration) =>
      configuration.length >= 1 &&
      configuration.length <= 2 &&
      new Set(configuration).size === configuration.length &&
      configuration.every((modelId) => survivorSet.has(modelId)),
  );
  for (const { id, reason } of exclusions) log(`EXCLUDE ${id}: ${reason}`);
  for (const configuration of exactConfigurations) {
    if (!eligibleConfigurations.includes(configuration)) {
      log(`EXCLUDE CONFIGURATION ${JSON.stringify(configuration)}: member failed filter`);
    }
  }

  const unitRunner = runUnit ?? (await loadPaidBenchmarkHarness()).runPaidBenchmarkUnit;
  const configurationResults = [];
  const passedConfigurations = [];
  for (const configuration of eligibleConfigurations) {
    const result = await runConfigurationGate({
      configuration,
      apiKey,
      baseUrl: officialOpenRouterBaseUrl,
      trialCount,
      fetchImpl,
      runUnit: unitRunner,
      log,
    });
    configurationResults.push(result);
    if (result.passed) passedConfigurations.push([...configuration]);
  }
  const recommendedConfiguration = passedConfigurations[0] ?? null;
  const ok = passedConfigurations.length > 0;
  log(
    JSON.stringify({
      ok,
      passedConfigurations,
      recommendedConfiguration,
      firstAttemptSuccesses: configurationResults.map((result) => ({
        configuration: result.configuration,
        count: result.firstAttemptSuccesses,
      })),
    }),
  );
  if (!ok) {
    log("No exact configuration passed N=10. Gate FAIL; do not synthesize a recommendation.");
  }
  return {
    ok,
    exclusions,
    survivors,
    eligibleConfigurations: eligibleConfigurations.map((configuration) => [...configuration]),
    passedConfigurations,
    recommendedConfiguration,
    configurationResults,
  };
}

/**
 * R1 CLI: --trial-count=N / --configurations-json='[[...]]'
 * 未指定時は frozen 全構成・benchTrialCount（後方互換）。
 * @param {string[]} argv process.argv.slice(2) 相当
 * @returns {{ trialCount?: number, configurations?: string[][] }}
 */
export function parseBenchmarkCliArgs(argv) {
  /** @type {{ trialCount?: number, configurations?: string[][] }} */
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith("--trial-count=")) {
      const raw = arg.slice("--trial-count=".length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > benchTrialCount) {
        throw new Error(
          `--trial-count must be an integer from 1 to ${benchTrialCount} (got ${JSON.stringify(raw)})`,
        );
      }
      out.trialCount = n;
      continue;
    }
    if (arg.startsWith("--configurations-json=")) {
      const raw = arg.slice("--configurations-json=".length);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("--configurations-json must be valid JSON");
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("--configurations-json must be a non-empty array of configurations");
      }
      const configurations = parsed.map((configuration, index) => {
        if (!Array.isArray(configuration) || configuration.length < 1 || configuration.length > 2) {
          throw new Error(`--configurations-json[${index}] must be an array of 1 or 2 model IDs`);
        }
        if (!configuration.every((id) => typeof id === "string" && id.length > 0)) {
          throw new Error(
            `--configurations-json[${index}] must contain non-empty string model IDs`,
          );
        }
        if (new Set(configuration).size !== configuration.length) {
          throw new Error(`--configurations-json[${index}] must not contain duplicate model IDs`);
        }
        return [...configuration];
      });
      out.configurations = configurations;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: node scripts/benchmark-paid-openrouter-models.mjs [--trial-count=N] [--configurations-json='[[\"model\"]]']",
      );
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export async function main(env = process.env, deps = {}, argv = process.argv.slice(2)) {
  const cli = parseBenchmarkCliArgs(argv);
  const result = await runPaidBenchmark({
    apiKey: env.OPENROUTER_API_KEY,
    configurations: cli.configurations ?? paidOpenRouterModelConfigurations,
    trialCount: cli.trialCount ?? benchTrialCount,
    fetchImpl: deps.fetchImpl,
    createModelsSignal: deps.createModelsSignal,
    runUnit: deps.runUnit,
    log: deps.log,
  });
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "paid openrouter benchmark failed"}\n`,
    );
    process.exitCode = 1;
  });
}
