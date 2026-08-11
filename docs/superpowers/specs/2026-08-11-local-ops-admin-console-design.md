# ローカル専用運用管理コンソール設計

- 日付: 2026-08-11
- 状態: **人間承認待ち（実装前）**
- 種別: 設計。**本書だけでは実装を開始しない**（承認後に implementation plan → worktree）
- 対象: オペレータがローカルから本番 Supabase を **閲覧のみ** する内部コンソール

---

## 1. 結論

本番 Netlify に載せず、ログイン機能も付けない **ローカル専用の read-only 運用 UI** を、本編アプリから物理分離して用意する。

| 項目 | 決定 |
| --- | --- |
| 配置 | リポジトリ直下 `admin/`（client + server + shared） |
| 起動 | `compose.admin.yaml` のみ（本編 `compose.yaml` と分離・include しない） |
| 接続先 | 本番 Supabase の **Postgres**（`ADMIN_DATABASE_URL`） |
| 権限モデル | アプリ認証なし。**同一マシン上の信頼ユーザー** + ホスト `127.0.0.1` bind |
| 操作 | **GET / SELECT のみ**。書き込み API・書き込み RPC・Stripe API は持たない |
| 識別表示 | **`user_id`（UUID）のみ**。email / 氏名は出さない |
| デプロイ | 対象外。CI / Netlify / `profile: deploy` に接続しない |

推奨アーキテクチャ: **Vite + React の閲覧 SPA** と **Hono BFF（service 内で静的配信）** を同一コンテナの 1 プロセスで動かす。

---

## 2. 目的と対象外

### 2.1 目的

- 生成の成功・失敗・stuck、全体 AI 枠、フィードバック、課金 status 集計、共有ジョブの滞留を **一画面群で把握**する。
- ローカル Supabase スタックを起動しなくても、本番（または指定した）DB を参照できる。
- service_role や DB パスワードをブラウザに載せない。

### 2.2 対象外

- ログイン・RBAC・監査ログ基盤・多人数向けホスティング。
- Netlify / 本番 URL へのデプロイ。
- INSERT / UPDATE / DELETE、枠の手動調整、課金 reconcile 実行、アカウント削除などの **変更操作**。
- 本番へのマイグレーション、read-only DB ロール新設、PostgREST への `private` 公開。
- 献立本文・下書き・prompt・生 AI 出力・アレルギー詳細の閲覧。
- 本編 e2e / 本編 CI フルパイプラインへの admin 組み込み（第1版）。
- 収益計測 analytics 個票の閲覧（別設計。本書は既存 operational 表の集計・台帳のみ）。

---

## 3. 不変条件

1. **Read-only**: サーバーは `SELECT` と集計のみ。クライアントから任意 SQL を受けない。固定の名前付きクエリのみ実行する。
2. **セッション READ ONLY**: DB プール／接続で `default_transaction_read_only = on` を設定し、リクエスト単位で `BEGIN READ ONLY` … `COMMIT` とする。
3. **識別最小**: 利用者に紐づく表示キーは `user_id`（および共有の `contributor_user_id`）の UUID に限る。email・氏名・プロフィールは join しない。
4. **秘匿フィールド非露出**: レスポンス DTO に `request_hmac`、Stripe の subscription/price/customer/event ID、DB URL、パスワードを含めない。
5. **ログ**: feedback 本文、検索キーワード、UUID 以外の識別子をサーバーログに出さない。path・status・所要時間・closed error code に留める。
6. **鍵の置き場**: `ADMIN_DATABASE_URL` は server 環境変数のみ。`VITE_*` にシークレットを置かない。anon key / service_role は第1版で使わない。
7. **公開面**: ホスト側ポートは `127.0.0.1:5193` のみ。コンテナ内 listen は `0.0.0.0:5193` でよい。
8. **本編非混入**: `src/` ルート、Netlify Functions、本番ビルド成果物に admin を含めない。
9. **本編スタック非依存**: `compose.admin.yaml` は `db` / `kong` / `app` に `depends_on` しない。
10. **free-form 本文**: `user_feedback.body` は画面表示を許可するが、永続ログ・外部送信・analytics に載せない。

