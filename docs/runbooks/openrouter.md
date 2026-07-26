# OpenRouter 運用ランブック

## モデル方針（有料 allowlist）

- 本番 / 公式 `OPENROUTER_BASE_URL`（`https://openrouter.ai/api/v1`）では **有料 allowlist のみ**。`:free` モデルは起動・デプロイ検証で拒否される。
- `openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` は常に拒否する。
- 各設定 ID は Models API 上で `structured_outputs` **AND** `response_format` を公開し、`pricing.prompt` + `pricing.completion` ≤ **$0.50 / 1M tokens** であること。
- mock 例外は **`OPENROUTER_BASE_URL` が exact** `http://openrouter-mock:8787/api/v1` のときだけ `mock/*:free` を受理する。
  - `isLocal` / `SERVER_SITE_ORIGIN` だけでは mock 例外にならない。

## モデル更新

1. Models API を固定 5 秒メタデータ期限で問い合わせ、候補 ID と単価を確認する。
2. 各モデルが `structured_outputs` と `response_format` を公開していることを要求する（片方だけでは不足）。
3. prompt+completion が $0.50/1M 以下であることを確認する。
4. 固定 adversarial corpus をステージングで実行する。
5. モデル順を明示し、`OPENROUTER_MODELS` だけを更新して再デプロイする。
6. `:free`・router ID・単価超過が混入していないことを確認する。

検証済みモデルが無い場合は AI を利用不可のままにし、緊急メニューを有効のままにする。

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

1. 有料 allowlist ID を `OPENROUTER_MODELS` に設定する。
2. `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
3. 有効な `OPENROUTER_API_KEY` とクレジットを用意する（**実費が発生する**）。
4. 戻すときは mock base + `mock/*:free` に戻し、`app` コンテナを recreate する。

## リリース固定コントロール（運用チューニング禁止）

| 項目 | 値 |
| --- | --- |
| 成功生成 / 利用者 / JST 日 | 5 |
| 外部送信 / 利用者 / JST 日 | 12 |
| 外部送信 / 固定 600 秒窓 | 4 |
| 試行タイムアウト | 20 秒 |
| Function 総予算 | 50 秒 |

5 / 12 / 4 / 600 をレビューなしに運用で変えない。

## `maintenance-cleanup` Scheduled Function

| 項目 | 値 |
| --- | --- |
| スケジュール | `@hourly`（`path` なし。URL では呼べない） |
| 実行環境 | published production のみ（deploy preview では動かない） |
| バッチ | 4 カテゴリ各最大 250 行 |
| 保持 | 終端生成台帳・shopping mutation は厳密 30 日未満削除 |
| 第 5 カテゴリ | なし。`generation_regeneration_snapshots` は終端台帳 CASCADE のみ |
| DB | dedicated LOGIN `kondate_maintenance_login`、role 既定と transaction-local `statement_timeout=20s` |
| クライアント | 25 秒、プラットフォーム上限 30 秒の下 |
| 監視 | 4 集計件数 + duration + 閉じたエラーコードのみ |

### ローカル診断

1. `./scripts/provision-maintenance-role.sh` で ephemeral login を用意する。
2. `docker compose run --rm --no-deps app npm exec --offline netlify -- dev` を `dev` コンテキストで起動（生成済み `.env` の local-mode を尊重）。
3. 別端末で
   `docker compose run --rm --no-deps app npm exec --offline netlify -- functions:invoke maintenance-cleanup`
   URL プローブは試みない。

### タイムアウト時

1. 閉じた失敗メトリクスと集計件数だけを見る。
2. ステージングの SQLSTATE `57014` 統合テストで再現する。
3. 生ドライバエラーやメンテナンス URL の印刷は有効化しない。
