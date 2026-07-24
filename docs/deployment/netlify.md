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
| `OPENROUTER_MODELS` | 順序付き一意の `:free` ID。`openrouter/auto` 禁止 |
| `USER_DAILY_AI_LIMIT` | `5` |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` | `12` |
| `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` | `4` |
| `USER_SHORT_WINDOW_SECONDS` | `600` |
| `GLOBAL_DAILY_AI_LIMIT` | 1..45 |
| `AUTH_CONTINUATION_TTL_SECONDS` | `300` |
| `OPENROUTER_TIMEOUT_MS` | `20000` |
| `FUNCTION_TOTAL_BUDGET_MS` | `50000` |
| `AI_PROCESSING_STALE_SECONDS` | `180` |

`GENERATION_REQUEST_HMAC_KEY` と `SUPABASE_MAINTENANCE_DB_URL` は:

- Netlify の **Functions ランタイム**保護スコープのみ
- Builds / デプロイログ / `netlify.toml` / リポジトリ / preview コンテキスト / 任意の `VITE_` キーへは入れない
- 値を印刷せず検証する

## ビルドコマンド

本番ビルドは `verify:openrouter:models`（5 秒メタデータ期限）を含む経路を使う。
デプロイログでプロバイダ / live model 検証の成功を別途確認する。

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
