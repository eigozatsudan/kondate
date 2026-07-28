// OpenRouter 有料 allowlist 検証（build / predev / prebuild / 本番 --remote）。
// 規則の正本は openrouter-models-contract.mjs。Functions 側 parseOpenRouterModels と鏡像を保つ。

const officialModelsUrl = "https://openrouter.ai/api/v1/models?output_modalities=text";

export const officialOpenRouterBaseUrl = "https://openrouter.ai/api/v1";
export const exactLocalMockOpenRouterBaseUrl = "http://openrouter-mock:8787/api/v1";
/** R3 改訂: prompt+completion 上限 USD/1M（inclusive）。P* = $4.00（2026-07-28 ユーザー承認 A） */
export const maxPromptPlusCompletionUsdPerMillion = 4;

/** Models API 1回あたりの締切（5秒）。本番メタデータ取得の上限を固定する。 */
export const modelsApiTimeoutMs = 5_000;

/**
 * exact mock base URL 判定（openrouter.ts と規則同一の鏡像）。
 * protocol/host/port/path が完全一致し、資格情報・query・fragment は拒否する。
 */
export function isExactLocalMockBaseUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "openrouter-mock" &&
      parsed.port === "8787" &&
      parsed.pathname === "/api/v1" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

/**
 * OPENROUTER_MODELS を順序付き ID 配列へ正規化する。
 * context 省略時のみ公式 URL（CLI 互換）。本番パスは常に明示渡し。
 * mock path: mock/*:free のみ。非 mock: :free 拒否（有料 allowlist）。router 集合は常に拒否。
 */
export function parseConfiguredModels(raw, context = {}) {
  const openRouterBaseUrl =
    typeof context.openRouterBaseUrl === "string" && context.openRouterBaseUrl.length > 0
      ? context.openRouterBaseUrl
      : officialOpenRouterBaseUrl;
  // 設計: カンマ区切り・前後 trim・空要素なし（filter(Boolean) で空を落とさない）
  const models = String(raw)
    .split(",")
    .map((value) => value.trim());
  if (models.some((model) => model.length === 0)) {
    throw new Error("OPENROUTER_MODELS must not contain empty elements");
  }
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  const mockPath = isExactLocalMockBaseUrl(openRouterBaseUrl);
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  for (const id of models) {
    if (routers.has(id)) {
      throw new Error("OPENROUTER_MODELS rejects router model IDs");
    }
    if (mockPath) {
      if (!id.startsWith("mock/") || !id.endsWith(":free")) {
        throw new Error("OPENROUTER_MODELS mock path accepts only mock/*:free IDs");
      }
    } else if (id.endsWith(":free") || id.startsWith("mock/")) {
      // 設計: exact mock 以外では mock/ も :free も拒否
      throw new Error("OPENROUTER_MODELS rejects mock/ or :free models on non-mock base URL");
    }
  }
  return models;
}

/**
 * OpenRouter token 単価（USD/token）を USD/1M tokens に変換。
 * 欠落・非数値・空文字・boolean・負値・非有限は fail-closed（null）。
 * Number(null)===0 等の JS 強制変換で $0 扱いしない（設計 §4.1.7）。
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
 * リモート Models API 応答に対し、設定 ID の存在・厳格構造化出力対応・単価上限を検証する。
 * structured_outputs と response_format の両方が必須（片方だけでは不足）。
 */
export function verifyRemoteModels(configured, remote) {
  const byId = new Map(remote.map((model) => [model.id, model]));
  for (const id of configured) {
    const model = byId.get(id);
    if (!model) throw new Error(`${id} is not present in the OpenRouter Models API`);
    const parameters = new Set(
      Array.isArray(model.supported_parameters) ? model.supported_parameters : [],
    );
    // AND 必須（片方だけでは不足）— 緩和禁止
    if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
      throw new Error(`${id} does not support strict structured output`);
    }
    const prompt = usdPerMillion(model.pricing?.prompt);
    const completion = usdPerMillion(model.pricing?.completion);
    if (prompt === null || completion === null) {
      throw new Error(`${id} is missing usable pricing.prompt/completion`);
    }
    if (prompt + completion > maxPromptPlusCompletionUsdPerMillion) {
      throw new Error(`${id} exceeds max prompt+completion USD per 1M tokens`);
    }
  }
}

/**
 * 設定検証のエントリポイント。
 * --remote が無いときはローカル構造検証のみ。transport 失敗は詳細を閉じ openrouter_models_unavailable に正規化する。
 * exact mock base では --remote でも remote を skip（構造化はフィクスチャ保証）。
 */
export async function main(
  env = process.env,
  fetchImpl = fetch,
  createSignal = () => AbortSignal.timeout(modelsApiTimeoutMs),
  argv = process.argv.slice(2),
) {
  const baseUrl = env.OPENROUTER_BASE_URL || officialOpenRouterBaseUrl;
  const configured = parseConfiguredModels(env.OPENROUTER_MODELS ?? "", {
    openRouterBaseUrl: baseUrl,
  });
  // 本番コンテキストでは公式 base URL のみを許可（lookalike / パス付き / 資格情報付きを拒否）
  if (env.CONTEXT === "production" && env.OPENROUTER_BASE_URL !== officialOpenRouterBaseUrl) {
    throw new Error(`production OPENROUTER_BASE_URL must equal ${officialOpenRouterBaseUrl}`);
  }
  if (!argv.includes("--remote")) return;
  // mock path は Models API を呼ばない（ローカルフィクスチャが構造化を保証）
  if (isExactLocalMockBaseUrl(env.OPENROUTER_BASE_URL || "")) {
    return;
  }

  let response;
  try {
    // 既存の任意 Bearer 付与を維持しつつ、Accept を明示して JSON 応答を要求する
    const headers = { Accept: "application/json" };
    if (env.OPENROUTER_API_KEY) {
      headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;
    }
    response = await fetchImpl(officialModelsUrl, {
      headers,
      signal: createSignal(),
    });
  } catch {
    // 敏感な transport 詳細（ホスト到達性など）をログに出さない
    throw new Error("openrouter_models_unavailable");
  }
  if (!response.ok) throw new Error(`OpenRouter Models API returned ${response.status}`);
  const body = await response.json();
  if (!body || !Array.isArray(body.data)) {
    throw new Error("OpenRouter Models API returned an invalid body");
  }
  verifyRemoteModels(configured, body.data);
}

// 直接実行時のみ main を起動する（テストからの import では走らせない）
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main()
    .then(() => {
      const count = parseConfiguredModels(process.env.OPENROUTER_MODELS ?? "", {
        openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || officialOpenRouterBaseUrl,
      }).length;
      process.stdout.write(`Verified ${count} OpenRouter model(s).\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "model verification failed"}\n`,
      );
      process.exitCode = 1;
    });
}