---

## 4. アーキテクチャ

### 4.1 トポロジ

```
Browser  http://127.0.0.1:5193
    │  同一 origin（/ 静的 + /api/*）
    ▼
admin コンテナ (Node 24, 1 プロセス)
    ├─ Hono: /api/*
    └─ 静的: client の production build
    │
    │  pg + BEGIN READ ONLY
    ▼
本番 Postgres (Supabase pooler 推奨)
    public.user_feedback
    private.ai_generation_requests
    private.ai_global_daily_usage
    private.billing_*
    private.share_generalization_jobs
    …
```

### 4.2 なぜ PostgREST / service_role を正にしないか

本番 API は通常 `public` のみ露出する。管理上必要な生成台帳・枠・課金・共有は **`private` スキーマ**にあり、REST だけでは届かない。  
第1版の正本は **`ADMIN_DATABASE_URL` による直接 SQL（SELECT のみ）** とする。service_role キーは鍵の種類を増やさないため第1版では採用しない。

### 4.3 リポジトリ配置

```
admin/
  Dockerfile
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
  server/
    src/
      index.ts          # listen + static
      app.ts            # Hono routes
      db.ts             # pool + READ ONLY
      queries/          # 名前付き SELECT のみ
      routes/
      lib/              # row → 公開 DTO（フィールド除去）
  client/
    index.html
    src/
      main.tsx
      app.tsx
      pages/
      api/
      components/
  shared/
    schemas.ts          # Zod DTO（client/server 共有）
compose.admin.yaml
.env.admin.example
```

本編 `package.json` の npm workspaces 化は必須にしない。`admin/` は独立 package とし、本編の typecheck / lint / e2e に **勝手に食い込ませない**（必要なら後から root から明示 script を足す）。

### 4.4 技術スタック

| 層 | 選択 |
| --- | --- |
| Runtime | Node `>=24 <25` |
| BFF | Hono + `@hono/node-server` |
| DB | `pg` |
| 境界検証 | Zod |
| UI | React 19 + Vite + React Router |
| クライアント取得 | TanStack Query |
| スタイル | Tailwind CSS 4（admin 専用 entry） |
| UI 言語 | 日本語 |

UI は **デスクトップ運用密度**を優先する。本編の mobile-first・44px タッチ必須は適用しない（最低限のキーボード操作は守る）。

---

## 5. 画面仕様

共通:

- 日付・「本日」は **JST**。
- 一覧は新しい順。ページサイズ既定 50、上限 100。
- ヘッダ常時: **「本番・閲覧のみ」** バッジ、接続先の host（パスワード無し）、最終取得時刻。
- フィルタは server 側で適用。

### 5.1 ダッシュボード

当日（JST）と直近 7 日のサマリ。

| 指標 | 主ソース |
| --- | --- |
| 生成 status 別件数 | `private.ai_generation_requests` |
| 全体 AI 枠 reserved / sent | `private.ai_global_daily_usage` |
| フィードバック category 別件数 | `public.user_feedback` |
| stuck 生成件数（`processing` かつ `processing_expires_at` 超過） | 生成台帳 |
| 共有 job の失敗・滞留件数 | `private.share_generalization_jobs` |
| 課金 status 別件数 | `private.billing_subscriptions` |

各カードから詳細画面へリンクする。ダッシュボード自体は集計のみ。

### 5.2 生成ログ

**一覧列:**  
`created_at`, `status`, `request_kind`, `failure_code`, `duration_ms`, `actual_model_ids`, `quality_mode`, `repair_attempted`, `user_id`, `id`

**フィルタ:** status, request_kind, failure_code, 日付範囲, `user_id` 完全一致

**詳細:** 上記に加え `started_at`, `completed_at`, `user_usage_day`, `global_sent_calls`, `terminal_details`（DB 上の閉じた JSON）, `change_reason`, 参照用 UUID（`completed_menu_id` / `draft_id` 等）

**出さない:** `request_hmac`、献立・下書き本文、menu/dish 中身、email、prompt、生 AI 出力。UUID 参照先を join して中身を辿らない。

