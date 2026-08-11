# ローカル専用運用管理コンソール設計

- 日付: 2026-08-11
- 状態: **改訂済み・人間再承認待ち**（1次 / 敵対 / 2次レビュー反映。案 A: SELECT 専用 LOGIN）
- 種別: 設計。**本書だけでは実装を開始しない**（再承認後に implementation plan → worktree）
- 対象: オペレータがローカルから本番 Supabase を **閲覧のみ** する内部コンソール
- レビュー:
  - [1次](../reviews/2026-08-11-local-ops-admin-console-primary.md)
  - [敵対](../reviews/2026-08-11-local-ops-admin-console-adversarial.md)
  - [2次](../reviews/2026-08-11-local-ops-admin-console-secondary.md)

---

## 1. 結論

本番 Netlify に載せず、アプリログイン機能も付けない **ローカル専用の read-only 運用 UI** を、本編アプリから物理分離して用意する。

| 項目 | 決定 |
| --- | --- |
| 配置 | リポジトリ直下 `admin/`（client + server + shared） |
| 起動 | `compose.admin.yaml` のみ（本編 `compose.yaml` と分離・include しない） |
| 接続先 | 本番（または staging）Postgres。**Session pooler port 5432** |
| DB 権限の正 | **`kondate_ops_readonly` LOGIN**（SELECT のみ）。アプリ `BEGIN READ ONLY` は防御層 |
| 権限モデル（HTTP） | アプリユーザー認証なし。**同一マシン上の単一信頼オペレータ** + `127.0.0.1` publish + **Host allowlist** |
| 操作 | **GET / SELECT のみ**。書き込み API・書き込み RPC・Stripe API は持たない |
| 識別表示 | **`user_id`（UUID）のみ**。email / 氏名 / `identity_key` は出さない |
| デプロイ | 対象外。CI / Netlify / `profile: deploy` に admin アプリを接続しない |
| 本番変更 | **ロール・GRANT・ops 用部分索引の migration は第1版スコープ内**（アプリ本体の挙動変更はしない） |

推奨アーキテクチャ: **Vite + React の閲覧 SPA** と **Hono BFF（同一プロセスで静的配信）**。

---

## 2. 目的と対象外

### 2.1 目的

- 生成の成功・失敗・stuck、全体 AI 枠、フィードバック、課金 status 集計、共有ジョブの滞留を **一画面群で把握**する。
- ローカル Supabase スタックを起動しなくても、指定 DB を参照できる。
- ブラウザに DB URL / パスワード / service_role を載せない。
- 接続主体を **書込不能な専用 LOGIN** に固定し、未認証ローカル UI が管理者 DB パスワードを保持しない。

### 2.2 対象外

- 多人数向けホスティング、RBAC、恒久監査ログ基盤。
- Netlify / 本番 URL への admin デプロイ。
- INSERT / UPDATE / DELETE、枠の手動調整、課金 reconcile 実行、アカウント削除などの **変更操作**。
- PostgREST への `private` 公開、`service_role` への private 表 GRANT 拡大。
- 献立本文・下書き・prompt・生 AI 出力・アレルギー詳細の閲覧。
- 本編 e2e / 本編 CI フルパイプラインへの admin 組み込み（第1版）。
- 収益計測 analytics 個票の閲覧（別設計）。
- feedback 本文の全文キーワード検索（第1版は **外す**。category / user_id / 日付のみ）。

---

## 3. 不変条件

