/**
 * 警告: 実行すると OpenRouter の有料課金が発生する。
 *
 * 設計 §4.4 の有料ベンチゲート:
 * 1. Models API で候補 5 ID を機械フィルタ（不在 / structured AND 欠落 / 単価超過）
 * 2. 残存 ID ごとに実 menuResponseFormat + require_parameters:true で N=10 回 chat
 * 3. 合格: 10/10 が HTTP 200・クライアント計測 20s 未満（body/parse/materialize/validate 含む）
 *    ・envelope.model === 要求 ID
 *    ・本番と同形の response schema + aiGenerationResponseSchema
 *    ・materializeAiGeneratedMenu + validateGeneratedMenu 成功
 *
 * 1 本も合格しない場合は non-zero で終了する（本番ゲート未完了 / 本番 ship 不可）。
 * キー total limit 未解消・クレジット無しのまま「合格」と主張しないこと。
 */

import * as esbuild from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appGateEntry = join(repoRoot, "netlify/functions/_shared/benchmark-app-response-gate.ts");

/** 本番 openrouter.ts の OPENROUTER_MAX_BODY_BYTES と同一（1 MiB） */
export const OPENROUTER_MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * 本番 readResponseBodyWithByteCap と同一規則の受信上限。
 * response.json() 直読みは上限をバイパスするため禁止。
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
  try {
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
  } catch (error) {
    if (error instanceof Error && error.message === "response_body_over_byte_cap") {
      throw error;
    }
    throw error;
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
 * esbuild で TS ゲートを 1 回だけバンドルして import する（Node の .ts 解決を避ける）。
 * 初回 import/esbuild の所要は試行 elapsed に含めない（runOneChatTrial はゲート取得後に started を測る）。
 */
let appGateModulePromise = null;

export async function loadAppResponseGate() {
  if (appGateModulePromise) return appGateModulePromise;
  appGateModulePromise = (async () => {
    const outDir = join(tmpdir(), "kondate-bench-app-gate");
    await mkdir(outDir, { recursive: true });
    const outfile = join(outDir, "benchmark-app-response-gate.mjs");
    await esbuild.build({
      entryPoints: [appGateEntry],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      outfile,
      packages: "bundle",
      logLevel: "silent",
    });
    return import(outfile);
  })();
  return appGateModulePromise;
}

/** テスト用: キャッシュされた default loader を捨てる */
export function resetAppResponseGateLoaderForTests() {
  appGateModulePromise = null;
}

/** 設計 §4.4 候補ショートリスト（順序未確定・機械フィルタ + 実測で primary/repair を決める） */
export const candidateModelIds = Object.freeze([
  "mistralai/mistral-small-3.2-24b-instruct",
  "openai/gpt-oss-120b",
  "google/gemma-3-27b-it",
  "qwen/qwen3-30b-a3b-instruct-2507",
  "meta-llama/llama-3.1-8b-instruct",
]);

export const benchTrialCount = 10;
export const benchLatencyBudgetMs = 20_000;
export const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";
export const officialModelsUrl = `${officialOpenRouterBaseUrl}/models?output_modalities=text`;
export const officialChatCompletionsUrl = `${officialOpenRouterBaseUrl}/chat/completions`;

/**
 * 日本語家庭献立プロンプト（PII・固有名・アレルギー自由文は載せない）。
 * createBenchGenerationContext と整合: member_1、必須 pantry_1=ごはん、和食朝食 15 分。
 */
export const benchUserPrompt = [
  "匿名の大人1人（anonymousMemberRef は member_1）向けの和食朝食を2品、",
  "指定 JSON Schema の success.menu を完全に埋めて生成してください。",
  "所要15分以内。必須の手元食材 pantry_1 は「ごはん」(must_use) として menu.pantryUsage と食材参照に含めてください。",
  "adaptations は member_1 向けを1件以上含めてください。",
].join("");

export const benchSystemPrompt = [
  "指定された JSON Schema だけを返し、説明文や Markdown は付けないでください。",
  "outcome は success のみ。schemaVersion は 2026-07-11.v1。",
  "dishRef/ingredientRef/stepRef/timelineRef/adaptationRef/pantryRef の形式を守り、",
  "timeline・adaptations・pantryUsage・labelConfirmations を省略しないでください。",
].join("");

/** Models API 1 回あたりの締切（verify と揃えた 5 秒メタデータ予算） */
export const modelsApiTimeoutMs = 5_000;

/**
 * OpenRouter token 単価（USD/token）を USD/1M tokens に変換。
 * 欠落・非数値・空文字・boolean・負値・非有限は fail-closed（null）。
 * Number(null)===0 等の JS 強制変換で $0 扱いしない（設計 §4.1.7）。
 * verify-openrouter-models.mjs の規則と同一（鏡像）。
 */
export function usdPerMillion(tokenPrice) {
  if (typeof tokenPrice === "number") {
    if (!Number.isFinite(tokenPrice) || tokenPrice < 0) return null;
    return tokenPrice * 1e6;
  }
  if (typeof tokenPrice === "string") {
    const trimmed = tokenPrice.trim();
    if (trimmed === "") return null;
    // 10 進表現のみ（0x0 等の Number 強制変換で $0 扱いしない）
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n * 1e6;
  }
  // null / undefined / boolean / object などは非数値として拒否
  return null;
}

/**
 * 候補 1 ID を Models API エントリへ機械フィルタする（設計 §4.4.1）。
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
  // AND 必須 — structured_outputs と response_format の両方（緩和禁止）
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
 * 候補一覧を機械フィルタし、除外理由付きの結果を返す。
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

/**
 * @deprecated 設計は materialize/validate 必須。互換のため残すがゲートでは使わない。
 * 最低キー形状だけでは合格にしないこと。
 */
export function meetsMinimumSuccessShape(decoded) {
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return false;
  }
  if (decoded.outcome !== "success") return false;
  const menu = decoded.menu;
  if (menu === null || typeof menu !== "object" || Array.isArray(menu)) return false;
  if (!Array.isArray(menu.dishes) || menu.dishes.length === 0) return false;
  return true;
}

