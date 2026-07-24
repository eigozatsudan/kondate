# OpenRouter 運用ランブック

## モデル更新

1. Models API を固定 5 秒メタデータ期限で問い合わせ、現在の `:free` ID を確認する。
2. 各モデルが `structured_outputs` と `response_format` を公開していることを要求する。
3. 固定 adversarial corpus をステージングで実行する。
4. モデル順を明示し、`OPENROUTER_MODELS` だけを更新して再デプロイする。
5. 有料モデルや `openrouter/auto` が混入していないことを確認する。

検証済み free モデルが無い場合は AI を利用不可のままにし、緊急メニューを有効のままにする。

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