1. **DB 権限の正は SELECT 専用 LOGIN**（`kondate_ops_readonly`）。管理者 `postgres` URL での運用起動は **拒否**する。
2. **アプリ READ ONLY は防御層**であり権限の代替ではない。プール `options=-c default_transaction_read_only=on`、全クエリは helper 経由の `BEGIN READ ONLY` … `COMMIT/ROLLBACK` のみ。生の `pool.query` 直叩き禁止。
3. **Read-only 経路**: サーバーは `SELECT` と集計のみ。クライアントから任意 SQL を受けない。固定の名前付きクエリのみ。**`SELECT *` 禁止**（列名列挙のみ）。
4. **識別最小**: 利用者に紐づく表示キーは `user_id`（および共有の `contributor_user_id`）の UUID に限る。email・氏名・プロフィール・`identity_key` は出さない・SELECT しない。
5. **秘匿フィールド非露出**（正本リストは §3.1）。mapper と Zod DTO の二重排除。
6. **ログ**: feedback 本文、検索キーワード、UUID 以外の識別子、SQL 断片、接続 URL をサーバーログに出さない。path・status・所要時間・closed error code に留める。
7. **鍵の置き場**: `ADMIN_DATABASE_URL` は server 環境変数のみ。`VITE_*` にシークレットを置かない。anon / service_role は第1版で使わない。
8. **公開面**: ホスト側 ports は **`127.0.0.1:5193:5193` 固定**（ソーステストで検証）。コンテナ内 listen は `0.0.0.0:5193` でよい。
9. **Host allowlist**: BFF は `Host` が `127.0.0.1:5193` または `localhost:5193` のときだけ `/api/*` を処理する（それ以外は 400）。
10. **本編非混入**: `src/` ルート、Netlify Functions、本番ビルド成果物に admin を含めない。
11. **本編スタック非依存**: `compose.admin.yaml` は `db` / `kong` / `app` に `depends_on` しない。
12. **free-form 本文**: `user_feedback.body` は画面表示を許可するが、永続ログ・外部送信・analytics に載せない。既定 UI は先頭 80 字、全文は明示アクション。
13. **エラー応答**: closed `code` + 日本語の固定 `message` のみ。`err.message` / SQLSTATE / 関係名を JSON に載せない。

### 3.1 禁止カラム・禁止リレーション（正本）

named query の SELECT / JOIN 対象から **常に除外**する。DTO・画面・ログにも出さない。

| 区分 | 対象 |
| --- | --- |
| 生成台帳 | `identity_key`, `request_hmac`, `request_hmac_version` |
| 課金 | すべての `stripe_*` / `*_stripe_*`（`billing_customers.stripe_customer_id`、`billing_subscriptions.stripe_subscription_id` / `stripe_price_id`、`billing_webhook_events.stripe_event_id` 等） |
| 下書き・共有本文 | `private.generation_draft_submission_versions` の memo / ingredients / pantry 系、`private.shared_emergency_recipes.menu_payload`、共有レシピ本文 |
| 世帯・安全 | `public.profiles` の氏名相当、`member_allergies` / `member_dislikes`、献立・手順・材料の中身 |
| Auth | **`auth.*` スキーマ全体**（email 等） |
| 接続 | DB URL、パスワード、userinfo |

**許可の参照 UUID（中身は join しない）:**  
`completed_menu_id`, `draft_id`, `source_menu_id`, `replace_dish_id` 等。UI は monospace のコピー用テキストのみ。メニュー詳細画面への導線は作らない。

`terminal_details` は DB 制約上 conflict 時の `{ conflictCodes: [...] }` のみ。そのまま返してよい。

---

## 4. アーキテクチャ

### 4.1 トポロジ

```
Browser  http://127.0.0.1:5193
    │  同一 origin（/ 静的 + /api/*）
    │  Host allowlist
    ▼
admin コンテナ (Node 24, 1 プロセス)
    ├─ Hono: /api/*
    └─ 静的: client production build
    │
    │  pg as kondate_ops_readonly
    │  BEGIN READ ONLY + statement_timeout
    ▼
Postgres (Session pooler :5432, sslmode=require|verify-*)
    public.user_feedback          (SELECT only for ops role)
    private.ai_generation_requests
    private.ai_global_daily_usage
    private.billing_subscriptions / billing_webhook_events
    private.share_generalization_jobs
    …（§7.4 の GRANT 表のみ）
```

### 4.2 なぜ PostgREST / service_role を正にしないか

本番 API は通常 `public` のみ露出する。管理上必要な生成台帳・枠・課金・共有は **`private` スキーマ**にあり、表 GRANT は `service_role` にも無い（SECURITY DEFINER RPC のみ）。  
第1版の読取正本は **専用 LOGIN による直接 SQL（SELECT のみ）** とする。

### 4.3 リポジトリ配置