### 5.3 不具合・要望

**一覧列:** `created_at`, `category`, `client_path`, `user_id`, 本文先頭 80 字

**フィルタ:** category, 日付範囲, `user_id`, 本文キーワード（server 側 bind 付き `ILIKE`。ログに検索文字列を残さない）

**詳細:** `body` 全文 + メタデータ

### 5.4 利用枠・健全性

| ブロック | 内容 |
| --- | --- |
| グローバル日次 | 直近 14 日の `ai_global_daily_usage` |
| stuck 生成 | 期限切れ `processing` 一覧（生成ログ相当の最小列） |
| 失敗トップ | 直近 24h / 7d の `failure_code` 件数ランキング |
| 上限付近 | 当日 success が上限付近の **user_id 一覧**（最大 50 件、UUID のみ） |

### 5.5 課金概況

**主表示（集計）:**  
status 別件数、`cancel_at_period_end = true` 件数、past_due 件数、`billing_webhook_events` の event_type 別・直近 7 日件数

**任意一覧（折りたたみ可）:**  
`user_id`, `status`, `current_period_end`, `trial_end`, `cancel_at_period_end`, `past_due_since`

**出さない:** `stripe_subscription_id`, `stripe_price_id`, `last_stripe_event_id`, Stripe customer ID

### 5.6 共有パイプライン

**一覧:**  
`created_at`, `status`, `failure_code`, `skip_reason`, `claimed_at`, `heartbeat_at`, `finished_at`, `pass1_model`, `pass2_model`, `contributor_user_id`, `id`

**フィルタ:** status, failure_code, 日付

**サマリ:** status 別件数、長時間 claimed かつ heartbeat が古い滞留ジョブ

**出さない:** 共有レシピ本文・元献立中身（`source_menu_id` は UUID のみ）

---

## 6. API（BFF）

すべて **GET のみ**。POST / PUT / PATCH / DELETE はルーティングしない。

| Path | 用途 |
| --- | --- |
| `GET /api/health` | プロセス生存 + DB 接続可否（失敗詳細は汎用文言） |
| `GET /api/dashboard` | ダッシュボード集計 |
| `GET /api/generations` | 生成一覧（filter + pagination） |
| `GET /api/generations/:id` | 生成詳細 |
| `GET /api/feedback` | フィードバック一覧 |
| `GET /api/feedback/:id` | フィードバック詳細 |
| `GET /api/quota-health` | 利用枠・健全性 |
| `GET /api/billing` | 課金概況 |
| `GET /api/share-jobs` | 共有 job 一覧 + サマリ |

- クエリパラメータは Zod で検証。不正は 400。
- レスポンスは `shared/schemas.ts` の DTO で safeParse してから返す（余分な列の漏洩を防ぐ）。
- 同一 origin のため CORS は付けない。
- 単一 API 失敗時は当該パネルのみエラー表示。他画面は継続可能にする。
- クエリ timeout の目安は 15 秒。

---

## 7. データアクセス

### 7.1 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ADMIN_DATABASE_URL` | はい | 本番（または指定）Postgres URL。Session pooler 推奨 |
| `ADMIN_PORT` | いいえ | 既定 `5193` |
| `ADMIN_BIND_HOST` | いいえ | コンテナ内既定 `0.0.0.0` |

- `ADMIN_DATABASE_URL` 未設定・空ならプロセスは起動時に失敗する。
- 実値は `.env.admin`（**git 管理外**）。`.env.admin.example` にキー名のみコミット。

### 7.2 クエリモジュール

`admin/server/src/queries/*.ts` に画面単位の名前付きクエリを置く。

- SQL 文字列連結で識別子や値を埋め込まない。値は `$1` bind のみ。
- `LIMIT` に上限を強制する。
- menu / household / profiles など **中身を持つ表への join はしない**。

### 7.3 本番 read-only ロール

DB ロールを read-only に絞るのは望ましいが、ロール新設は本番変更になるため **第1版スコープ外**。  
第1版は既存接続文字列 + アプリの `READ ONLY` トランザクション強制で代替する。

