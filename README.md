# こんだて日和

「こんだて日和」は、食事の希望や使いたい食材などへの簡単な質問から家庭向けの献立を作る Web アプリケーションです。
家族情報の登録は任意で、登録するとアレルギーや人数などを踏まえた家族向け献立、未登録でも一般的な献立アイデアを作れます。
履歴の見返しや（家族向け献立からの）買い物リスト、生成失敗時の緊急献立なども用意しています。

無料のまま日常の献立づくりに使える **永久フリーミアム** に加え、有料プラン **「こんだて日和 Plus」**（Stripe Checkout / Customer Portal）で日次枠の拡大・品質モード・チラシ写真からの 1 週間献立を提供します。課金の正本はブラウザではなく **Netlify Functions + Stripe Webhook + Postgres** です。

この repository には React アプリ、Netlify Functions、共有 contract、Supabase の schema、Stripe 連携、ローカル開発環境が含まれます。

## 技術構成

- React 19 / TypeScript / Vite
- React Router / TanStack Query / React Hook Form / Zod
- Supabase PostgreSQL 17 / Auth / Realtime（ローカル stack には Storage サービスも含む）
- Netlify Functions
- Vitest / React Testing Library / Playwright / pgTAP
- Docker Compose

## ローカル開発

### 必要な環境

- Docker Engine
- Docker Compose
- POSIX shell
- `sha256sum`

アプリ、Node.js 24、Supabase関連ツール、PostgreSQLクライアント、PlaywrightはDocker内で実行します。

### 初回セットアップ

```bash
cd kondate
./scripts/generate-local-secrets.sh --force
docker compose pull --quiet --ignore-buildable
docker compose build
./scripts/reset-local-db.sh
```

起動後は次を確認します。

```bash
docker compose ps --all
docker compose exec db psql -U postgres -tAc "show server_version"
```

DBはPostgres 17です。サービスがhealthyで、`migrate`がexit 0になっていることを確認してください。

環境変数の検証、別checkoutとの分離、異常時の復旧は[ローカル開発環境](docs/local-development.md)を参照してください。

## 開発と検証

通常の開発サーバーはDocker Composeで起動します。

```bash
docker compose up -d --wait
```

### ローカルでのログイン（Google）

アプリは次の正規オリジンだけを使います。

```text
http://127.0.0.1:5173
```

