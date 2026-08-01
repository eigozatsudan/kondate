# OpenRouter 運用ランブック

## モデル方針（有料 allowlist）

- 本番 / 公式 `OPENROUTER_BASE_URL`（`https://openrouter.ai/api/v1`）では **有料 allowlist のみ**。`:free` モデルは起動・デプロイ検証で拒否される。
- `openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` は常に拒否する。
- 各設定 ID は Models API 上で `structured_outputs` **AND** `response_format` を公開し、`pricing.prompt` + `pricing.completion` ≤ **$4.00 / 1M tokens** であること。
- mock 例外は **`OPENROUTER_BASE_URL` が exact** `http://openrouter-mock:8787/api/v1` のときだけ `mock/*:free` を受理する。
  - `isLocal` / `SERVER_SITE_ORIGIN` だけでは mock 例外にならない。

## モデル更新

1. Models API を固定 5 秒メタデータ期限で問い合わせ、候補 ID と単価を確認する。
2. 各モデルが `structured_outputs` と `response_format` を公開していることを要求する（片方だけでは不足）。
3. prompt+completion が $4.00/1M 以下であることを確認する。
4. 固定 adversarial corpus をステージングで実行する。
5. モデル順を明示し、`OPENROUTER_MODELS` だけを更新して再デプロイする。
6. `:free`・router ID・単価超過が混入していないことを確認する。

検証済みモデルが無い場合は AI を利用不可のままにし、緊急メニューを有効のままにする。

## 有料ベンチゲート（設計 §4.4）

実装完了 / 本番 `OPENROUTER_MODELS` 確定の前に、候補 ID の union を一度だけ機械フィルタし、
承認済み exact 構成を production service harness の N=10 で通す。
**実行すると有料課金が発生する。** API キー・生の課金ログ（PII 混入時）はコミットしない。

候補 ID（N=10 合格 freeze・2026-07-28 luna 有効化後）:

1. `openai/gpt-5.6-luna`（推奨・品質寄り）
2. `openai/gpt-4.1-mini`
3. `inception/mercury-2`（安価）
4. `openai/gpt-4.1-nano`（repair スロット）
5. `x-ai/grok-4.3`

独立して評価する exact な順序付き構成（評価順）:

1. `["openai/gpt-5.6-luna"]`（N=10 PASS・推奨）
2. `["openai/gpt-4.1-mini"]`（N=10 PASS）
3. `["inception/mercury-2"]`（N=10 PASS）
4. `["inception/mercury-2","openai/gpt-4.1-nano"]`（N=10 PASS）
5. `["x-ai/grok-4.3"]`（N=10 PASS）

Stage 1 カタログ snapshot / 意思決定記録（履歴）:
`docs/archive/bugfix/artifacts/r1-models-snapshot-2026-07-28.json` /
`docs/archive/bugfix/2026-07-28-cheap-strict-accept-n10.md`

eligible 部分集合・preflight（R1 CLI）:

```bash
# N=1 preflight
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs \
  --trial-count=1 \
  --configurations-json='[["openai/gpt-5.6-luna"]]'

# N=10（eligible JSON の配列順 = 評価順 = 推奨タイブレーク）
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs \
  --trial-count=10 \
  --configurations-json='[["openai/gpt-5.6-luna"]]'
```

カタログ再 snapshot（Stage-1 Method B・有料キー）:

```bash
docker compose run --rm --no-deps app node scripts/snapshot-openrouter-models-catalog.mjs
```

### 手順

1. OpenRouter キーにクレジットを載せ、キー hard limit を設定する（total limit 403 のまま完了扱いしない）。
2. 次を実行する:

```bash
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs
```

3. スクリプトは次の順で処理する:
   - **§4.4.1 機械フィルタ**: 3 ID の union を一度だけ確認し、ID 不在 /
     `structured_outputs` AND `response_format` 欠落 / 単価超過・pricing 欠落を除外する。
     構成は member が1つでも落ちたら chat を呼ばない。
   - **§4.4.2 N=10**: 各単位で fresh in-memory ledger を作り、本番 `runGeneration` と
     `buildGenerationMessages` を通す。本番 DB / quota ledger へは書き込まない。
   - primary / repair の各送信は **24s 未満**、各送信前の残予算は **26s 以上**、
     context load から finalize までの単位全体は **55s 未満**
     （Netlify 同期 Function 60s 硬上限の内側。正本: `shared/contracts/function-budget.ts`）。
   - repair は最大1回。既知の初回応答モデルを exact 構成から除外し、未知なら同じ構成を再利用する。
   - 合格は fresh な **10/10 単位成功**。構成ごとに初回成功数も記録する。