```
admin/
  Dockerfile                 # context は admin/ 推奨
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
  server/src/…
  client/…
  shared/schemas.ts
compose.admin.yaml
.env.admin.example
supabase/migrations/…_ops_readonly_role.sql   # 第1版で追加
```

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

UI は **デスクトップ運用密度**優先。本編の mobile-first・44px 必須は適用しない。

### 4.5 本編 tooling 境界（第1版固定・案 A）

本編 root の `format:check` / `lint` が `admin/` を勝手に噛まないよう、第1版で次を **必須**とする:

| 変更 | 内容 |
| --- | --- |
| `eslint.config.js` | `ignores` に `admin/**` |
| `package.json` `format` / `format:check` | `find` に `-path './admin' -prune`（および `admin/node_modules`） |
| `typecheck` | 現状どおり root `tsc -b` は admin を参照しない |
| admin 検証 | `docker compose -f compose.admin.yaml run --rm admin npm run …` 相当で format / lint / typecheck / test |

本編 e2e / 本編 CI の E2E ジョブには admin を載せない。root ignore の追加自体は本編 PR に含めてよい（admin を赤くしないための境界変更）。

---

## 5. 画面仕様

共通:

- 日付・「本日」は **JST**。API の日付クエリは **`YYYY-MM-DD`（JST 暦日）** を受け、server が `Asia/Tokyo` の `[start, next)` timestamptz に変換する。クライアントは TZ 解釈しない。
- 一覧の日付範囲は **必須**。既定 **直近 7 日**、上限 **31 日**（server で強制）。
- ページサイズ既定 50、上限 100。`ORDER BY created_at DESC, id DESC`。ページング方式は keyset または offset を plan で1つに固定。
- ヘッダ常時: **「本番・閲覧のみ」** バッジ、接続先 `hostname:port`（userinfo / password / query 無し）、`session_user` 表示（期待: `kondate_ops_readonly`）、最終取得時刻。
- フィルタは server 側で適用。

### 5.1 ダッシュボード

当日（JST）と直近 7 日のサマリ。**サーバは単一ハンドラ内で集約**（クライアントが 6 API を無制限並列にしない。dashboard 用 1 リクエスト + 必要なら軽い後続）。

| 指標 | 主ソース |
| --- | --- |
| 生成 status 別件数 | `private.ai_generation_requests`（日付範囲内） |
| 全体 AI 枠 reserved / sent | `private.ai_global_daily_usage` |
| フィードバック category 別件数 | `public.user_feedback` |
| stuck 生成件数 | `processing` かつ `processing_expires_at < now()` |
| 共有 job 失敗・滞留件数 | §5.6 の定義 |
| 課金 status 別件数 | `private.billing_subscriptions` |

### 5.2 生成ログ

**一覧列:**  
`created_at`, `status`, `request_kind`, `failure_code`, `duration_ms`, `actual_model_ids`, `quality_mode`, `repair_attempted`, `user_id`, `id`

**フィルタ:** status, request_kind, failure_code, **必須日付範囲**, `user_id` 完全一致

**詳細:** 上記 + `started_at`, `completed_at`, `user_usage_day`, `global_sent_calls`, `terminal_details`, `change_reason`, 参照 UUID（中身 join なし）

**出さない:** §3.1 全項目。`quota_*_limit` / `personal_quota_disabled` は第1版の一覧には出さない（必要なら詳細の数値のみ、identity は出さない）。

### 5.3 不具合・要望

**一覧列:** `created_at`, `category`, `client_path`, `user_id`, 本文先頭 80 字

**フィルタ:** category, **必須日付範囲**, `user_id`  
**第1版でやらない:** 本文 `ILIKE` キーワード検索（索引なし full scan を避ける）

**詳細:** 全文 `body` は **明示アクション**（例: 「全文を表示」）の後にのみ取得・表示。UI に「自由記述。外部共有・スクショ・チャット貼付をしない」注意を出す。

### 5.4 利用枠・健全性

| ブロック | 内容 |
| --- | --- |
| グローバル日次 | 直近 **14 日**の `ai_global_daily_usage` |
| stuck 生成 | 期限切れ `processing` 一覧（生成ログ相当の最小列、日付/件数上限あり） |
| 失敗トップ | 直近 24h / 7d の `failure_code` 件数ランキング（日付範囲内 scan） |
| 上限付近 | 下記クエリ契約。最大 **50** 件 |

