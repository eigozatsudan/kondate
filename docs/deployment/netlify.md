# Netlify 本番デプロイ手順

ブラウザ安全変数とサーバ専用変数の境界、protected release runner、デプロイ後検証、
`maintenance-cleanup` Scheduled Function の正本。

アカウント作成直後からの **CLI 初回デプロイと更新の手順**は
[README.md](./README.md)（Compose profile `deploy` の `netlify-cli`）を先に読む。

Auth の Site URL / Google / **Custom SMTP** は [supabase.md](./supabase.md) が正本
（マジックリンクの送信は Supabase Auth。Netlify に `SMTP_*` は置かない）。

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
- あらゆる `VITE_` 付きサーバ秘密（`VITE_SUPABASE_SERVICE_ROLE_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_GENERATION_REQUEST_HMAC_KEY` / `VITE_QUOTA_IDENTITY_HMAC_KEY` / `VITE_AUTH_CONTINUATION_ENCRYPTION_KEY` / `VITE_SUPABASE_MAINTENANCE_DB_URL`）

## サーバ専用変数（Functions ランタイム）

| 変数 | 要件 |
| --- | --- |
| `SUPABASE_URL` | `VITE_SUPABASE_URL` と byte 同一の managed origin |
| `SUPABASE_PUBLISHABLE_KEY` | `VITE_SUPABASE_PUBLISHABLE_KEY` と byte 同一 |
| `SUPABASE_SERVICE_ROLE_KEY` | service role |
| `SERVER_SITE_ORIGIN` | 正確な HTTPS origin のみ（末尾スラッシュなし） |
| `AUTH_CONTINUATION_ENCRYPTION_KEY` | canonical base64・32 バイト。Functions スコープのみ |
| `GENERATION_REQUEST_HMAC_KEY` | canonical base64・32 バイト。サンプル / ローカル値禁止。Functions スコープのみ |
| `QUOTA_IDENTITY_HMAC_KEY` | canonical base64・32 バイト。**`GENERATION_REQUEST_HMAC_KEY` と別鍵**（共用禁止）。サンプル / ローカル値禁止。Functions スコープのみ。`preflight:production` 必須 |
| `SUPABASE_MAINTENANCE_DB_URL` | 同一 project ref に束縛した TLS DB URL。Functions スコープのみ |
| `OPENROUTER_API_KEY` | プロバイダ鍵 |
| `OPENROUTER_BASE_URL` | 正確に `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODELS` | 順序付き一意の有料 allowlist ID。`:free`・`openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` 禁止。各 ID は `structured_outputs` AND `response_format` と prompt+completion ≤ $4.00/1M を満たすこと |
| `OPENROUTER_PLUS_MODELS` | Plus 品質モード用 allowlist。同じ有料・構造化・$4 ルール。`BILLING_ENABLED=true` 時は 1 本以上必須 |
| `OPENROUTER_FLYER_MODELS` | **任意**。チラシ vision 専用。未設定・空なら `OPENROUTER_PLUS_MODELS`。vision + 上記同じゲート |
| `USER_DAILY_AI_LIMIT` | `3` |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` | `6` |
| `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` | `4` |
| `USER_SHORT_WINDOW_SECONDS` | `600` |
| `GLOBAL_DAILY_AI_LIMIT` | 1..製品 max（現状 **500**、`planQuota.globalDailyAiLimitProductMax`）。**ENV のみが正本**（SQL 範囲拒否なし）。運用値の引き上げは Netlify env だけ。製品 max を超える運用は定数 + preflight ミラーを先に上げる。ローカル既定 20、本番運用推奨 80 |
| `AUTH_CONTINUATION_TTL_SECONDS` | `300` |
| `OPENROUTER_TIMEOUT_MS` | `24000`（primary+repair が 55s 総予算内に収まる試行上限） |
| `FUNCTION_TOTAL_BUDGET_MS` | `55000`（プラットフォーム 60s 硬上限の内側。headroom 5s） |
| `AI_PROCESSING_STALE_SECONDS` | `180` |
| `BILLING_ENABLED` | `"true"` / `"false"` のみ。未設定は false。Checkout/Portal と品質・チラシ製品面の kill |
| `STRIPE_SECRET_KEY` | server only。`sk_test_` / `sk_live_`。`BILLING_ENABLED=true` 時必須。Webhook は false でも鍵があれば稼働 |
| `STRIPE_WEBHOOK_SECRET` | server only。`whsec_...` |
| `STRIPE_PRICE_PLUS_MONTHLY` | server only。Price ID |
| `STRIPE_PRICE_PLUS_YEARLY` | server only。Price ID |
| `STRIPE_API_VERSION` | **`2026-06-24.dahlia` 固定**（変更は設計改訂） |
| `STRIPE_MOCK_BASE_URL` | ローカル exact mock のみ。本番に設定したら起動失敗 |

**本番で存在してはならない（Billing）**

- あらゆる `VITE_STRIPE_*` / `VITE_BILLING_*`
- ブラウザ向け Price ID / `sk_` / `whsec_`

課金 reconcile と Portal Dashboard チェックリストは `docs/runbooks/billing-reconcile.md`。
ルート README の「本番デプロイ（Stripe まわり）」も参照。

### Stripe Webhook（初回）

1. Stripe Dashboard（Live / Test を誤らない）で endpoint を登録する:
   - URL: `https://<production-origin>/api/billing/webhook`
