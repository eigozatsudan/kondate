// OpenRouter 無料モデル検証（build / predev / prebuild / 本番 --remote）。
// 規則の正本は openrouter-models-contract.mjs。Functions 側 parseOpenRouterModels と鏡像を保つ。

const officialModelsUrl = "https://openrouter.ai/api/v1/models?output_modalities=text";
const officialBaseUrl = "https://openrouter.ai/api/v1";

/** Models API 1回あたりの締切（5秒）。本番メタデータ取得の上限を固定する。 */
export const modelsApiTimeoutMs = 5_000;

/**
 * OPENROUTER_MODELS を順序付き無料 ID 配列へ正規化する。
 * 空・重複・openrouter/auto・:free 以外はすべて拒否する。
 */
export function parseConfiguredModels(raw) {
  const models = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (models.some((id) => id === "openrouter/auto" || !id.endsWith(":free"))) {
    throw new Error("OPENROUTER_MODELS accepts explicit :free IDs only");
  }
  if (new Set(models).size !== models.length) {
    throw new Error("OPENROUTER_MODELS must not contain duplicates");
  }
  return models;
}

/**
 * リモート Models API 応答に対し、設定 ID の存在と厳格構造化出力対応を検証する。
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
    if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
      throw new Error(`${id} does not support strict structured output`);
    }
  }
}

/**
 * 設定検証のエントリポイント。
 * --remote が無いときはローカル構造検証のみ。transport 失敗は詳細を閉じ openrouter_models_unavailable に正規化する。
 */
export async function main(
  env = process.env,
  fetchImpl = fetch,
  createSignal = () => AbortSignal.timeout(modelsApiTimeoutMs),
  argv = process.argv.slice(2),
) {
  const configured = parseConfiguredModels(env.OPENROUTER_MODELS ?? "");
  // 本番コンテキストでは公式 base URL のみを許可（lookalike / パス付き / 資格情報付きを拒否）
  if (env.CONTEXT === "production" && env.OPENROUTER_BASE_URL !== officialBaseUrl) {
    throw new Error(`production OPENROUTER_BASE_URL must equal ${officialBaseUrl}`);
  }
  if (!argv.includes("--remote")) return;

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
      const count = parseConfiguredModels(process.env.OPENROUTER_MODELS ?? "").length;
      process.stdout.write(`Verified ${count} free OpenRouter model(s).\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "model verification failed"}\n`,
      );
      process.exitCode = 1;
    });
}
