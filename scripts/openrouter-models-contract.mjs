/**
 * OpenRouter 無料モデル一覧の契約（単一の正本）。
 *
 * 次の2実装はこの契約と同一規則でなければならない（モジュール共有ではなく鏡像）:
 * - scripts/verify-openrouter-models.mjs の parseConfiguredModels（build / predev / prebuild / --remote）
 * - netlify/functions/_shared/env.ts の parseOpenRouterModels（Functions 実行時）
 *
 * Free-model list rules:
 * 1. カンマ区切りで split し、各要素を trim したあと空要素を除く。
 * 2. 結果が空なら拒否する（OPENROUTER_MODELS must not be empty）。
 * 3. 各 ID は必ず ":free" で終わる明示 ID のみ。openrouter/auto および有料 ID は拒否する。
 * 4. 重複 ID は拒否する（順序は保持する）。
 * 5. 受理時は trim 済み ID の順序付き配列を返す。
 *
 * Remote verification (verifyRemoteModels / --remote のみ):
 * - OpenRouter Models API に各設定 ID が存在する。
 * - 各モデルの supported_parameters に structured_outputs と response_format の両方が含まれる。
 */
export const freeModelListRules = `
- non-empty after comma-split + trim
- every ID must end with ":free"; "openrouter/auto" and paid IDs are rejected
- duplicates are rejected; order is preserved
- remote: each configured ID must exist and support both structured_outputs and response_format
`.trim();

/** 受理される OPENROUTER_MODELS 生文字列（順序保持を含む） */
export const acceptedFreeModelLists = [
  {
    raw: "mock/first:free,mock/second:free",
    models: ["mock/first:free", "mock/second:free"],
  },
  {
    raw: " vendor/a:free , vendor/b:free ",
    models: ["vendor/a:free", "vendor/b:free"],
  },
  {
    raw: "google/gemma-3-27b-it:free,mistralai/mistral-small-3.2-24b-instruct:free",
    models: ["google/gemma-3-27b-it:free", "mistralai/mistral-small-3.2-24b-instruct:free"],
  },
];

/** 拒否される OPENROUTER_MODELS 生文字列 */
export const rejectedFreeModelLists = [
  "",
  "openrouter/auto",
  "vendor/paid",
  "vendor/a:free,vendor/a:free",
  "openai/gpt-4o",
  "a/model:free,a/model:free",
];
