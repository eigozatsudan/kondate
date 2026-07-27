/**
 * R1 Stage 1: Models API カタログ完全列挙 + 機械フィルタ survivor 表を書く。
 * 設計: docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md §5.2.0
 *
 * Method B（Stage-1 専用高予算・1 発取得）。本番 chat の 1 MiB / 5s は変更しない。
 * 有料キーが必要。キー・生 body・raw model output は成果物に書かない。
 *
 * 使い方:
 *   docker compose run --rm --no-deps app node scripts/snapshot-openrouter-models-catalog.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMechanicalFilter,
  officialOpenRouterBaseUrl,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Stage-1 only — not production chat caps (KD-R1-14 Method B). */
export const stage1ModelsTimeoutMs = 60_000;
export const stage1ModelsMaxBodyBytes = 8 * 1024 * 1024;
export const stage1ModelsUrl = `${officialOpenRouterBaseUrl}/models?output_modalities=text`;

/** 設計 §5.3.0 closed EX-B */
export const closedExBIds = Object.freeze([
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3.5-flash-02-23",
  "z-ai/glm-4.7-flash",
  "mistralai/mistral-small-3.2-24b-instruct",
  "qwen/qwen3-30b-a3b-instruct-2507",
]);

/** 設計 §5.3.0b closed EX-404 */
export const closedEx404Ids = Object.freeze(["openai/gpt-5-nano"]);

/** 設計 §5.3.0c closed CFG-REPAIR-SLOW */
export const closedCfgRepairSlowIds = Object.freeze(["openai/gpt-oss-120b"]);

/**
 * @param {Response} response
 * @param {number} maxBytes
 */
export async function readBodyWithCap(response, maxBytes) {
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
 * @param {string} text
 */
export function sha256Hex(text) {
  // Node crypto — dynamic import avoided for sync testability via WebCrypto when available
  return import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(text, "utf8").digest("hex"),
  );
}

/**
 * @param {{
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 * }} input
 */
export async function buildCatalogSnapshot({ apiKey, fetchImpl = fetch, now = () => new Date() }) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required for Stage-1 catalog snapshot");
  }

  let response;
  try {
    response = await fetchImpl(stage1ModelsUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(stage1ModelsTimeoutMs),
    });
  } catch {
    throw new Error("openrouter_models_unavailable");
  }
  if (!response.ok) {
    throw new Error(`OpenRouter Models API returned ${response.status}`);
  }

  let text;
  try {
    text = await readBodyWithCap(response, stage1ModelsMaxBodyBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "response_body_over_byte_cap") {
      throw new Error(
        "Stage-1 Models API body exceeds 8 MiB cap; use Method A pagination or raise Stage-1 cap in a design revision",
      );
    }
    throw error;
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("OpenRouter Models API returned an invalid body");
  }
  if (!body || !Array.isArray(body.data)) {
    throw new Error("OpenRouter Models API returned an invalid body");
  }

  const entryCount = body.data.length;
  if (entryCount === 0) {
    throw new Error("OpenRouter Models API returned empty data[]");
  }

  /** Method B completeness: single response finished under Stage-1 caps with non-empty data[]. */
  const completenessProof = {
    method: "B_single_response_stage1_budget",
    timeoutMs: stage1ModelsTimeoutMs,
    maxBodyBytes: stage1ModelsMaxBodyBytes,
    entryCount,
    totalCountField:
      typeof body.total_count === "number"
        ? body.total_count
        : typeof body.total === "number"
          ? body.total
          : null,
  };
  if (
    completenessProof.totalCountField !== null &&
    completenessProof.totalCountField !== entryCount
  ) {
    throw new Error(
      `catalog completeness failed: entryCount=${entryCount} total_count=${completenessProof.totalCountField}`,
    );
  }

  const remoteById = new Map(body.data.map((model) => [model.id, model]));
  const allIds = body.data
    .map((model) => model.id)
    .filter((id) => typeof id === "string" && id.length > 0);

  const mechanicalExclusions = [];
  const mechanicalSurvivors = [];
  for (const id of allIds) {
    const result = evaluateMechanicalFilter(id, remoteById);
    if (result.ok) {
      const prompt = usdPerMillion(result.model.pricing?.prompt);
      const completion = usdPerMillion(result.model.pricing?.completion);
      mechanicalSurvivors.push({
        id,
        promptPlusCompletionUsdPerMillion:
          prompt !== null && completion !== null ? prompt + completion : null,
      });
    } else {
      mechanicalExclusions.push({ id, reason: result.reason });
    }
  }

  const exB = new Set(closedExBIds);
  const ex404 = new Set(closedEx404Ids);
  const exIdApplied = [];
  const postExSurvivors = [];
  for (const row of mechanicalSurvivors) {
    if (exB.has(row.id)) {
      exIdApplied.push({ id: row.id, rule: "EX-B" });
      continue;
    }
    if (ex404.has(row.id)) {
      exIdApplied.push({ id: row.id, rule: "EX-404" });
      continue;
    }
    if (typeof row.id === "string" && row.id.startsWith("google/gemini")) {
      exIdApplied.push({ id: row.id, rule: "EX-GEM" });
      continue;
    }
    postExSurvivors.push(row);
  }

  const modelsResponseSha256 = await sha256Hex(text);
  const snapshotDate = now().toISOString();

  return {
    snapshotDate,
    enumerationMethod: "B",
    entryCount,
    completenessProof,
    models_response_sha256: modelsResponseSha256,
    survivors: postExSurvivors,
    mechanicalSurvivors,
    mechanicalExclusions,
    exIdRulesApplied: exIdApplied,
    exConfigRulesApplied: {
      CFG_REPAIR_SLOW: [...closedCfgRepairSlowIds],
    },
    officialBaseUrl: officialOpenRouterBaseUrl,
    modelsUrl: stage1ModelsUrl,
  };
}

