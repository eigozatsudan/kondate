/**
 * 有料モデルの closed subcode 診断（N=1 / 構成ごと）。
 * 本番 gate ではない。機械フィルタ結果を必ず併記し、EXCLUDE モデルでも
 * 診断目的で 1 回だけ chat し得る（結果を production freeze に使わない）。
 *
 * 出力: closed な code / elapsed / filter 結果のみ。キー・raw 出力は出さない。
 *
 * 使い方:
 *   docker compose run --rm --no-deps app node scripts/diagnose-paid-models-closed.mjs \
 *     --models=id1,id2
 */

import {
  evaluateMechanicalFilter,
  officialOpenRouterBaseUrl,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";
import { loadPaidBenchmarkHarness } from "./benchmark-paid-openrouter-models.mjs";

const modelsUrl = `${officialOpenRouterBaseUrl}/models?output_modalities=text`;

function parseArgs(argv) {
  let models = [];
  for (const arg of argv) {
    if (arg.startsWith("--models=")) {
      models = arg
        .slice("--models=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  if (models.length === 0) {
    throw new Error("Usage: diagnose-paid-models-closed.mjs --models=id1,id2");
  }
  return { models };
}

async function fetchCatalog(apiKey) {
  const response = await fetch(modelsUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Models API ${response.status}`);
  const body = await response.json();
  if (!body || !Array.isArray(body.data)) throw new Error("invalid models body");
  return new Map(body.data.map((model) => [model.id, model]));
}

function filterReport(id, remoteById) {
  const model = remoteById.get(id);
  if (!model) {
    return {
      id,
      present: false,
      mechanical: "ABSENT",
      reason: "not present in OpenRouter Models API",
      usdPer1M: null,
      hasStructuredOutputs: false,
      hasResponseFormat: false,
      withinPriceCap: false,
    };
  }
  const params = new Set(
    Array.isArray(model.supported_parameters) ? model.supported_parameters : [],
  );
  const prompt = usdPerMillion(model.pricing?.prompt);
  const completion = usdPerMillion(model.pricing?.completion);
  const usdPer1M = prompt !== null && completion !== null ? prompt + completion : null;
  const result = evaluateMechanicalFilter(id, remoteById);
  return {
    id,
    present: true,
    mechanical: result.ok ? "KEEP" : "EXCLUDE",
    reason: result.ok ? null : result.reason,
    usdPer1M,
    hasStructuredOutputs: params.has("structured_outputs"),
    hasResponseFormat: params.has("response_format"),
    withinPriceCap: usdPer1M !== null && usdPer1M <= maxPromptPlusCompletionUsdPerMillion,
    priceCap: maxPromptPlusCompletionUsdPerMillion,
  };
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const { models } = parseArgs(argv);
  const apiKey = env.OPENROUTER_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  process.stdout.write(
    JSON.stringify({
      kind: "diagnose_header",
      priceCapUsdPer1M: maxPromptPlusCompletionUsdPerMillion,
      modelCount: models.length,
      note: "diagnostic only; EXCLUDE models are still attempted once for closed-code evidence",
    }) + "\n",
  );

  const remoteById = await fetchCatalog(apiKey);
  const harness = await loadPaidBenchmarkHarness();
  const rows = [];

  for (const id of models) {
    const filter = filterReport(id, remoteById);
    process.stdout.write(JSON.stringify({ kind: "filter", ...filter }) + "\n");

    if (!filter.present) {
      rows.push({ ...filter, live: null });
      continue;
    }

    // 診断: 機械フィルタ EXCLUDE でも 1 回だけ production harness を回す（freeze 禁止）
    let live;
    try {
      const unit = await harness.runPaidBenchmarkUnit({
        configuration: Object.freeze([id]),
        apiKey,
        baseUrl: officialOpenRouterBaseUrl,
      });
      live = {
        ok: unit.ok,
        outcome: unit.outcome,
        failureCodes: [...unit.failureCodes],
        diagnosticCodes: [...(unit.diagnosticCodes ?? [])],
        totalElapsedMs: unit.totalElapsedMs,
        sends: unit.sends.map((send) => ({
          models: [...send.models],
          responseModel: send.responseModel,
          excludedModel: send.excludedModel,
          elapsedMs: send.elapsedMs,
        })),
      };
    } catch {
      live = {
        ok: false,
        outcome: "failure",
        failureCodes: ["diagnostic_runner_error"],
        diagnosticCodes: ["runner_exception"],
        totalElapsedMs: null,
        sends: [],
      };
    }
    process.stdout.write(JSON.stringify({ kind: "live", id, ...live }) + "\n");
    rows.push({ filter, live });
  }

  process.stdout.write(
    JSON.stringify({
      kind: "summary",
      rows: rows.map((row) => ({
        id: row.filter?.id ?? row.id,
        mechanical: row.filter?.mechanical ?? row.mechanical,
        usdPer1M: row.filter?.usdPer1M ?? null,
        failureCodes: row.live?.failureCodes ?? null,
        diagnosticCodes: row.live?.diagnosticCodes ?? null,
        totalElapsedMs: row.live?.totalElapsedMs ?? null,
      })),
    }) + "\n",
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "diagnose failed"}\n`);
    process.exitCode = 1;
  });
}
