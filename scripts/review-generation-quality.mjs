/**
 * idea 固定入力での生成品質レビュー（本番 sender + materialize + validate）。
 * 出力: closed スコア + 調理可能性チェック + 献立要約（検証済み構造のみ）。
 * raw wire / prompt / キーは出さない。課金あり。
 *
 *   docker compose run --rm --no-deps app node scripts/review-generation-quality.mjs \
 *     --models=inception/mercury-2,openai/gpt-4.1-mini --trials=2
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { officialOpenRouterBaseUrl } from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const reviewEntry = join(repoRoot, "netlify/functions/_shared/generation-quality-review-entry.ts");

function parseArgs(argv) {
  let models = [];
  let trials = 1;
  for (const arg of argv) {
    if (arg.startsWith("--models=")) {
      models = arg
        .slice("--models=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--trials=")) {
      trials = Number(arg.slice("--trials=".length));
      if (!Number.isInteger(trials) || trials < 1 || trials > 5) {
        throw new Error("--trials must be 1..5");
      }
    }
  }
  if (models.length === 0) {
    throw new Error("Usage: review-generation-quality.mjs --models=id1,id2 [--trials=2]");
  }
  return { models, trials };
}

async function loadReviewModule() {
  const outDir = await mkdtemp(join(tmpdir(), "kondate-quality-review-"));
  const outfile = join(outDir, "generation-quality-review.mjs");
  try {
    await esbuild.build({
      entryPoints: [reviewEntry],
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
    await rm(outDir, { recursive: true, force: true });
  }
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const { models, trials } = parseArgs(argv);
  const apiKey = env.OPENROUTER_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  const mod = await loadReviewModule();
  const rows = [];
  process.stdout.write(
    JSON.stringify({
      kind: "review_header",
      models,
      trials,
      fixture: "idea breakfast 2 servings main=鶏もも肉 timeLimit=15 empty pantry",
    }) + "\n",
  );

  for (const id of models) {
    for (let t = 1; t <= trials; t += 1) {
      const result = await mod.reviewGenerationQuality({
        modelId: id,
        apiKey,
        baseUrl: officialOpenRouterBaseUrl,
      });
      const row = { modelId: id, trial: t, ...result };
      rows.push(row);
      process.stdout.write(JSON.stringify({ kind: "review", ...row }) + "\n");
    }
  }

  const byModel = {};
  for (const row of rows) {
    byModel[row.modelId] ??= [];
    byModel[row.modelId].push(row);
  }
  const summary = {
    kind: "summary",
    models: Object.entries(byModel).map(([modelId, trialsRows]) => {
      const ok = trialsRows.filter((r) => r.ok).length;
      const scores = trialsRows.filter((r) => r.ok).map((r) => r.score.total);
      const avg = scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
      return {
        modelId,
        trials: trialsRows.length,
        successCount: ok,
        avgScore: avg === null ? null : Math.round(avg * 10) / 10,
        failureCodes: [...new Set(trialsRows.flatMap((r) => (r.ok ? [] : (r.failureCodes ?? []))))],
        cookabilityFails: [
          ...new Set(trialsRows.flatMap((r) => (r.ok ? (r.score.failFlags ?? []) : ["not_ok"]))),
        ],
      };
    }),
  };
  process.stdout.write(JSON.stringify(summary) + "\n");

  const day = new Date().toISOString().slice(0, 10);
  const outPath = join(repoRoot, "docs/archive/bugfix/artifacts", `quality-review-${day}.json`);
  mkdirSync(join(repoRoot, "docs/archive/bugfix/artifacts"), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        snapshotDate: new Date().toISOString(),
        fixture: "idea breakfast servings=2 main=鶏もも肉 timeLimitMinutes=15 pantry=[]",
        rows,
        summary: summary.models,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(JSON.stringify({ kind: "wrote", path: outPath }) + "\n");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "quality review failed"}\n`);
    process.exitCode = 1;
  });
}