4. 合格 0 構成ならスクリプトは **non-zero** で終了し、Plan 完了 / 本番 ship 不可とする。
5. N=10 を通った exact 構成だけを、その順序のまま `OPENROUTER_MODELS` に提案する。
   個別 ID の結果を組み合わせず、存在しない推奨構成を合成しない。
6. ゲート証跡は exact 構成、per-send models / response model / excluded model / elapsed、
   primary・repair・failure の別、閉じた failure code、total elapsed、初回成功数だけを残す。
   API キー、prompt、生 AI 出力、provider error body、path/message は残さない。

推奨 env 例（**この exact 順序付き構成自体が N=10 を合格した場合だけ、要素も順序も変えずに使用**）:

```bash
# 例示のみ。N=10 未合格のまま本番に使わない。合格 exact 構成に置換すること。
OPENROUTER_MODELS=openai/gpt-5.6-luna
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

機械フィルタ単体のユニットテストは `scripts/benchmark-paid-openrouter-models.test.mjs`（課金なし・fetch モック）。

## プライバシー説明 version のロールアウト

`privacyNoticeVersion`（現行 `2026-07-26.v1`）はブラウザ契約と Function の Zod literal が同一である必要がある。

- **同一デプロイ**: ブラウザバンドルと Functions を同じデプロイ単位で同時に差し替える。version だけ先行した Function 単体デプロイは禁止。
- **旧同意は無効**: DB に残る旧 version の同意行はすべて「現行未同意」。次回 AI 生成前に新説明の再確認が必須（意図した再同意）。
- **版ずれ時**: 旧バンドル + 新 Function（またはその逆）では body の `privacyNoticeVersion` が Zod 不一致となり **422 / バリデーション失敗**系。利用者にはページ再読み込み（新バンドル取得）を促す。
- **auth-continuation（TTL 300s）**: 進行中 continuation に旧 version が載っている場合、復帰 POST は fail-closed。ログインし直し + 新説明確認が必要。自動マイグレーションはしない。
- **互換パーサは追加しない**: 旧 version を受理する二重意味論は設けない。

## ローカル mock と実 API 切替

### ローカル既定（compose / generate-local-secrets）

- `OPENROUTER_BASE_URL=http://openrouter-mock:8787/api/v1`（exact 一致のみ）
- `OPENROUTER_MODELS=mock/kondate-primary:free,mock/kondate-repair:free`
- この組だけが mock 例外。構造化応答は openrouter-mock フィクスチャが保証する。

### 公式 base + `:free` MODELS

Task 2 以降は **起動検証・preflight が失敗**する。使わない。

### 実 API を試すとき

1. N=10 を合格した exact 順序付き構成だけを、要素も順序も変えずに `OPENROUTER_MODELS` へ設定する。
   個別 ID の合格結果を再結合したり、未評価の構成を作ったりしてはならない。
2. `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
3. 有効な `OPENROUTER_API_KEY` とクレジットを用意する（**実費が発生する**）。
4. `.env` 更新後は `docker compose up -d --force-recreate --no-deps app` で反映する。
5. 戻すときは mock base + `mock/*:free` に戻し、`app` コンテナを recreate する。

```bash
OPENROUTER_API_KEY=local-mock-key
OPENROUTER_BASE_URL=http://openrouter-mock:8787/api/v1
OPENROUTER_MODELS=mock/kondate-primary:free,mock/kondate-repair:free
docker compose up -d --force-recreate --no-deps app
```

## リリース固定コントロール（運用チューニング禁止）

| 項目 | 値 |
| --- | --- |
| 成功生成 / 利用者 / JST 日 | 3 |
| 外部送信 / 利用者 / JST 日 | 6 |
| 外部送信 / アプリ全体 / JST 日（既定） | 20 |
| 外部送信 / 固定 600 秒窓 | 4 |
| 試行タイムアウト | 24 秒 |
| Function 総予算 | 55 秒 |

3 / 6 / 20 / 4 / 600 をレビューなしに運用で変えない。

## `maintenance-cleanup` Function

定期掃除の契約・ローカル診断・タイムアウト手順の **正本は**
[docs/deployment/netlify.md](../deployment/netlify.md) の「`maintenance-cleanup` Function」。
DB LOGIN の用意は [docs/deployment/supabase.md](../deployment/supabase.md)。
（secret 付き HTTP + 外部 cron。本 runbook は OpenRouter 運用専用のため詳細は deployment 側。）