/**
 * chat/completions エンベロープから message.content を JSON デコードする。
 * 失敗時は null。ゲート合否には evaluateAppResponseGate を使う。
 */
export function extractDecodedContent(envelope) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return null;
  }
  const choices = envelope.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = choices[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** 実アプリと同形の menuResponseFormat を fixture から読む（shared/contracts の正本ミラー） */
export async function loadMenuResponseFormat() {
  const fixturePath = fileURLToPath(
    new URL("../tools/openrouter-mock/fixtures/menu-response-format.json", import.meta.url),
  );
  const raw = await readFile(fixturePath, "utf8");
  return JSON.parse(raw);
}

/**
 * 1 回の chat 試行。クライアント計測は body 読取・JSON・model 一致・materialize/validate 後まで含む。
 * @returns {Promise<{ ok: boolean, elapsedMs: number, detail: string }>}
 */
export async function runOneChatTrial({
  modelId,
  apiKey,
  responseFormat,
  fetchImpl = fetch,
  timeoutMs = benchLatencyBudgetMs,
  now = () => Date.now(),
  evaluateGate,
}) {
  // 初回 esbuild/import は試行時間へ混入させない（default loader を started 前に解決）
  const gate = evaluateGate ?? (await loadAppResponseGate()).evaluateAppResponseGate;

  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const finish = (ok, detail) => {
    const elapsedMs = now() - started;
    if (ok && elapsedMs >= timeoutMs) {
      return { ok: false, elapsedMs, detail: "latency_budget_exceeded" };
    }
    return { ok, elapsedMs, detail };
  };
  try {
    let response;
    try {
      response = await fetchImpl(officialChatCompletionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          models: [modelId],
          messages: [
            { role: "system", content: benchSystemPrompt },
            { role: "user", content: benchUserPrompt },
          ],
          response_format: responseFormat,
          provider: { require_parameters: true },
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return finish(false, "timeout_or_abort");
      }
      return finish(false, "transport_error");
    }
    if (!response.ok) {
      return finish(false, `http_${response.status}`);
    }

    let envelope;
    try {
      const rawBody = await readResponseBodyWithByteCap(response, OPENROUTER_MAX_BODY_BYTES);
      envelope = JSON.parse(rawBody);
    } catch (error) {
      if (error instanceof Error && error.message === "response_body_over_byte_cap") {
        return finish(false, "response_body_over_byte_cap");
      }
      return finish(false, "invalid_json_envelope");
    }

    const gateResult = gate(envelope, modelId);
    if (!gateResult.ok) {
      return finish(false, gateResult.detail);
    }
    return finish(true, "ok");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1 モデルについて N 回試行し、全試行合格なら pass。
 */
export async function runModelGate({
  modelId,
  apiKey,
  responseFormat,
  trialCount = benchTrialCount,
  fetchImpl = fetch,
  timeoutMs = benchLatencyBudgetMs,
  now = () => Date.now(),
  log = () => {},
  evaluateGate,
}) {
  const trials = [];
  for (let i = 0; i < trialCount; i += 1) {
    const result = await runOneChatTrial({
      modelId,
      apiKey,
      responseFormat,
      fetchImpl,
      timeoutMs,
      now,
      evaluateGate,
    });
    trials.push(result);
    log(
      `  trial ${i + 1}/${trialCount}: ${result.ok ? "PASS" : "FAIL"} ${result.elapsedMs}ms ${result.detail}`,
    );
    // 1 回でも落ちたら残試行を打ち切り（課金抑制）。N=10 合格は全試行必須のため不合格確定。
    if (!result.ok) {
      return { modelId, passed: false, trials };
    }
  }
  return { modelId, passed: true, trials };
}

/**
 * ベンチ全体。キー必須。合格 0 本なら ok:false。
 */
export async function runPaidBenchmark({
  apiKey,
  candidateIds = candidateModelIds,
  trialCount = benchTrialCount,
  fetchImpl = fetch,
  createModelsSignal = () => AbortSignal.timeout(modelsApiTimeoutMs),
  loadFormat = loadMenuResponseFormat,
  evaluateGate,
  log = (line) => {
    process.stdout.write(`${line}\n`);
  },
}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("OPENROUTER_API_KEY is required (live paid benchmark incurs charges)");
  }

  log("=== Paid OpenRouter benchmark (DESIGN §4.4) ===");
  log("WARNING: This run incurs paid OpenRouter usage.");
  log(`Candidates (${candidateIds.length}): ${candidateIds.join(", ")}`);

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
  const body = await modelsResponse.json();
  if (!body || !Array.isArray(body.data)) {
    throw new Error("OpenRouter Models API returned an invalid body");
  }

  const { survivors, exclusions } = filterCandidatesMechanically(candidateIds, body.data);
  log("--- Mechanical filter (§4.4.1) ---");
  for (const { id, reason } of exclusions) {
    log(`EXCLUDE ${id}: ${reason}`);
  }
  for (const id of survivors) {
    log(`KEEP ${id}`);
  }

  if (survivors.length === 0) {
    log("No candidates survived mechanical filter. Gate FAIL.");
    return {
      ok: false,
      exclusions,
      survivors: [],
      passedModels: [],
      modelResults: [],
    };
  }

  const responseFormat = await loadFormat();
  log("--- Latency/shape gate N=10 (§4.4.2) ---");
  const modelResults = [];
  const passedModels = [];
  for (const modelId of survivors) {
    log(`Model: ${modelId}`);
    const result = await runModelGate({
      modelId,
      apiKey,
      responseFormat,
      trialCount,
      fetchImpl,
      log,
      evaluateGate,
    });
    modelResults.push(result);
    if (result.passed) {
      passedModels.push(modelId);
      log(`RESULT ${modelId}: PASS (${trialCount}/${trialCount})`);
    } else {
      const failed = result.trials.find((t) => !t.ok);
      log(
        `RESULT ${modelId}: FAIL after ${result.trials.length} trial(s)${failed ? ` (${failed.detail})` : ""}`,
      );
    }
  }

  log("--- Summary ---");
  if (passedModels.length === 0) {
    log("Passed models: (none). Gate FAIL — do not ship production OPENROUTER_MODELS.");
  } else {
    // 推奨は最大 2 本（primary + repair）。attempt 6 下で 3 本以上は圧迫しやすい。
    const recommended = passedModels.slice(0, 2);
    log(`Passed models: ${passedModels.join(", ")}`);
    log(`Recommended OPENROUTER_MODELS (max 2): ${recommended.join(",")}`);
    log("Record gate evidence without API keys or PII.");
  }

  return {
    ok: passedModels.length > 0,
    exclusions,
    survivors,
    passedModels,
    modelResults,
  };
}

export async function main(env = process.env, deps = {}) {
  const result = await runPaidBenchmark({
    apiKey: env.OPENROUTER_API_KEY,
    candidateIds: candidateModelIds,
    fetchImpl: deps.fetchImpl,
    createModelsSignal: deps.createModelsSignal,
    loadFormat: deps.loadFormat,
    log: deps.log,
  });
  if (!result.ok) {
    process.exitCode = 1;
  }
  return result;
}

// 直接実行時のみ main を起動する（テストからの import では走らせない）
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "paid openrouter benchmark failed"}\n`,
    );
    process.exitCode = 1;
  });
}
