/**
 * 警告: 実行すると OpenRouter の有料課金が発生する。
 *
 * 設計 §4.4 の有料ベンチゲート:
 * 1. Models API で候補 5 ID を機械フィルタ（不在 / structured AND 欠落 / 単価超過）
 * 2. 残存 ID ごとに実 menuResponseFormat + require_parameters:true で N=10 回 chat
 * 3. 合格: 10/10 が HTTP 200・20s 未満・outcome success の最低形状
 *
 * 1 本も合格しない場合は non-zero で終了する（Plan 完了 / 本番 ship 不可）。
 * キー total limit 未解消・クレジット無しのまま「合格」と主張しないこと。
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { maxPromptPlusCompletionUsdPerMillion } from "./verify-openrouter-models.mjs";

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

/** 日本語家庭献立プロンプト（PII・固有名・アレルギー自由文は載せない） */
export const benchUserPrompt =
  "匿名の大人1人向けの和食朝食を2品、JSON Schemaどおりに生成してください。所要15分以内を想定してください。";

export const benchSystemPrompt =
  "指定された JSON Schema だけを返し、説明文や Markdown は付けないでください。outcome は success とし、menu.dishes を埋めてください。";

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
 * 設計 §4.4.2 の最低形状:
 * outcome === "success" かつ menu.dishes がオブジェクト配列で、
 * 各 dish に dishRef, role, position, name, description, cookingTimeMinutes, ingredients, steps。
 * （アプリ materialize の完全 Zod までは要求しないが、ゲート最低条件を機械判定する）
 */
export function meetsMinimumSuccessShape(decoded) {
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return false;
  }
  if (decoded.outcome !== "success") return false;
  const menu = decoded.menu;
  if (menu === null || typeof menu !== "object" || Array.isArray(menu)) return false;
  if (!Array.isArray(menu.dishes) || menu.dishes.length === 0) return false;
  const requiredDishKeys = [
    "dishRef",
    "role",
    "position",
    "name",
    "description",
    "cookingTimeMinutes",
    "ingredients",
    "steps",
  ];
  for (const dish of menu.dishes) {
    if (dish === null || typeof dish !== "object" || Array.isArray(dish)) return false;
    for (const key of requiredDishKeys) {
      if (!(key in dish)) return false;
    }
    if (!Array.isArray(dish.ingredients) || !Array.isArray(dish.steps)) return false;
  }
  return true;
}

/**
 * chat/completions エンベロープから message.content を JSON デコードする。
 * 失敗時は null。
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
 * 1 回の chat 試行。クライアント計測の経過 ms と合否を返す。
 * @returns {Promise<{ ok: boolean, elapsedMs: number, detail: string }>}
 */
export async function runOneChatTrial({
  modelId,
  apiKey,
  responseFormat,
  fetchImpl = fetch,
  timeoutMs = benchLatencyBudgetMs,
  now = () => Date.now(),
}) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      const elapsedMs = now() - started;
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        return { ok: false, elapsedMs, detail: "timeout_or_abort" };
      }
      return { ok: false, elapsedMs, detail: "transport_error" };
    }
    const elapsedMs = now() - started;
    if (elapsedMs >= timeoutMs) {
      return { ok: false, elapsedMs, detail: "latency_budget_exceeded" };
    }
    if (!response.ok) {
      return { ok: false, elapsedMs, detail: `http_${response.status}` };
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      return { ok: false, elapsedMs, detail: "invalid_json_envelope" };
    }
    const decoded = extractDecodedContent(envelope);
    if (decoded === null) {
      return { ok: false, elapsedMs, detail: "missing_or_invalid_content" };
    }
    if (!meetsMinimumSuccessShape(decoded)) {
      return { ok: false, elapsedMs, detail: "shape_fail" };
    }
    return { ok: true, elapsedMs, detail: "ok" };
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
