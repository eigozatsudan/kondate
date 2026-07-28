/**
 * 本番と同型の「strict json_schema + require_parameters」を満たすモデル探索。
 *
 * 手順:
 *  1. Models API を取得
 *  2. 機械フィルタ（SO AND RF、P* 以内、:free/router 拒否）
 *  3. 各 survivor に chat/completions を 1 回送り、HTTP 状態だけ記録
 *
 * 出力は closed な status / errorCode / 短い message のみ。API キー・raw body は出さない。
 * 課金あり（max_tokens は小さく抑える）。
 *
 * 使い方:
 *   docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs
 *   docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs --limit=40 --concurrency=4
 *   docker compose run --rm --no-deps app node scripts/probe-openrouter-strict-schema.mjs --ids=a,b,c
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMechanicalFilter,
  officialOpenRouterBaseUrl,
  usdPerMillion,
} from "./benchmark-paid-openrouter-models.mjs";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const modelsUrl = `${officialOpenRouterBaseUrl}/models?output_modalities=text`;
const chatUrl = `${officialOpenRouterBaseUrl}/chat/completions`;

const menuResponseFormat = JSON.parse(
  readFileSync(join(repoRoot, "tools/openrouter-mock/fixtures/menu-response-format.json"), "utf8"),
);

function parseArgs(argv) {
  let limit = Infinity;
  let concurrency = 4;
  let ids = null;
  let outPath = null;
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer");
      limit = n;
    } else if (arg.startsWith("--concurrency=")) {
      const n = Number(arg.slice("--concurrency=".length));
      if (!Number.isInteger(n) || n < 1 || n > 16) {
        throw new Error("--concurrency must be 1..16");
      }
      concurrency = n;
    } else if (arg.startsWith("--ids=")) {
      ids = arg
        .slice("--ids=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--ids must not be empty");
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: probe-openrouter-strict-schema.mjs [--limit=N] [--concurrency=N] [--ids=a,b] [--out=path]",
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { limit, concurrency, ids, outPath };
}

function redactMessage(message) {
  if (typeof message !== "string") return null;
  return message.replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted]").slice(0, 220);
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
  return body.data;
}

function mechanicalCandidates(remoteModels, onlyIds) {
  const remoteById = new Map(remoteModels.map((model) => [model.id, model]));
  const sourceIds = onlyIds ?? remoteModels.map((model) => model.id).filter(Boolean);
  const keep = [];
  for (const id of sourceIds) {
    const result = evaluateMechanicalFilter(id, remoteById);
    if (!result.ok) continue;
    const prompt = usdPerMillion(result.model.pricing?.prompt);
    const completion = usdPerMillion(result.model.pricing?.completion);
    keep.push({
      id,
      usdPer1M: prompt !== null && completion !== null ? prompt + completion : null,
    });
  }
  // 安い順（課金・探索のしやすさ）
  keep.sort((a, b) => (a.usdPer1M ?? 999) - (b.usdPer1M ?? 999) || a.id.localeCompare(b.id));
  return keep;
}

async function probeProdLike(apiKey, id) {
  const started = performance.now();
  let status = null;
  let bodyKind = "unknown";
  let errorCode = null;
  let errorMessageClosed = null;
  let responseModel = null;
  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        models: [id],
        messages: [
          { role: "system", content: "Return only valid JSON for the schema." },
          { role: "user", content: "Tiny valid response only." },
        ],
        response_format: menuResponseFormat,
        provider: { require_parameters: true },
        // 本番 openrouter.ts と同型（temperature 非送信）
        stream: false,
        max_tokens: 32,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    status = response.status;
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      bodyKind = "non_json";
      return {
        id,
        status,
        bodyKind,
        errorCode,
        errorMessageClosed,
        responseModel,
        acceptsStrictSchema: false,
        elapsedMs: Math.round(performance.now() - started),
      };
    }
    if (parsed && typeof parsed === "object" && parsed.error) {
      bodyKind = "error_object";
      errorCode = parsed.error.code ?? parsed.error.type ?? null;
      errorMessageClosed = redactMessage(parsed.error.message);
    } else if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      bodyKind = "ok_envelope";
      responseModel = parsed.model;
    } else {
      bodyKind = "other_json";
    }
  } catch (error) {
    bodyKind = "transport";
    errorMessageClosed = error instanceof Error ? error.name : "unknown";
  }
  return {
    id,
    status,
    bodyKind,
    errorCode,
    errorMessageClosed,
    responseModel,
    acceptsStrictSchema: status === 200 && bodyKind === "ok_envelope",
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  const { limit, concurrency, ids, outPath } = parseArgs(argv);
  const apiKey = env.OPENROUTER_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required (live probe incurs charges)");
  }

  process.stdout.write(
    JSON.stringify({
      kind: "probe_header",
      priceCapUsdPer1M: maxPromptPlusCompletionUsdPerMillion,
      concurrency,
      limit: Number.isFinite(limit) ? limit : null,
      note: "prod-like: menu response_format + provider.require_parameters=true; max_tokens=32",
    }) + "\n",
  );

  const remoteModels = await fetchCatalog(apiKey);
  let candidates = mechanicalCandidates(remoteModels, ids);
  const totalMechanical = candidates.length;
  if (Number.isFinite(limit)) candidates = candidates.slice(0, limit);

  process.stdout.write(
    JSON.stringify({
      kind: "candidates",
      mechanicalKeepCount: totalMechanical,
      probingCount: candidates.length,
      ids: candidates.map((row) => row.id),
    }) + "\n",
  );

  const probes = await mapPool(candidates, concurrency, async (row) => {
    const live = await probeProdLike(apiKey, row.id);
    const result = { ...row, ...live };
    process.stdout.write(JSON.stringify({ kind: "probe", ...result }) + "\n");
    return result;
  });

  const accept = probes.filter((row) => row.acceptsStrictSchema);
  const reject = probes.filter((row) => !row.acceptsStrictSchema);
  const summary = {
    kind: "summary",
    priceCapUsdPer1M: maxPromptPlusCompletionUsdPerMillion,
    mechanicalKeepCount: totalMechanical,
    probedCount: probes.length,
    acceptCount: accept.length,
    rejectCount: reject.length,
    acceptIds: accept.map((row) => row.id),
    rejectByStatus: reject.reduce((acc, row) => {
      const key = String(row.status ?? "null");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    accept: accept.map((row) => ({
      id: row.id,
      usdPer1M: row.usdPer1M,
      elapsedMs: row.elapsedMs,
    })),
  };
  process.stdout.write(JSON.stringify(summary) + "\n");

  const day = new Date().toISOString().slice(0, 10);
  const defaultOut = join(repoRoot, "docs/bugfix/artifacts", `strict-schema-probe-${day}.json`);
  const path = outPath ?? defaultOut;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        snapshotDate: new Date().toISOString(),
        priceCapUsdPer1M: maxPromptPlusCompletionUsdPerMillion,
        responseFormatName: menuResponseFormat?.json_schema?.name ?? null,
        requireParameters: true,
        mechanicalKeepCount: totalMechanical,
        probedCount: probes.length,
        acceptCount: accept.length,
        accept,
        reject: reject.map((row) => ({
          id: row.id,
          usdPer1M: row.usdPer1M,
          status: row.status,
          bodyKind: row.bodyKind,
          errorCode: row.errorCode,
          errorMessageClosed: row.errorMessageClosed,
          elapsedMs: row.elapsedMs,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(JSON.stringify({ kind: "wrote", path }) + "\n");
  return summary;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "strict schema probe failed"}\n`,
    );
    process.exitCode = 1;
  });
}