2. 購読 event は設計どおり（`customer.subscription.*`、`invoice.paid` /
   `invoice.payment_failed`、`checkout.session.completed` / `expired` 等）。
3. endpoint の `whsec_…` を **Functions スコープ**の `STRIPE_WEBHOOK_SECRET` にだけ入れる。
4. 初回 ship は `BILLING_ENABLED=false` のまま Webhook 鍵だけ入れて投影を温め、
   reconcile 後に `true` が安全（詳細は billing-reconcile）。

### 同期 Function のプラットフォーム上限（ロック済み再整合）

Netlify の同期 Function 実行上限は公式どおり **60 秒固定・非設定**（Background は 15 分だが本プロダクトは同期のみ・背景継続禁止）。
`netlify.toml` / `export const config` で 60 秒超へ引き上げる手段は無い。

アプリ予算はプラットフォーム内側に再ロックする（正本: `shared/contracts/function-budget.ts`）:

| 項目 | 値 | 理由 |
| --- | --- | --- |
| プラットフォーム硬上限 | 60s | Netlify 同期 Function |
| `FUNCTION_TOTAL_BUDGET_MS` | **55s** | 切断前 headroom 5s（応答返却・finalize） |
| `OPENROUTER_TIMEOUT_MS` | **24s** | primary + 最大 1 repair（各 24s）+ finalize 2s ≤ 55s |
| pre-send / pre-repair ゲート | **26s** 残（24+2） | 旧 62s ゲートを 24s 試行に再計算 |
| `AI_PROCESSING_STALE_SECONDS` | 180 | 切断残骸の掃除猶予（予算より長いのは意図的） |

ローカル E2E（`tools/e2e-function-server.mjs`）は Netlify 切断を再現しないが、**同じ 24s/55s env ロック**を使う。

`GENERATION_REQUEST_HMAC_KEY`・`QUOTA_IDENTITY_HMAC_KEY`・`SUPABASE_MAINTENANCE_DB_URL`・
`AUTH_CONTINUATION_ENCRYPTION_KEY` は:

- Netlify の **Functions ランタイム**保護スコープのみ
- Builds / デプロイログ / `netlify.toml` / リポジトリ / preview コンテキスト / 任意の `VITE_` キーへは入れない
- 値を印刷せず検証する

## flyer Function は native sharp を同梱

`POST /api/flyer-weekly` は画像デコードに **sharp**（native addon）を使う。