ログイン画面: [http://127.0.0.1:5173/login](http://127.0.0.1:5173/login)

1. 「Googleで続ける」を押す
2. 表示される **oauth-mock**（「ローカルGoogle認証」）で「Googleテスト利用者で続ける」を選ぶ

ローカルでは本物の Google OAuth は使いません。`VITE_AUTH_PROVIDER_MODE=oauth_mock` のとき、ブラウザは `http://127.0.0.1:8788` の mock に飛び、成功後に認証継続 API（`/api/auth/continuations`）と Supabase セッション確立へ進みます。

#### なぜ `localhost` ではログインできないか

`http://localhost:5173` と `http://127.0.0.1:5173` はブラウザ上で**別オリジン**です。ローカル契約は次のように `127.0.0.1` に固定されています。

| 設定                                       | 値                           |
| ------------------------------------------ | ---------------------------- |
| アプリ / `SERVER_SITE_ORIGIN` / `SITE_URL` | `http://127.0.0.1:5173`      |
| oauth-mock の `appOrigin` / exchange CORS  | `http://127.0.0.1:5173` のみ |
| Supabase redirect allow list               | `http://127.0.0.1:5173/**`   |

そのため `localhost` で開くと、認証継続 create が Origin 不一致で失敗したり、callback / CORS が噛み合わず、Google ログインが成立しません。ブックマークやアドレスバーも常に `127.0.0.1` を使ってください。

#### メール（マジックリンク）でログインする場合

1. ログイン画面でメールアドレスを入れ「ログイン用メールを送る」
2. Mailpit UI（[http://127.0.0.1:8025](http://127.0.0.1:8025)）でメールを開き、リンクから続行する

ローカルの SMTP は Compose の `mailpit`（ホスト `1025` / `8025`）です。本番 Google の検証は [docs/testing/google-oauth-staging.md](docs/testing/google-oauth-staging.md) を参照してください。

#### `/api/auth/continuations` が 404 になる場合

通常の `npm run dev`（Compose の `app`）では、`@netlify/vite-plugin` の **middleware 経由**で Netlify Functions を配信します。本番 CSP をローカルに載せないために middleware 全体を切ると、Function も一緒に死に、`POST /api/auth/continuations` が空の 404 になります。CSP だけ落とす現行の `vite.config.ts` を変えず、スタックを `docker compose up -d --wait` で起動した状態で `127.0.0.1` から開いてください。

### ローカルで OpenRouter 実 API を使う（献立を作る）

既定のローカル構成は **openrouter-mock** です。決定論的なモック応答で E2E・単体が安定します。
API キーを設定すると、同じ UI から **本番と同じ OpenRouter 経路**で「献立を作る」を試せます。

**本番 / 実 API 経路は有料 allowlist のみ**です（Plan 8）。`:free` や `openrouter/auto` 等のルーターは起動・デプロイ検証で拒否されます。実 API 呼び出しは **有料課金**が発生します。

#### 1. 鍵と有料モデルを用意する

1. [OpenRouter](https://openrouter.ai/) で API キーを発行し、**クレジットとキー hard limit** を設定する
2. **有料**の明示モデル ID だけを使う（`:free` 不可。`openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` も不可）
3. 各 ID は Models API 上で `structured_outputs` **AND** `response_format` を公開し、`pricing.prompt` + `pricing.completion` ≤ **$4.00 / 1M tokens** であること
4. 実装完了ゲート前に `scripts/benchmark-paid-openrouter-models.mjs` で機械フィルタ → N=10 を通す（詳細は [docs/runbooks/openrouter.md](docs/runbooks/openrouter.md)）

ゲート合格後の推奨例（**N=10 を通った exact 構成に置換**すること。最大 2 本）:

```text
openai/gpt-4o-mini
```

> 上記は R1-replay 候補のうち README 用の例であり、**ライブ N=10 ゲート未通過のまま本番 ship しない**こと。キー total limit 未解消も完了扱いしない。詳細は [docs/runbooks/openrouter.md](docs/runbooks/openrouter.md)。

#### 2. `.env` を上書きする

リポジトリ直下の `.env`（`generate-local-secrets.sh` が作る）を編集します。**コミットしないでください。**

```bash
# 実 API（本番相当・有料 allowlist）
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# 例（実際のゲート合格 exact 構成に置換。未合格のまま使わない）
OPENROUTER_MODELS=openai/gpt-4o-mini
```

注意:

- `VITE_OPENROUTER_API_KEY` は使わない（ブラウザへ漏れるため禁止）
- `OPENROUTER_BASE_URL` は末尾スラッシュなしで `https://openrouter.ai/api/v1` と完全一致させる
- `OPENROUTER_MODELS` はカンマ区切り・重複なし・**有料** ID のみ（公式 base 上で `:free` は拒否）
- 既定 mock に戻すときは次のいずれかにする:

```bash
OPENROUTER_API_KEY=local-mock-key
OPENROUTER_BASE_URL=http://openrouter-mock:8787/api/v1
OPENROUTER_MODELS=mock/kondate-primary:free,mock/kondate-repair:free
```

または `./scripts/generate-local-secrets.sh --force` のあと必要な鍵だけ復元する（OpenRouter 3 変数は mock 既定に戻る）。mock 例外は **exact** `http://openrouter-mock:8787/api/v1` のときだけ `mock/*:free` を受理する。

#### 3. app を作り直して反映する

`.env` は Compose の変数置換経由で `app` に入るため、変更後は **app の再作成**が必要です。

```bash
docker compose up -d --wait --force-recreate app
```

#### 4. モデル設定と有料ベンチを確認する（任意・推奨）

```bash
docker compose run --rm --no-deps app npm run verify:openrouter:config
# 実 Models API まで見る場合（ネットワーク必須）
docker compose run --rm --no-deps app npm run verify:openrouter:models
# 有料課金あり。機械フィルタ + 各候補 N=10（キーとクレジット必須）
docker compose run --rm --no-deps app node scripts/benchmark-paid-openrouter-models.mjs
```

#### 5. ブラウザで試す

1. [http://127.0.0.1:5173](http://127.0.0.1:5173) を開く（`localhost` ではない）
2. `/login` で Google（oauth-mock）またはメールログイン
3. 初回は `/welcome`。「献立アイデアを考える」または「家族情報を登録する」を選ぶ
4. `/planner` のウィザード（食事 → 食材 → ジャンル → 家族/アイデア → 確認）で条件を入れ、**献立を作る**
   - 未同意なら AI 情報送信の説明（`/privacy`）を先に確認する
5. `/generation` のあと結果（`/menus/:menuId`）が出れば、実 OpenRouter 経由で動いている

#### 制約（プラン別の個人枠）

個人枠は **サーバが entitlement から決める** 値です。ブラウザが `plan=plus` を主張しても無視されます。

| 項目                           | Free               | Plus（trialing / active 等）      |
| ------------------------------ | ------------------ | --------------------------------- |
| 成功生成 / 利用者 / JST 日     | 3                  | **10**                            |
| 外部 AI 送信 / 利用者 / JST 日 | 6                  | **20**                            |
| 外部送信 / 600 秒窓            | 4                  | **8**                             |
| 品質モード（上位モデル）       | 不可               | 3 / JST 日 **かつ** 20 / JST 暦月 |
| チラシ→1 週間献立              | 入口のみ（locked） | 成功 2 回 / JST 暦週              |

| 項目                               | 値（全プラン共通の安全弁）                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 外部 AI 送信 / アプリ全体 / JST 日 | ローカル既定 **20**、本番運用推奨 **80**、製品 max **500**（`GLOBAL_DAILY_AI_LIMIT`。**上限の正本は ENV のみ**。SQL は範囲拒否しない）                                      |
| 1 試行タイムアウト                 | 24 秒（`OPENROUTER_TIMEOUT_MS`。primary + 最大 1 repair が 55s 総予算内に収まる）                                                                                          |
| Function 総予算                    | 55 秒（`FUNCTION_TOTAL_BUDGET_MS`。Netlify 同期 60s 硬上限の内側。正本: `shared/contracts/function-budget.ts` / [docs/deployment/netlify.md](docs/deployment/netlify.md)） |

#### グローバル日次枠を上げる（運用・製品 max）

`GLOBAL_DAILY_AI_LIMIT` は **アプリ全体**の外部 AI 送信安全弁です（JST 日・成功/失敗を問わず OpenRouter 送信を合算）。個人の Free/Plus 枠とは独立です。

| やりたいこと | 手順 | コード / SQL |
| ------------ | ---- | ------------ |
| **運用値を上げる**（例: 本番 80 → 120、上限 500 未満） | Netlify の `GLOBAL_DAILY_AI_LIMIT` を変更して Functions を再デプロイ（または env 反映）。ローカルは `compose.yaml` / `.env` | **不要**。DB migration 不要 |
| **製品 max 自体を上げる**（例: 500 → 1000） | 1. `shared/contracts/plan-quota.ts` の `globalDailyAiLimitProductMax` を更新 2. `scripts/preflight-production.mjs` の同値ミラーを更新 3. README / `docs/deployment/netlify.md` の数字を更新 4. 関連テストの期待値を確認 | **SQL 変更は不要**（RPC は `p_global_limit` を範囲拒否しない） |

- 受理範囲は常に **1 .. 製品 max**（env Zod + 本番 preflight）。0 や max+1 は Function 起動 / preflight で拒否。
- 未設定時の schema default は製品 max。ローカル compose は明示 **20**、本番運用推奨は **80**。
- E2E は共有カウンタを truncate するだけで、上限値そのものは変えない（`e2e/fixtures/reset-global-ai-quota.ts`）。

有料モデルでも提供状況・単価・構造化対応は変わり得ます。失敗時はアプリが緊急献立など既存のフォールバックへ誘導します。E2E は **OpenRouter mock のまま**実行してください（実 API だと決定論が崩れ、クォータも消費し、課金も発生します）。

### こんだて日和 Plus（Stripe 課金）

設計の正本: [docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md](docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md)
運用 reconcile: [docs/runbooks/billing-reconcile.md](docs/runbooks/billing-reconcile.md)
本番 env 境界: [docs/deployment/netlify.md](docs/deployment/netlify.md)

#### 何が Plus か（製品の要点）

| 項目         | 内容                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| プラン       | Free + **単一**有料プラン「こんだて日和 Plus」のみ（Basic/Pro 段階なし）                                              |
| 価格（表示） | 月額 **¥580**（税込表示）/ 年額 **¥5,800**（約 2 か月分お得）                                                         |
| トライアル   | **7 日**無料（カード登録あり）。初回のみ（`billing_trial_history`）                                                   |
| 決済 UI      | Stripe **Checkout**（加入）+ **Customer Portal**（解約・支払い方法・領収書）                                          |
| 正本         | **Stripe Webhook** が entitlement を DB に投影。クライアントは信頼しない                                              |
| サーバ API   | `GET /api/billing/entitlement`、`POST /api/billing/checkout`、`POST /api/billing/portal`、`POST /api/billing/webhook` |

Plus の追加価値（P0）:

1. **枠の余裕**（上表）
2. **品質モード**（「くわしく作る」— 上位モデル allowlist。`OPENROUTER_PLUS_MODELS`）
3. **チラシ画像 → 1 週間献立**（Plus のみ。画像は長期保存しない）

#### アーキテクチャ（開発時に押さえる一点）

```text
ブラウザ ──► Functions（Checkout / Portal / generate / flyer）
                │
                ├─ loadEntitlement（DB 読取失敗は 503 fail-closed）
                │     枠・品質・チラシを強制
                │
Stripe ──Webhook──► process_billing_stripe_event（単一 SECURITY DEFINER TX）
                      private.billing_* を更新（service_role のみ書込）
```

- **`BILLING_ENABLED=false`（kill switch）**
  - Checkout / Portal / 品質モード / チラシ製品面を閉じる
  - **個人枠は Free 強制**（DB 上 Plus でも枠は 3/6/4）
  - **`STRIPE_*` 鍵があれば Webhook は動き続ける**（cancel / past_due を取りこぼさない）
  - 再有効化は reconcile 後にだけ `true` にする（[billing-reconcile.md](docs/runbooks/billing-reconcile.md)）
- **禁止**: `VITE_STRIPE_*` / `VITE_BILLING_*`、ブラウザへの Price ID / `sk_` / `whsec_` 露出
- **SDK**: `stripe@22.3.2` exact pin、API バージョン **`2026-06-24.dahlia` 固定**（変更は設計改訂）

#### 環境変数（サーバ専用）

すべて **Functions ランタイムのみ**。ブラウザビルドに渡さない。

| 変数                        | ローカル既定          | 説明                                                                                  |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `BILLING_ENABLED`           | `false`               | `"true"` / `"false"` のみ。未設定は false                                             |
| `STRIPE_SECRET_KEY`         | 空                    | `sk_test_…` / `sk_live_…`。`BILLING_ENABLED=true` 時は必須                            |
| `STRIPE_WEBHOOK_SECRET`     | 空                    | `whsec_…`。署名検証用                                                                 |
| `STRIPE_PRICE_PLUS_MONTHLY` | 空                    | Plus 月額 Price ID                                                                    |
| `STRIPE_PRICE_PLUS_YEARLY`  | 空                    | Plus 年額 Price ID                                                                    |
| `STRIPE_API_VERSION`        | `2026-06-24.dahlia`   | **固定**。他値は起動拒否                                                              |
| `STRIPE_MOCK_BASE_URL`      | 未設定                | **ローカル exact mock のみ**（`http://stripe-mock:8790`）。**本番に置いたら起動失敗** |
| `OPENROUTER_PLUS_MODELS`    | mock 時は mock モデル | Plus 品質モード用の有料 allowlist（本番は `:free` 禁止）                              |
| `OPENROUTER_FLYER_MODELS`   | 未設定（任意）        | チラシ vision 専用 allowlist。空なら `OPENROUTER_PLUS_MODELS` にフォールバック        |

`.env.example` にも同趣旨のコメントがあります。`./scripts/generate-local-secrets.sh` 後の `.env` を編集して使います（**コミット禁止**）。

#### ローカル開発での扱い

ローカルの既定は **課金オフ**です。通常の献立生成・E2E は Stripe なしで進められます。

| 目的                           | やること                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| 日常開発・E2E（決定論）        | `BILLING_ENABLED=false` のまま。Checkout/Portal/品質/チラシ UI は閉じる。枠は Free                 |
| 設定画面の文面確認             | UI は entitlement API を見る。E2E は `page.route` で mock（`e2e/specs/billing-plus.spec.ts`）      |
| unit / Function テスト         | `tools/stripe-mock/` の固定 Session URL・webhook secret をテストが注入。**本番 Stripe は呼ばない** |
| 実 Stripe（test mode）で手確認 | 下の「ローカルで Stripe test mode を有効にする」                                                   |

DB 側の課金表・枠拡張はマイグレーションに含まれます（`20260729130000` 以降）。初回や schema 更新後:

```bash
./scripts/reset-local-db.sh
# または migrate 済み stack なら
docker compose run --rm migrate
```

#### ローカルで Stripe test mode を有効にする（任意）

**カード課金は Stripe のテストモード**で行います。本番 live 鍵をローカルに置かないでください。

1. [Stripe Dashboard（Test mode）](https://dashboard.stripe.com/test/dashboard) で Product / Price を作成
   - Plus 月額・年額の **Price ID** を控える（税込表示と整合）
2. Developers → API keys で **Secret key**（`sk_test_…`）を取得
3. Developers → Webhooks で endpoint を追加（ローカルは [Stripe CLI](https://stripe.com/docs/stripe-cli) が現実的）:

```bash
# 例: CLI でローカル Function へ転送（app が Functions を配信している前提）
stripe listen --forward-to http://127.0.0.1:5173/api/billing/webhook
# 表示された whsec_… を STRIPE_WEBHOOK_SECRET に入れる
```

4. `.env` を編集:

```bash
BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_xxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx
STRIPE_PRICE_PLUS_MONTHLY=price_xxxxxxxx
STRIPE_PRICE_PLUS_YEARLY=price_yyyyyyyy
STRIPE_API_VERSION=2026-06-24.dahlia
# STRIPE_MOCK_BASE_URL は実 Stripe 利用時は未設定のまま
OPENROUTER_PLUS_MODELS=openai/gpt-4o-mini   # ゲート合格の有料 ID に置換
# チラシ専用（任意）。未設定なら PLUS と同じリストを vision に使う
# OPENROUTER_FLYER_MODELS=openai/gpt-4o-mini
```

5. app を再作成して反映:

```bash
docker compose up -d --wait --force-recreate app
```

6. ブラウザで確認（常に `http://127.0.0.1:5173`）:

   1. ログイン → **設定** の「プラン」節
   2. 「Plus をはじめる」→ Stripe Checkout（test カード `4242…` 等）
   3. Webhook が届けば entitlement が Plus に変わり、枠 10 / 品質 / チラシが開く
   4. 「お支払い・解約の管理」→ Customer Portal

反映が Free のままなら数十秒待ち、Dashboard の Webhook 配信と `billing_user_unmapped` 等のサーバログを確認してください（カード番号やメールをログに残さない）。

Customer Portal（Dashboard）の最低確認:

- 既定言語 **ja**
- 解約は **期間末**（即時解約のみにしない）
- 解約時のダークパターン（強引な retention）は off
- 月↔年の切替は初期オフでよい（ロードマップ後段）

#### 本番デプロイ（Stripe まわり）

本番の全体手順・CSP・preflight は [docs/deployment/netlify.md](docs/deployment/netlify.md) と [docs/testing/release-checklist.md](docs/testing/release-checklist.md) が正本です。課金だけ抜粋すると次のとおりです。

**1. Stripe（Live）側の準備**

| 手順               | 内容                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Product / Price    | Plus 月額・年額。表示価格 ¥580 / ¥5,800 と整合                                                                                |
| Webhook endpoint   | `https://<本番 origin>/api/billing/webhook`                                                                                   |
| 購読する主要 event | `customer.subscription.*`、`invoice.paid` / `invoice.payment_failed`、`checkout.session.completed` / `expired` など設計どおり |
| Customer Portal    | 上記チェックリスト（ja・期間末解約）                                                                                          |
| 鍵                 | **Live** の `sk_live_…` と endpoint の `whsec_…` を Netlify の **Functions スコープ**だけに入れる                             |

**2. Netlify 環境変数（Billing）**

| 変数                      | 本番                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BILLING_ENABLED`         | 初回 ship 前は `false` のままデプロイ → Webhook 鍵だけ入れて投影を温め → reconcile 後に `true` が安全 |
| `STRIPE_SECRET_KEY`       | `sk_live_…`                                                                                           |
| `STRIPE_WEBHOOK_SECRET`   | 本番 endpoint の `whsec_…`                                                                            |
| `STRIPE_PRICE_PLUS_*`     | Live Price ID                                                                                         |
| `STRIPE_API_VERSION`      | **`2026-06-24.dahlia` のみ**                                                                          |
| `STRIPE_MOCK_BASE_URL`    | **設定しない**（設定すると起動失敗）                                                                  |
| `OPENROUTER_PLUS_MODELS`  | 検証済み有料 allowlist（品質モード用）                                                                |
| `OPENROUTER_FLYER_MODELS` | 任意。チラシ vision。未設定なら Plus リスト                                                           |
| `GLOBAL_DAILY_AI_LIMIT`   | 運用推奨 **80**（1..製品 max **500**。ENV のみが正本。上げ方は上節「グローバル日次枠を上げる」）       |

**絶対に置かないもの**

- `VITE_STRIPE_*` / `VITE_BILLING_*`
- test の `sk_test_` / mock URL の本番持ち込み
- ビルドログや `netlify.toml` への秘密直書き

**3. DB マイグレーション**

課金・プラン枠・品質・チラシの migration が本番 Supabase に適用済みであること（`20260729130000`〜`20260729170000` 系）。適用手順は [docs/deployment/supabase.md](docs/deployment/supabase.md) を参照。

**4. デプロイ後の確認**

```bash
# 保護 runner 上（秘密を一時注入）。サイトビルドに service role を混ぜない
npm run preflight:production
```

手動スモーク例:

1. Free ユーザ: 設定に Plus 価格・トライアル文面、Checkout 導線
2. Checkout 完了 → Webhook 後に Plus 表示・成功枠 10
3. Portal から解約予約 → `cancel_at_period_end` が UI に出る
4. `BILLING_ENABLED=false` にしたとき Checkout/品質/チラシが閉じ、枠が Free に戻ること（kill 試験はメンテ窓で）

**5. 再有効化・事故対応**

- Webhook 欠落や kill 長期後: [docs/runbooks/billing-reconcile.md](docs/runbooks/billing-reconcile.md)
- アカウント削除時の Stripe cancel は best-effort: [docs/runbooks/account-deletion.md](docs/runbooks/account-deletion.md)

#### よくあるつまずき

| 症状                             | 確認すること                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 設定に Plus 導線が出ない         | `BILLING_ENABLED` と `productSurfacesOpen`。kill 中は意図的に閉じる                                                       |
| Checkout 後も Free のまま        | Webhook が届いているか、署名 secret が endpoint と一致か、`supabase_user_id` metadata / customer マップ                   |
| 品質モードが「通信を確認」になる | 古いクライアント。現行は `quality_mode_requires_plus` を端末失敗として表示                                                |
| 本番起動失敗                     | `STRIPE_API_VERSION` が dahlia 固定か、`STRIPE_MOCK_BASE_URL` が誤って本番に無いか、`BILLING_ENABLED=true` なのに鍵欠落か |
| E2E が Stripe に飛ぶ             | E2E は mock / route 前提。実鍵と `BILLING_ENABLED=true` を E2E 用 env に載せない                                          |

主な検証コマンド:

```bash
docker compose run --rm --no-deps app npx vitest run
docker compose --profile test run --rm db-test
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check
./scripts/run-e2e.sh
```

ローカルDBのschemaを変更した場合は、DB型を再生成して差分を確認します。

```bash
docker compose run --rm app npm run db:types
./scripts/run-tooling-git.sh diff --exit-code -- src/shared/types/database.generated.ts
```

## Supabase公式Docker構成の更新

vendorしたSupabase公式Docker構成は、次のwrapperで更新します。

```bash
./scripts/refresh-supabase.sh
```

この処理はローカルstackを停止し、vendor構成をtransactionalに更新してから、ローカルDBを破棄して再作成します。処理後は[ローカル開発環境](docs/local-development.md)に記載された通常の検証を実行してください。

## 安全上の注意

- `./scripts/reset-local-db.sh`と`./scripts/refresh-supabase.sh`はローカルDBを破棄します。開発用の破棄可能なデータだけを保存してください。
- Postgres 15のデータ移行とロールバックはサポートしていません。
- Compose projectはcheckoutのcanonical pathから分離されますが、固定portは共有できないため、複数checkoutのstackを同時に起動しないでください。
- `COMPOSE_PROJECT_NAME`を手動設定せず、repositoryのwrapperを使用してください。
- E2Eは同じcheckout内で排他実行され、終了時に通常のAuthとapp構成を復元します。

より詳しいセットアップ、検証、Supabase更新、lockやsignalからの復旧は [docs/local-development.md](docs/local-development.md) を参照してください。

| 目的                              | 文書                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 本番デプロイ・env 境界・preflight | [docs/deployment/netlify.md](docs/deployment/netlify.md)                                                                     |
| Supabase 本番                     | [docs/deployment/supabase.md](docs/deployment/supabase.md)                                                                   |
| リリースゲート                    | [docs/testing/release-checklist.md](docs/testing/release-checklist.md)                                                       |
| Plus / Stripe 設計                | [docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md](docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md) |
| 課金 reconcile / Portal チェック  | [docs/runbooks/billing-reconcile.md](docs/runbooks/billing-reconcile.md)                                                     |
| OpenRouter 有料モデル             | [docs/runbooks/openrouter.md](docs/runbooks/openrouter.md)                                                                   |
