# 運用管理コンソール（kondate-admin）

ローカル専用の **閲覧のみ** 運用 UI です。本番（または staging）の Postgres を SELECT 専用ロール `kondate_ops_readonly` で参照し、生成・枠・課金・共有・フィードバックの健全性を把握します。

| 項目 | 内容 |
| --- | --- |
| 公開 URL | `http://127.0.0.1:5193` のみ（LAN 公開しない） |
| 本編アプリ | 非依存。`compose.yaml` とは別の `compose.admin.yaml` |
| デプロイ | **しない**（Netlify / 本番 URL に載せない） |
| 認証 | アプリログインなし。Host allowlist + loopback。**`ADMIN_LOCAL_TOKEN` 推奨** |
| 操作 | GET / SELECT のみ。書き込み API・書き込み RPC なし |

設計の正本: [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md)

---

## 禁止事項（必読）

1. **共有 PC・他ユーザーがいるマシンでは起動しない**（信頼できる単一オペレータのみ）。
2. **`postgres` スーパーユーザ URL を使わない**。起動時に reject する。
3. **port `6543`（transaction pooler）を使わない**。Session pooler **5432** のみ。
4. **`.env.admin` をコミットしない**（`.gitignore` / `admin/.dockerignore` 対象）。
5. **`VITE_*` に DB URL やパスワードを載せない**。
6. feedback 本文は利用者の自由記述。**スクショ・チャット・外部共有しない**。
7. 識別表示は **`user_id`（UUID）のみ**。email / 氏名 / `identity_key` は出さない。

---

## 画面一覧

| 画面 | 内容 |
| --- | --- |
| ダッシュボード | 当日・直近の生成 status、全体枠、FB 件数、stuck、共有滞留、課金 status 集計 |
| 生成ログ | `ai_generation_requests` 一覧・詳細（status / failure_code / model / 所要時間等） |
| 不具合・要望 | `user_feedback`（既定は本文先頭 80 字。全文は明示操作後） |
| 利用枠・健全性 | グローバル日次、stuck、failure_code ランキング、上限付近 user |
| 課金概況 | status 集計・任意一覧（Stripe ID は出さない） |
| 共有パイプライン | share job 一覧・滞留（lease **15 分**） |

日付は **JST**。一覧の日付範囲は必須（既定 7 日、上限 31 日）。

---

## 前提（DB 側）

対象 DB に次が済んでいること。

1. migration  
   `supabase/migrations/20260811180000_ops_readonly_role.sql`  
   （ロール NOLOGIN + 6 表 SELECT GRANT + `user_feedback` RLS policy + ops 索引）
2. ロールを **LOGIN** 化しパスワード設定  
   - **ローカル Compose:** リポジトリルートで  
     `OPS_READONLY_DB_PASSWORD=… ./scripts/provision-ops-readonly-role.sh`  
   - **本番 / staging:** [`docs/deployment/supabase.md`](../docs/deployment/supabase.md) §6.1

SELECT 対象表（migration 固定）:

- `public.user_feedback`
- `private.ai_generation_requests`
- `private.ai_global_daily_usage`
- `private.billing_subscriptions`
- `private.billing_webhook_events`
- `private.share_generalization_jobs`

---

## クイックスタート（推奨: Docker）

リポジトリ **ルート**（`admin/` の親）で実行する。

```bash
# 1. 環境ファイル
cp .env.admin.example .env.admin
# エディタで ADMIN_DATABASE_URL 等を設定（下記「環境変数」）

# 2. 起動
docker compose -f compose.admin.yaml up --build

# 3. ブラウザ
# http://127.0.0.1:5193
```

停止:

```bash
docker compose -f compose.admin.yaml down
```

ビルドのみ（DB URL 不要）:

```bash
docker compose -f compose.admin.yaml build
```

---