**上限付近クエリ契約（固定）:**

1. ソースは `private.ai_generation_requests`（JST 当日、`status = 'succeeded'` を `user_id` 集計）。  
   ※製品 success 台帳の正本は `private.ai_identity_daily_usage`（PK は `identity_key`、user_id 列なし）だが、**identity_key を SELECT しない**ため生成台帳で近似する。
2. 各 `user_id` の上限は、同一ユーザーの直近 request 行の `quota_success_limit`（3 または 10）を用いる。
3. 「付近」= `success_count >= quota_success_limit - 1`。
4. 表示列: `user_id`, `success_count`, `quota_success_limit` のみ。

### 5.5 課金概況

**主表示（集計）:**  
status 別件数、`cancel_at_period_end = true` 件数、past_due 件数、`billing_webhook_events` の **event_type 別**・直近 7 日件数（`stripe_event_id` は SELECT しない）

**任意一覧:**  
`user_id`, `status`, `current_period_end`, `trial_end`, `cancel_at_period_end`, `past_due_since`

**出さない:** §3.1 の Stripe ID 一式。`billing_customers` への join 禁止。

### 5.6 共有パイプライン

**一覧列:**  
`created_at`, `status`, `failure_code`, `skip_reason`, `claimed_at`, `heartbeat_at`, `finished_at`, `pass1_model`, `pass2_model`, `contributor_user_id`, `id`

**フィルタ:** status, failure_code, **必須日付範囲**

**滞留定義（固定・製品 lease と一致）:**

```sql
status = 'running'
AND coalesce(heartbeat_at, claimed_at) < now() - interval '15 minutes'
```

（`shared/contracts/share-quota.ts` の `jobLeaseMinutes: 15` / reaper と同値。）

**pending 長期放置:** 第1版ダッシュボードでは **件数のみ**（例: `status = 'pending' AND created_at < now() - interval '1 hour'`）。一覧の主対象は running 滞留 + 失敗。

**出さない:** 共有レシピ本文・元献立中身（`source_menu_id` は UUID のみ）。

---

## 6. API（BFF）

すべて **GET のみ**。POST / PUT / PATCH / DELETE はルーティングしない（メソッドは 404 または 405）。

| Path | 用途 |
| --- | --- |
| `GET /api/health` | プロセス生存。DB 到達は **オプション**（失敗しても process は up と返してよい）。詳細エラーは汎用文言 |
| `GET /api/dashboard` | ダッシュボード集計（サーバ側集約） |
| `GET /api/generations` | 生成一覧 |
| `GET /api/generations/:id` | 生成詳細 |
| `GET /api/feedback` | フィードバック一覧（先頭 80 字） |
| `GET /api/feedback/:id` | 詳細メタ。全文 body は query `includeBody=1` 等の明示時のみ |
| `GET /api/quota-health` | 利用枠・健全性 |
| `GET /api/billing` | 課金概況 |
| `GET /api/share-jobs` | 共有 job 一覧 + サマリ |

共通:

- クエリは Zod 検証。不正は 400（closed message）。
- レスポンスは `shared/schemas.ts` の DTO で safeParse してから返す。
- 同一 origin。CORS ヘッダは付けない。
- **Host allowlist**（§3.9）。
- クエリ / statement_timeout の目安 **15s**（ロール既定と整合）。
- pool `max` は **2–4**。

### 6.1 ローカル HTTP 面（第1版）

| 項目 | 第1版 |
| --- | --- |
| アプリユーザーログイン | なし（意図的） |
| Host allowlist | **必須** |
| `ADMIN_LOCAL_TOKEN` | **推奨**。設定されていれば全 `/api/*`（health 除く可）で `Authorization: Bearer …` を要求。未設定時は起動ログに警告し、単一オペレータ前提を README で再掲 |
| 共有 PC | **起動しない**（受け入れ条件） |

---

## 7. データアクセスと DB ロール

