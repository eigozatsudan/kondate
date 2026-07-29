# Netlify 本番デプロイ手順

ブラウザ安全変数とサーバ専用変数の境界、protected release runner、デプロイ後検証の正本。

## ブラウザ安全変数（ビルドに渡してよい）

| 変数 | 本番値 |
| --- | --- |
| `VITE_SUPABASE_URL` | 正確な managed origin `https://<20-char-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key（サーバ側と同値） |
| `VITE_MAGIC_LINK_RESEND_SECONDS` | 正の整数（例: 60） |
| `VITE_AUTH_CONTINUATION_TTL_MS` | `300000` |
| `VITE_AUTH_PROVIDER_MODE` | `supabase` のみ |

**本番で存在してはならない**

- `VITE_OAUTH_MOCK_ORIGIN`（空でも不可）
- `KONDATE_MAINTENANCE_ENV`（空でも不可）
- あらゆる `VITE_` 付きサーバ秘密（`VITE_SUPABASE_SERVICE_ROLE_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_GENERATION_REQUEST_HMAC_KEY` / `VITE_SUPABASE_MAINTENANCE_DB_URL`）

## サーバ専用変数（Functions ランタイム）

| 変数 | 要件 |
| --- | --- |
| `SUPABASE_URL` | `VITE_SUPABASE_URL` と byte 同一の managed origin |
| `SUPABASE_PUBLISHABLE_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY` と byte 同一 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role |
| `SERVER_SITE_ORIGIN` | 正確な HTTPS origin のみ |
| `AUTH_CONTINUATION_ENCRYPTION_KEY` | canonical base64・32 バイト |
| `GENERATION_REQUEST_HMAC_KEY` | canonical base64・32 バイト。サンプル / ローカル値禁止。Functions スコープのみ |
| `SUPABASE_MAINTENANCE_DB_URL` | 同一 project ref に束縛した TLS DB URL。Functions スコープのみ |
| `OPENROUTER_API_KEY` | プロバイダ鍵 |
| `OPENROUTER_BASE_URL` | 正確に `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODELS` | 順序付き一意の有料 allowlist ID。`:free`・`openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` 禁止。各 ID は `structured_outputs` AND `response_format` と prompt+completion ≤ $4.00/1M を満たすこと |
| `USER_DAILY_AI_LIMIT` | `3` |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` | `6` |
| `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` | `4` |
| `USER_SHORT_WINDOW_SECONDS` | `600` |
| `GLOBAL_DAILY_AI_LIMIT` | 1..20（既定 20） |
| `AUTH_CONTINUATION_TTL_SECONDS` | `300` |
| `OPENROUTER_TIMEOUT_MS` | `60000` |
| `FUNCTION_TOTAL_BUDGET_MS` | `150000` |
| `AI_PROCESSING_STALE_SECONDS` | `180` |
| `BILLING_ENABLED` | `"true"` / `"false"` のみ。未設定は false。Checkout/Portal と品質・チラシ製品面の kill |
| `STRIPE_SECRET_KEY` | server only。`sk_test_` / `sk_live_`。`BILLING_ENABLED=true` 時必須。Webhook は false でも鍵があれば稼働 |
| `STRIPE_WEBHOOK_SECRET` | server only。`whsec_...` |
| `STRIPE_PRICE_PLUS_MONTHLY` | server only。Price ID |
| `STRIPE_PRICE_PLUS_YEARLY` | server only。Price ID |
| `STRIPE_API_VERSION` | **`2025-02-24.acacia` 固定**（変更は設計改訂） |
| `STRIPE_MOCK_BASE_URL` | ローカル exact mock のみ。本番に設定したら起動失敗 |

**本番で存在してはならない（Billing）**

- あらゆる `VITE_STRIPE_*` / `VITE_BILLING_*`
- ブラウザ向け Price ID / `sk_` / `whsec_`

課金 reconcile と Portal Dashboard チェックリストは `docs/runbooks/billing-reconcile.md`。

### 同期 Function のプラットフォーム上限（必須確認）

アプリ側の総予算は設計ロックどおり **150 秒**（試行 60 秒）だが、Netlify の同期 Function 実行上限は
公式ドキュメント上 **60 秒固定・非設定**（Background は 15 分だが本プロダクトは同期のみ・背景継続禁止）。