## 環境変数（`.env.admin`）

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ADMIN_DATABASE_URL` | はい | `kondate_ops_readonly` の Postgres URL |
| `ADMIN_PORT` | いいえ | 既定 `5193` |
| `ADMIN_BIND_HOST` | いいえ | コンテナ内既定 `0.0.0.0`（ホスト公開は compose が `127.0.0.1` 固定） |
| `ADMIN_LOCAL_TOKEN` | 推奨 | 高エントロピー。設定時は `/api/*` が `Authorization: Bearer …` 必須（`/api/health` は除外可） |
| `ADMIN_ALLOW_INSECURE_LOCAL_DB` | ローカルのみ | `1` のとき loopback 等 + `sslmode=disable` を許可。本番 URL では使わない |

### `ADMIN_DATABASE_URL` の受理形

**本番 / staging（推奨: Session pooler）**

```text
postgresql://kondate_ops_readonly.<20文字project-ref>:<password>@aws-0-….pooler.supabase.com:5432/postgres?sslmode=require
```

**direct（IPv6 等が通る場合）**

```text
postgresql://kondate_ops_readonly:<password>@db.<20文字project-ref>.supabase.co:5432/postgres?sslmode=require
```

- username は **exact** `kondate_ops_readonly` または `kondate_ops_readonly.<20-char-ref>` のみ（prefix 不可）
- `sslmode` は `require` / `verify-ca` / `verify-full`
- port **5432** のみ（**6543 禁止**）
- `postgres` ユーザー禁止

URL・パスワードをチケット・ログ・コミットに載せない。

---

## パッケージ構成

```text
admin/
  client/          # React + Vite（閲覧 UI）
  server/          # Hono BFF（pg + READ ONLY）
  shared/          # Zod DTO
  Dockerfile       # multi-stage（client build + server）
  package.json
compose.admin.yaml # リポジトリルート
.env.admin.example # リポジトリルート
```

- ブラウザ → 同一 origin の `/api/*` のみ（service_role / DB URL はサーバのみ）
- 業務 SQL は `BEGIN READ ONLY` ヘルパ経由の **列名列挙 SELECT** のみ
- 静的ファイルは root 封じ込め付きで配信

---

## 開発（ホスト Node 24 がある場合）

```bash
cd admin
npm ci
# ルートの .env.admin を読むか、export で渡す
export $(grep -v '^#' ../.env.admin | xargs)   # 注意: シェル履歴に残るので本番 URL では非推奨
npm run dev     # 開発用。compose の正は production build 1 プロセス
```

本番相当の起動:

```bash
cd admin
npm run build
npm start
```

---

## 検証

```bash
# admin パッケージ（Docker 経由の例）
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm ci
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm test
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm run typecheck
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm run lint

# リポジトリ境界（ports / ignore / format prune）
node --test tests/tooling/admin-compose.test.mjs

# DB ロール（本編スタック + migration 適用後）
docker compose --profile test run --rm db-test
# → ops_readonly_role.test.sql
```

ホストに Node 24 がある場合は `cd admin && npm test` でも可。

---

## トラブルシュート

| 症状 | 確認 |
| --- | --- |
| 起動即 exit | `ADMIN_DATABASE_URL` 未設定 / `postgres` ユーザー / port 6543 / sslmode 不正 / ロールが LOGIN 未化 |
| `permission denied` | migration 未適用、または GRANT 対象外の表を触っていないか |
| feedback が常に 0 件 | RLS policy `user_feedback_ops_readonly_select` があるか（migration） |
| ブラウザで Host 400 | `http://127.0.0.1:5193` または `http://localhost:5193` で開く |
| API 401 | `ADMIN_LOCAL_TOKEN` 設定時は UI の token 欄に同じ値を入れる（sessionStorage） |
| compose が `.env.admin` で失敗 | ファイルを作成済みか（`env_file` 必須） |

---

## 関連ドキュメント

| 文書 | 内容 |
| --- | --- |
| [docs/local-development.md](../docs/local-development.md#運用管理コンソールローカル専用閲覧のみ) | ローカル開発全体の中の短い節 |
| [docs/deployment/supabase.md](../docs/deployment/supabase.md) §6.1 | 本番での `kondate_ops_readonly` LOGIN 手順 |
| [docs/testing/database-access-matrix.md](../docs/testing/database-access-matrix.md) | 表権限 |
| [docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md](../docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md) | 設計 |
| [docs/superpowers/plans/2026-08-11-local-ops-admin-console.md](../docs/superpowers/plans/2026-08-11-local-ops-admin-console.md) | 実装計画 |