### 7.1 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ADMIN_DATABASE_URL` | はい | **`kondate_ops_readonly` の** Session pooler URL（下記受理形） |
| `ADMIN_PORT` | いいえ | 既定 `5193` |
| `ADMIN_BIND_HOST` | いいえ | コンテナ内既定 `0.0.0.0`（ホスト publish とは別） |
| `ADMIN_LOCAL_TOKEN` | 推奨 | 高エントロピー。設定時は API で要求 |

実値は `.env.admin`（**git 管理外**）。`.env.admin.example` にキー名のみ。

### 7.2 URL 受理形（fail-closed）

本番 / staging:

- ホスト: Supabase Shared **Session** pooler（`*.pooler.supabase.com` 等）または公式が示す Session 形
- **port `5432` のみ**。port **`6543`（transaction mode）は起動時 reject**
- **`sslmode=require` または `verify-ca` / `verify-full` 必須**
- ユーザー名は **`kondate_ops_readonly`**（pooler 接頭辞付きならその local part が一致）であること
- URL・パスワードをログ / エラー / ヘッダ / health に出さない
- ヘッダ表示用 host は URL パース後の `hostname:port` のみ

local Compose DB への接続（開発）:

- `ADMIN_ALLOW_INSECURE_LOCAL_DB=1` が立っているときのみ `sslmode=disable` と `127.0.0.1` / `host.docker.internal` / compose サービス名を許可
- それでも **ユーザーは `kondate_ops_readonly`**（local でも provision）。`postgres` スーパーユーザ URL は **常に reject**

node-pg SSL: 本番は TLS 必須。`rejectUnauthorized` は maintenance 経路の既知方針に合わせ plan で1行固定（自己署名 pooler 連鎖がある場合は verify 方針を運用文書に残す）。

### 7.3 起動時検証（listen 前に失敗したら process exit）

1. URL パースと §7.2 の reject 条件。
2. 接続後: `session_user` / `current_user` が `kondate_ops_readonly`。
3. `current_setting('statement_timeout')` が期待値（例: `15s`）。
4. `BEGIN READ ONLY` 内で `SELECT 1` 成功。
5. 意図的 DML canary（例: `CREATE TEMP TABLE` または許可表への無害な書込試行）が **失敗**すること。
6. `has_table_privilege(current_user, 'private.ai_generation_requests', 'INSERT')` 等が **false**（代表表で INSERT/UPDATE/DELETE が付いていないこと）。付いていたら exit。
7. 代表 SELECT（`user_feedback` 1 行 LIMIT 1 等）が権限エラーにならないこと。

### 7.4 `kondate_ops_readonly` ロール仕様（第1版・本番変更あり）

maintenance ロール（`kondate_maintenance_login` / executor）は **cleanup RPC 専用**で表 SELECT 不可。admin 用に **別 LOGIN** を新設する。

**ロール属性（LOGIN）:**

```text
LOGIN NOINHERIT
NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
CONNECTION LIMIT 4
```

**ロール設定:**

```sql
ALTER ROLE kondate_ops_readonly SET statement_timeout = '15s';
ALTER ROLE kondate_ops_readonly SET default_transaction_read_only = on;
```

**GRANT（最小）:**

| 対象 | 権限 |
| --- | --- |
| schema `public` | `USAGE` |
| schema `private` | `USAGE` |
| `public.user_feedback` | `SELECT` + RLS policy `FOR SELECT TO kondate_ops_readonly USING (true)`（**GRANT だけでは 0 行**） |
| `private.ai_generation_requests` | `SELECT` |
| `private.ai_global_daily_usage` | `SELECT` |
| `private.billing_subscriptions` | `SELECT` |
| `private.billing_webhook_events` | `SELECT` |
| `private.share_generalization_jobs` | `SELECT` |

- **INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER は付与しない。**
- 書き込み RPC・`run_kondate_maintenance`・Auth Admin 相当の EXECUTE は付与しない。
- `auth` スキーマ USAGE を付けない。
- DEFAULT PRIVILEGES で将来表に自動 GRANT されないよう、migration で明示表のみ。
- パスワードは Dashboard / シークレットマネージャで設定（リポジトリに置かない）。local は `provision-ops-readonly-role` 系 script（maintenance と同様）で用意。

**列レベル:** 第1版は表 SELECT + アプリ列 allowlist で足りる。Stripe 列はアプリが SELECT しない。将来必要なら column GRANT に締められる。