---

## 8. Docker

### 8.1 `compose.admin.yaml`（概念）

```yaml
services:
  admin:
    build:
      context: .
      dockerfile: admin/Dockerfile
    env_file:
      - .env.admin
    ports:
      - "127.0.0.1:5193:5193"
    restart: "no"
```

- 本編サービスを include / depends_on しない。
- ホスト公開は必ず `127.0.0.1`。

### 8.2 イメージ

- `admin/Dockerfile`: Node 24 slim、`admin/` の依存インストール → client build → server 起動。
- デフォルト実行は **静的配信込み 1 プロセス**（本番 DB を触る経路を単純にする）。
- ローカル HMR 用の二プロセス dev は package script としては許容するが、compose の正は 1 プロセス。

### 8.3 起動

```bash
cp .env.admin.example .env.admin
# ADMIN_DATABASE_URL を設定
docker compose -f compose.admin.yaml up --build
# http://127.0.0.1:5193
```

---

## 9. セキュリティ

1. 認証なしのため、**共有 PC・信頼できないローカルユーザーがいる環境では使わない**（README / 設計どおり明記）。
2. 任意 SQL・任意テーブル名を API から受けない。
3. レスポンス mapper と Zod DTO の両方で秘匿フィールドを落とす（防御的二重化）。
4. アクセスログに query string の全文を出さない。
5. CI・Netlify・`preflight:production` / `smoke:production` の対象に admin を入れない。
6. `.env.admin` をコミットしない（`.gitignore` に追加）。

---

## 10. テストと受け入れ

### 10.1 自動テスト（admin パッケージ内）

| 層 | 内容 |
| --- | --- |
| unit | filter → bind パラメータ、Zod DTO、mapper が禁止フィールドを含まないこと |
| server | モック pool または同等で READ ONLY 経路・LIMIT・400 系 |

本編の Playwright e2e / pgTAP / フル CI には第1版では載せない。

### 10.2 受け入れ条件

1. `docker compose -f compose.admin.yaml up --build` だけで `http://127.0.0.1:5193` が開く。
2. ローカル Supabase を起動しなくても動く。
3. 6 画面が接続先 DB のデータで埋まる（空表なら空表示で落ちない）。
4. ブラウザのネットワークに DB URL / パスワードが出ない。
5. API は GET のみ（書き込みメソッドは 404 等で拒否）。
6. 表示・型・mapper に email / Stripe ID / `request_hmac` が含まれない。

---

## 11. 実装境界（してよい / しない）

| してよい | しない |
| --- | --- |
| `admin/**` 新規 | 本編 `src/` への admin ルート |
| `compose.admin.yaml` | 本編 `compose.yaml` への常時サービス追加 |
| `.env.admin.example` / `.gitignore` | 本番マイグレーション・RLS 変更 |
| 短い起動手順の docs 追記 | Netlify / deploy profile 接続 |
| admin 単体 vitest | 本編 e2e への admin シナリオ（第1版） |
| READ ONLY SELECT | 書き込み・Stripe 操作・Auth Admin でのメール取得 |

---

## 12. 実装フロー（承認後）

1. 本書の人間承認。
2. `writing-plans` で Task 分割した implementation plan を `docs/superpowers/plans/` に作成。
3. `using-git-worktrees` で `.worktrees/` 配下に隔離ブランチを作成して実装。
4. admin 単体の format / lint / typecheck / test → 手動で `.env.admin` 接続確認。

---

## 13. 決定ログ（ブレインストーム）

| 論点 | 決定 |
| --- | --- |
| 操作範囲 | A: 閲覧のみ |
| 識別情報 | A: user_id（UUID）のみ |
| 第1版画面 | ダッシュボード / 生成ログ / FB / 枠・健全性 / 課金 / 共有の全部 |
| Compose | C: `compose.admin.yaml` で本編と完全分離 |
| アプリ構成 | 案1: 独立 `admin/`（SPA + BFF） |
| DB アクセス | Postgres URL + セッション READ ONLY（REST/service_role は第1版不使用） |
