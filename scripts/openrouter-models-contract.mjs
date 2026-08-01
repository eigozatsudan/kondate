/**
 * OpenRouter モデル一覧の契約（単一の正本）。
 *
 * 次の3実装はこの契約と同一規則でなければならない（モジュール共有ではなく鏡像）:
 * - scripts/verify-openrouter-models.mjs の parseConfiguredModels（build / predev / prebuild / --remote）
 * - netlify/functions/_shared/env.ts の parseOpenRouterModels（Functions 実行時）
 * - scripts/preflight-production.mjs の parseOpenRouterModels（本番 preflight・常に公式 base）
 *
 * Paid allowlist / mock-path rules:
 * 1. カンマ区切りで split し、各要素を trim する。空要素は拒否する（filter で落とさない）。
 * 2. 結果が空なら拒否する（OPENROUTER_MODELS must not be empty）。
 * 3. 重複 ID は拒否する（順序は保持する）。
 * 4. openrouter/auto・openrouter/free・openrouter/auto-beta は常に拒否する（大小文字無視）。
 * 5. base URL が exact mock（http://openrouter-mock:8787/api/v1）のときだけ
 *    mock/*:free を受理する（mock/ 接頭・:free 接尾はいずれも case-insensitive）。
 *    それ以外の base では :free（:Free/:FREE 含む）も mock/（Mock/ 含む）も拒否し、
 *    有料明示 ID を受理する。
 * 6. mock 例外は OPENROUTER_BASE_URL の exact 一致のみ。isLocal / SERVER_SITE_ORIGIN は使わない。
 * 7. 受理時は trim 済み ID の順序付き配列を返す。
 *
 * Remote verification (verifyRemoteModels / --remote のみ、公式 base 経路):
 * - OpenRouter Models API に各設定 ID が存在する。
 * - 各モデルの supported_parameters に structured_outputs と response_format の両方が含まれる（AND）。
 * - pricing.prompt / pricing.completion が usable で、prompt+completion ≤ $4.00 / 1M tokens。
 */
export const modelListRules = `
- comma-split + trim; empty elements rejected (no filter(Boolean)); empty list rejected; duplicates rejected; order preserved
- reject openrouter/auto, openrouter/free, openrouter/auto-beta always (case-insensitive)
- exact mock base only: accept mock/*:free (mock/ prefix and :free suffix case-insensitive); non-mock base rejects any :free/:Free/:FREE and any mock/Mock/ prefix
- mock exception uses OPENROUTER_BASE_URL exact match only (not isLocal / SERVER_SITE_ORIGIN)
- remote: id exists; structured_outputs AND response_format; usable pricing; prompt+completion ≤ 4.00 USD/1M
`.trim();

/** 後方互換の別名（free 必須ではない — 有料 allowlist + mock 例外） */
export const freeModelListRules = modelListRules;

/** 受理される OPENROUTER_MODELS 生文字列（baseUrl 文脈付き・順序保持） */
export const acceptedModelLists = [
  {
    raw: "mistralai/mistral-small-3.2-24b-instruct,openai/gpt-oss-120b",
    models: ["mistralai/mistral-small-3.2-24b-instruct", "openai/gpt-oss-120b"],
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    raw: " vendor/a , vendor/b ",
    models: ["vendor/a", "vendor/b"],
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    raw: "mock/kondate-primary:free,mock/kondate-repair:free",
    models: ["mock/kondate-primary:free", "mock/kondate-repair:free"],
    baseUrl: "http://openrouter-mock:8787/api/v1",
  },
  {
    raw: " mock/first:free , mock/second:free ",
    models: ["mock/first:free", "mock/second:free"],
    baseUrl: "http://openrouter-mock:8787/api/v1",
  },
  // R1: mock 接頭の大小無視（受理は trim 済み原文字列を保持）
  {
    raw: "Mock/first:Free",
    models: ["Mock/first:Free"],
    baseUrl: "http://openrouter-mock:8787/api/v1",
  },
];

/** 後方互換の別名（free 必須ではない） */
export const acceptedFreeModelLists = acceptedModelLists;

/**
 * 拒否される OPENROUTER_MODELS（baseUrl 文脈付き）。
 * free on official / paid on mock without mock/ prefix / router / duplicates / empty を含む。
 */
export const rejectedModelLists = [
  { raw: "", baseUrl: "https://openrouter.ai/api/v1" },
  // 空要素は filter(Boolean) で落とさず拒否（設計: 空要素なし）
  { raw: "vendor/a,,vendor/b", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/a,", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: ",vendor/a", baseUrl: "https://openrouter.ai/api/v1" },
  {
    raw: "mock/first:free,,mock/second:free",
    baseUrl: "http://openrouter-mock:8787/api/v1",
  },
  { raw: "openrouter/auto", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "openrouter/auto-beta", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/a:free", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/a:Free", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/a:FREE", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "OpenRouter/Auto", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "mock/first:free", baseUrl: "https://openrouter.ai/api/v1" },
  // exact mock 以外では mock/ 接頭辞そのものを拒否（:free 無しの mock/vendor-paid 含む）
  { raw: "mock/vendor-paid", baseUrl: "https://openrouter.ai/api/v1" },
  // R1: Mock/ 異体も非 mock base で拒否
  { raw: "Mock/vendor-paid", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/a,vendor/a", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "a/model,a/model", baseUrl: "https://openrouter.ai/api/v1" },
  { raw: "vendor/paid", baseUrl: "http://openrouter-mock:8787/api/v1" },
  { raw: "mock/first", baseUrl: "http://openrouter-mock:8787/api/v1" },
  {
    raw: "mock/first:free,mock/first:free",
    baseUrl: "http://openrouter-mock:8787/api/v1",
  },
];

/** 後方互換の別名（free 必須ではない） */
export const rejectedFreeModelLists = rejectedModelLists;