### 7.5 クエリモジュール

`admin/server/src/queries/*.ts`:

- 値は `$1` bind のみ。識別子連結禁止。
- **列名列挙 SELECT のみ**（`SELECT *` 禁止。unit で SQL 文字列を検査してよい）。
- `LIMIT` 上限強制。日付範囲必須の一覧は範囲外を拒否。
- menu / household / profiles / auth / draft 本文表 / shared recipe payload へ **join しない**。

### 7.6 ops 用索引（第1版 migration に含める）

本番負荷を抑えるため、次を migration で追加する（名前は実装時に一意化）:

1. `private.ai_generation_requests (created_at desc, id desc)` — 新しい順一覧。
2. 必要なら `(status, created_at desc)` の部分または複合（実装で EXPLAIN 相当を検討）。
3. `public.user_feedback (created_at desc, id desc)` — 日付順一覧（body 検索はしない）。

既存の `share_generalization_jobs_running_heartbeat_idx` は滞留クエリに利用する。

---

## 8. Docker と秘密

### 8.1 `compose.admin.yaml`

```yaml
services:
  admin:
    build:
      context: ./admin
      dockerfile: Dockerfile
    env_file:
      - .env.admin
    ports:
      - "127.0.0.1:5193:5193"
    restart: "no"
```

- 本編サービスを include / depends_on しない。
- **ports は `127.0.0.1:5193:5193` 固定**（tooling テストでソース固定。本編 `tests/tooling/compose.test.mjs` 慣習に合わせ admin 用テストを追加）。
- `ADMIN_BIND_HOST` はコンテナ内 listen 用であり、ホスト LAN 公開の代替ではない。

### 8.2 イメージ

- `admin/Dockerfile`: Node 24 slim。**build context は `./admin`**（root の `.env*` を context に載せない）。
- client build → server が静的配信する 1 プロセスが compose の正。
- build-arg に秘密を載せない。`env_file` はランタイムのみ。

### 8.3 秘密ファイル

| ファイル | git | dockerignore |
| --- | --- | --- |
| `.env.admin` | **無視必須**（`.env` だけでは不十分） | **無視必須** |
| `.env.admin.example` | コミット（キー名のみ） | — |

受け入れ: `git check-ignore -v .env.admin` がヒットすること。

### 8.4 起動

```bash
cp .env.admin.example .env.admin
# ADMIN_DATABASE_URL=postgresql://kondate_ops_readonly.…:…@…pooler…:5432/postgres?sslmode=require
docker compose -f compose.admin.yaml up --build
# http://127.0.0.1:5193
```

本番ロール未作成の環境では、migration 適用とパスワード設定を先に行う（§7.4 / deploy 文書追記）。

---

## 9. セキュリティ

1. 認証なし（または optional token）のため、**共有 PC・他 UID がいる環境では起動しない**。
2. 任意 SQL・任意テーブル名を API から受けない。
3. mapper + Zod で §3.1 を落とす。
4. アクセスログに query string 全文を出さない。
5. CI・Netlify・`preflight:production` / `smoke:production` の **admin アプリ接続**をしない（DB ロール migration の適用手順は deploy 文書に追記してよい）。
6. `.env.admin` を git / Docker context に載せない。
7. 管理者 DB URL・`postgres` ロールでの admin 起動を拒否する。
8. Host allowlist。compose ports は loopback のみ（ソーステスト）。

**残差（受容）:**

- 同一マシン上の他ローカルプロセスが token 未設定時に GET し得る → 単一オペレータ + Host + loopback で運用。token 推奨。
- ロール自身や migration 適用者は `psql` で SELECT 可能（運用者権限）。UI 外の手読みは脅威モデル外だが、GRANT 表以外は読めない。
- 監査ログ（誰がどの API を見たか）は第1版対象外。

---

## 10. テストと受け入れ

### 10.1 自動テスト