| 項目 | 方針 |
| --- | --- |
| 依存 | `package.json` に `sharp` を **exact pin**（`npm install sharp --save-exact`） |
| Bundling | `netlify.toml` の `[functions] external_node_modules = ["sharp"]` で esbuild に潰さず **node_modules として同梱**。lockfile に `@img/sharp-linux-x64` が必須（Netlify ランタイム） |
| memory | `flyer-weekly` に `memory = 2048`（Credit-based Pro+ で有効。他プランは既定 1024MB） |
| ペイロード | multipart Content-Length 上限 = 画像 raw 4MiB + 256KiB（Netlify 実効 ~4.5MB 内） |
| 検証 | `npm run verify:sharp:netlify`（exact pin / linux-x64 lock / import+decode）。production・preview・branch の build command と `prebuild` で fail-closed |
| 代替 | sharp が解決不能でも pure JS デコードへ silent に落とさない |

`OPENROUTER_FLYER_MODELS` は任意。未設定時は `OPENROUTER_PLUS_MODELS` を vision 送信に使う。

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

1. シークレットマネージャから完全なサーバ秘密集合を一時環境へ注入する
   （上表の必須キー。`QUOTA_IDENTITY_HMAC_KEY` を落とさない）。
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

台帳・identity 枠は HMAC のみを保持する。

| 鍵 | 用途 | ローテ注意 |
| --- | --- | --- |
| `GENERATION_REQUEST_HMAC_KEY` | 生成コマンド整合性 | MVP 中は新 HMAC 版 / キーリング移行と pending 処理のレビューなしに env だけ差し替えない |
| `QUOTA_IDENTITY_HMAC_KEY` | メール正規化 → identity 日次枠 | **回すと identity がすべて変わり、日次成功・attempt 枠は事実上リセット**（旧行は unlinkable）。`GENERATION_REQUEST_HMAC_KEY` と**別鍵のまま**維持する |

ブラウザ・ログ・チケットへ鍵や identity_key を載せない。

## `maintenance-cleanup` Scheduled Function

`netlify/functions/maintenance-cleanup.ts`。DB 側 LOGIN の用意は [supabase.md](./supabase.md) §4–6。

| 項目 | 値 |
| --- | --- |
| スケジュール | `@hourly`（`path` なし。**URL では呼べない**） |
| 実行環境 | **published production のみ**（deploy preview / branch では動かない） |
| バッチ | 4 カテゴリ各最大 250 行（stale 予約 → 終端生成台帳 → shopping mutation → auth continuation） |
| 保持 | 終端生成台帳・shopping mutation は厳密 30 日未満削除 |
| 第 5 カテゴリ | なし。`generation_regeneration_snapshots` は終端台帳 CASCADE のみ |
| DB | dedicated LOGIN `kondate_maintenance_login`、role 既定と transaction-local `statement_timeout=20s` |
| クライアント | 25 秒、プラットフォーム Scheduled 上限 30 秒の下 |
| 監視 | 4 集計件数 + duration + 閉じたエラーコードのみ（URL・行 ID・PII 禁止） |

初回 production デプロイ後:

1. Functions に `SUPABASE_MAINTENANCE_DB_URL` が入っていること。
2. Netlify の Scheduled Functions / ログで `maintenance_cleanup` が hourly に載ること
   （プレビューではなく **production publish** 後）。
3. 失敗時は閉じた `maintenance_cleanup_failed` と集計のみ。接続 URL を印刷して調査しない。

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

## ローカル値の持ち込み禁止

次を Netlify サイト変数へコピーしない:

- `oauth-mock` origin / サービス
- `KONDATE_MAINTENANCE_ENV=local`
- サンプル HMAC / ローカル生成 HMAC（両鍵）
- ローカル `MAINTENANCE_DB_PASSWORD` / `SUPABASE_MAINTENANCE_DB_URL`
- ローカル `SMTP_*` / mailpit（Auth メールは Supabase Custom SMTP）

## メンテナンスパスワードローテーション

1. 新しい専用パスワードを生成する。
2. DB 側を更新し、保護変数を原子的に差し替える。
3. スケジュール実行を 1 回検証する。
4. 旧パスワードを無効化する。
どちらも値を露出させない。