export async function main(env = process.env) {
  const snapshot = await buildCatalogSnapshot({ apiKey: env.OPENROUTER_API_KEY });
  const day = snapshot.snapshotDate.slice(0, 10);
  const outDir = join(repoRoot, "docs/bugfix/artifacts");
  const outPath = join(outDir, `r1-models-snapshot-${day}.json`);
  await mkdir(outDir, { recursive: true });
  // 秘密・生 body なしの closed 成果物のみ書く
  const artifact = {
    snapshotDate: snapshot.snapshotDate,
    enumerationMethod: snapshot.enumerationMethod,
    entryCount: snapshot.entryCount,
    completenessProof: snapshot.completenessProof,
    models_response_sha256: snapshot.models_response_sha256,
    officialBaseUrl: snapshot.officialBaseUrl,
    modelsUrl: snapshot.modelsUrl,
    survivors: snapshot.survivors,
    mechanicalExclusionsCount: snapshot.mechanicalExclusions.length,
    mechanicalSurvivorsCount: snapshot.mechanicalSurvivors.length,
    exIdRulesApplied: snapshot.exIdRulesApplied,
    exConfigRulesApplied: snapshot.exConfigRulesApplied,
    // 機械除外は件数が多いので reason 別集計のみ（フル一覧は任意詳細ファイルへ）
    mechanicalExclusionReasons: Object.fromEntries(
      [
        ...snapshot.mechanicalExclusions.reduce((map, row) => {
          map.set(row.reason, (map.get(row.reason) ?? 0) + 1);
          return map;
        }, new Map()),
      ].sort((a, b) => b[1] - a[1]),
    ),
  };
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  // 詳細機械除外（ID+reason）は git に載せやすい別ファイル（秘密なし）
  const detailPath = join(outDir, `r1-models-snapshot-${day}-mechanical-exclusions.json`);
  await writeFile(
    detailPath,
    `${JSON.stringify(
      {
        snapshotDate: snapshot.snapshotDate,
        mechanicalExclusions: snapshot.mechanicalExclusions,
        mechanicalSurvivors: snapshot.mechanicalSurvivors,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        outPath: `docs/bugfix/artifacts/r1-models-snapshot-${day}.json`,
        detailPath: `docs/bugfix/artifacts/r1-models-snapshot-${day}-mechanical-exclusions.json`,
        entryCount: snapshot.entryCount,
        mechanicalSurvivors: snapshot.mechanicalSurvivors.length,
        postExSurvivors: snapshot.survivors.length,
        exIdApplied: snapshot.exIdRulesApplied.length,
      },
      null,
      2,
    ) + "\n",
  );
  return artifact;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "catalog snapshot failed"}\n`);
    process.exitCode = 1;
  });
}