| 層 | 内容 |
| --- | --- |
| admin unit | filter → bind、Zod DTO、mapper が §3.1 禁止フィールドを含まないこと、SQL に `SELECT *` / 禁止表名が無いこと |
| admin server | モック pool で READ ONLY helper、LIMIT、日付必須 400、Host 拒否、メソッド拒否 |
| DB / pgTAP | `kondate_ops_readonly` が対象表 SELECT 可・INSERT 不可・auth 不可・書き込み RPC 不可 |
| tooling | `.env.admin` が ignore、`compose.admin.yaml` の ports が `127.0.0.1:5193:5193`、root eslint/format が admin を prune |
| 本編 e2e | 対象外（第1版） |

### 10.2 受け入れ条件

1. `docker compose -f compose.admin.yaml up --build` で `http://127.0.0.1:5193` が開く。
2. ローカル Supabase アプリスタック無しで、正しい URL なら動く。
3. 起動時検証をパスした接続だけが listen する。`postgres` URL では起動失敗。
4. 6 画面がデータまたは空表示で落ちない。
5. ブラウザ NW に DB URL / パスワードが出ない。
6. API は GET のみ。
7. 表示・型・mapper に email / Stripe ID / `request_hmac` / `identity_key` が無い。
8. `git check-ignore -v .env.admin` がヒットする。
9. compose ports ソースが loopback 固定である（tooling）。
10. 共有 PC では使わない旨が README / 起動手順にある。

---

## 11. 実装境界

| してよい | しない |
| --- | --- |
| `admin/**` 新規 | 本編 `src/` への admin ルート |
| `compose.admin.yaml` | 本編 `compose.yaml` への常時サービス追加 |
| `.env.admin.example`、`.gitignore` / `.dockerignore` に `.env.admin` | 秘密のコミット |
| root eslint/format の `admin/**` ignore | admin を本編 e2e に載せる |
| migration: ops readonly ロール + GRANT + ops 索引 | private を PostgREST 公開、service_role に private ALL |
| deploy 文書にロール用意手順 | Netlify に admin を載せる |
| admin 単体 vitest / pgTAP ロール検証 | 書き込み・Stripe 操作・Auth メール取得 |
| READ ONLY SELECT | INSERT/UPDATE/DELETE、書き込み RPC |

---

## 12. 実装フロー（再承認後）

1. 本書の人間再承認。
2. `writing-plans` で Task 分割（**最初の Task に migration + pgTAP + provision**）。
3. `using-git-worktrees` で `.worktrees/` に隔離して実装。
4. admin 単体 verify + db-test（ロール）→ 手動で `.env.admin`（readonly URL）接続確認。

---

## 13. 決定ログ

| 論点 | 決定 |
| --- | --- |
| 操作範囲 | 閲覧のみ |
| 識別情報 | user_id（UUID）のみ |
| 第1版画面 | 6 画面すべて |
| Compose | `compose.admin.yaml` 分離 |
| アプリ構成 | 独立 `admin/`（SPA + BFF） |
| DB アクセス | 直 SQL + **SELECT 専用 LOGIN（案 A）** |
| アプリ READ ONLY | 防御層（権限の正ではない） |
| root tooling | admin を ignore / prune（案 A） |
| feedback 本文検索 | 第1版オフ |
| 滞留閾値 | 15 分（製品 lease と同一） |
| 上限付近 | 生成台帳の succeeded 集計、`limit - 1`、identity_key 非 SELECT |
| HTTP 硬化 | Host allowlist 必須、local token 推奨 |

### 13.1 レビュー反映（2026-08-11）

| ID | 反映 |
| --- | --- |
| MF-C1 | §7.4 ロール新設。postgres URL 拒否。canary / privilege 検査 |
| MF-I1 | §3.1 禁止リスト + SELECT * 禁止 |
| MF-I2 | §5.4 上限付近クエリ契約 |
| MF-I3 | §7.2–7.3 URL / ssl / 5432 / 6543 |
| MF-I4 | §4.5 root tooling 境界 |
| MF-I5 | §8.2–8.3 gitignore + dockerignore + context `./admin` |
| MF-I6 | §5.6 滞留 15 分 |
| MF-I7 | 日付必須・ILIKE オフ・timeout・pool・closed error・索引 migration |
| MF-I8 | Host allowlist、feedback 全文明示、共有 PC 禁止、token 推奨 |
| MF-I9 | ports ソース固定テスト |