- `netlify.toml` / `export const config` に timeout を書いて 150 秒へ引き上げる手段は無い。
- 60 秒プラットフォーム上限の下では、一次 OpenRouter 試行だけで枠を使い切る可能性があり、
  repair や finalize 前にプラットフォームが切断すると DB は `processing` のまま
  `AI_PROCESSING_STALE_SECONDS`（180）まで残る。
- **本番 ship 前に** 次のどちらかを満たすこと（未達なら 150s 予算の本番投入は不可）:
  1. Netlify アカウントで同期上限 ≥150s が契約・確認済みである、または
  2. 設計を改訂してアプリ予算とプラットフォーム上限を再整合する（本ドキュメント単独ではロックを緩めない）。

ローカル E2E（`tools/e2e-function-server.mjs`）は Netlify 切断を再現しない。

`GENERATION_REQUEST_HMAC_KEY` と `SUPABASE_MAINTENANCE_DB_URL` は:

- Netlify の **Functions ランタイム**保護スコープのみ
- Builds / デプロイログ / `netlify.toml` / リポジトリ / preview コンテキスト / 任意の `VITE_` キーへは入れない
- 値を印刷せず検証する

## ビルドコマンド

本番ビルドは `verify:openrouter:models`（5 秒メタデータ期限）を含む経路を使う。
デプロイログでプロバイダ / live model 検証の成功を別途確認する。

各 context の build 末尾で `node scripts/emit-deploy-headers.mjs` が `dist/_headers` に
Content-Security-Policy を書く（Netlify の `[[headers]]` は context 分割不可のため）。

| Context | `connect-src` の Supabase 部分 |
| --- | --- |
| `production` | `VITE_SUPABASE_URL` の exact origin（`https` / `wss`）のみ。`*.supabase.co` 禁止 |
| `deploy-preview` / `branch-deploy` | `https://*.supabase.co` と `wss://*.supabase.co`（preview が別 project を指し得る） |

`npm run preflight:production` は production 用 CSP 純関数が `VITE_SUPABASE_URL` と
一致することを検証する。ref 変更時は Netlify の `VITE_SUPABASE_URL` / `SUPABASE_URL` を
同時に更新すればよく、CSP を手編集する必要はない。

## Protected release runner（サイトビルドの外）

1. シークレットマネージャから完全なサーバ秘密集合を一時環境へ注入する。
2. 環境をクリーンにした subprocess で:

```bash
npm run preflight:production
```

3. 終了ステータスと閉じたチェック名だけをリリース証跡に残す。サイトビルドにはメンテナンス URL を渡さない。
4. タグ付きコミットをデプロイする。
5. Netlify API メタデータからだけ `PRODUCTION_DEPLOY_ID` と `PRODUCTION_ORIGIN` を取得する（オペレータ手入力・例 URL・成果物由来は禁止）。
6. 次をこの順で実行する:

```bash
CANDIDATE_SHA=... RELEASE_TAG=... PRODUCTION_DEPLOY_ID=... PRODUCTION_ORIGIN=... \
  NETLIFY_AUTH_TOKEN=... npm run verify:production-deploy
npm run smoke:production -- "$PRODUCTION_ORIGIN"
CANDIDATE_SHA=... RELEASE_TAG=... PRODUCTION_DEPLOY_ID=... PRODUCTION_ORIGIN=... \
  NETLIFY_AUTH_TOKEN=... npm run verify:production-deploy
```

7. 本番ビルド後に同一コンテナ / ランナーで `npm run verify:browser-secrets`（必要なら `--require-dist`）を走らせる。

## HMAC の安定性

台帳は HMAC のみを保持する。MVP 中の鍵ローテーションは、新しい HMAC 版 / キーリング移行と pending コマンド処理のレビューなしに環境変数だけ差し替えてはならない。

## ローカル値の持ち込み禁止

次を Netlify サイト変数へコピーしない:

- `oauth-mock` origin / サービス
- `KONDATE_MAINTENANCE_ENV=local`
- サンプル HMAC / ローカル生成 HMAC
- ローカル `MAINTENANCE_DB_PASSWORD` / `SUPABASE_MAINTENANCE_DB_URL`

## メンテナンスパスワードローテーション

1. 新しい専用パスワードを生成する。
2. DB 側を更新し、保護変数を原子的に差し替える。
3. スケジュール実行を 1 回検証する。
4. 旧パスワードを無効化する。
どちらも値を露出させない。
