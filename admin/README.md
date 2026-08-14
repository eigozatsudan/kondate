# 運用管理コンソール（kondate-admin）

ローカル専用の **閲覧のみ** 運用 UI です。本番（または staging）の Postgres を SELECT 専用ロール `kondate_ops_readonly` で参照し、生成・枠・課金・共有・フィードバックの健全性を把握します。

| 項目       | 内容                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 公開 URL   | `http://127.0.0.1:5193` のみ（LAN 公開しない）                                                            |
| 本編アプリ | 非依存。`compose.yaml` とは別の `compose.admin.yaml`                                                      |
| デプロイ   | **しない**（Netlify / 本番 URL に載せない）                                                               |
| 認証       | アプリログインなし。Host allowlist + loopback。**`ADMIN_LOCAL_TOKEN` 必須**（`/api/health` 以外の業務 API） |
| 操作       | GET / SELECT のみ。書き込み API・書き込み RPC なし                                                        |
| 検証の既定 | **local DB**（`docker compose` の本編 Postgres）。本番 URL は明示時のみ                                   |

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
8. 共有レシピは **生 `menu_payload` を出さない**。プレビューはサーバー側で正規化した DTO のみ。**外部共有・転載禁止**。
9. **`.env.admin` は本番（または staging）を指し得る**。起動前に `ADMIN_DATABASE_URL` の host を目視確認する。

---

## 画面一覧

| 画面             | 内容                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- |
| ダッシュボード   | 当日・直近の生成 status、全体枠、FB 件数、stuck、共有滞留、課金 status 集計                   |
| 生成ログ         | `ai_generation_requests` 一覧・詳細（status / failure_code / model / 所要時間等）             |
| 不具合・要望     | `user_feedback`（既定は本文先頭 80 字。全文は明示操作後）                                     |
| 利用枠・健全性   | グローバル日次、stuck、failure_code ランキング、上限付近 user                                 |
| 課金概況         | status 集計・任意一覧（Stripe ID は出さない）                                                 |
| 共有パイプライン | share job 一覧・滞留（lease **15 分**）                                                       |
| 共有レシピ       | 共有レシピ一覧・詳細・プレビュー（`menu_payload` 生データなし。業務 API は `ADMIN_LOCAL_TOKEN` **必須**） |

日付は **JST**。一覧の日付範囲は必須（既定 7 日、上限 31 日）。

---

## 前提（DB 側）— なぜ必要か

このコンソールはデータベースを **読むだけ** します。  
管理者用の `postgres` パスワードを使うと、誤操作やバグで本番データを書き換えられる危険があるため、**閲覧専用の DB ユーザー**（名前: `kondate_ops_readonly`）だけを使います。

そのユーザーは最初から用意されていません。**環境ごとに次の 2 段階を済ませてから**、接続文字列を `.env.admin` に書いて起動します。

```text
① スキーマ適用（migration）
   → DB に「閲覧専用ユーザー」と「読める表の許可」を作る

② パスワードを付けてログイン可能にする
   → そのユーザーで実際に接続できるようにする

③ ADMIN_DATABASE_URL に ② の接続文字列を書く → コンソール起動
```

① だけだとログインできません。② だけだとユーザー自体がありません。**両方必須**です。

### 手順 A — ローカルの Docker Postgres を見る場合

本編ローカル DB（`docker compose` の `db`）を対象にするとき。

1. **本編スタックを起動し、マイグレーションが当たっていること**  
   いつもどおり `docker compose up` や `./scripts/reset-local-db.sh` などで migrate が成功している状態にします。  
   関係するファイル: `supabase/migrations/20260811180000_ops_readonly_role.sql`

2. **閲覧専用ユーザーにパスワードを付ける**（リポジトリの **ルート** で）:

   ```bash
   OPS_READONLY_DB_PASSWORD='ここに強いパスワード' ./scripts/provision-ops-readonly-role.sh
   ```

   成功すると `provision-ops-readonly-role: ok` と出ます。

3. **`.env.admin` に接続文字列を書く**（port は環境の DB 公開 port に合わせる。下は例）:

   ```text
   ADMIN_DATABASE_URL=postgresql://kondate_ops_readonly:上と同じパスワード@127.0.0.1:54322/postgres?sslmode=disable
   ADMIN_ALLOW_INSECURE_LOCAL_DB=1
   ```

   `sslmode=disable` と `ADMIN_ALLOW_INSECURE_LOCAL_DB=1` は **ローカル専用** です。本番 URL では使いません。

### 手順 B — 本番（または staging）の Supabase を見る場合

1. **対象プロジェクトに migration を適用済みであること**  
   普段の DB デプロイで `20260811180000_ops_readonly_role.sql` が入っていること。未適用なら先に適用する。

2. **閲覧専用ユーザーをログイン可能にする**  
   詳細（パスワードを履歴に残さない等）は  
   [`docs/deployment/supabase.md`](../docs/deployment/supabase.md) の **§6.1**。  
   要点:

   - ユーザー名は `kondate_ops_readonly`
   - ログイン可 + パスワード設定
   - 管理者 `postgres` の URL を `.env.admin` に書かない

3. **Session pooler の接続文字列を `.env.admin` に書く**（推奨）:

   ```text
   postgresql://kondate_ops_readonly.<20文字のproject-ref>:<パスワード>@….pooler.supabase.com:5432/postgres?sslmode=require
   ```

   - port は **5432**（**6543 は使わない**）
   - `sslmode=require`（暗号化のみ。verify-ca / verify-full は実行時に検証する）

### このユーザーが読めるデータ（参考）

運用で見るログ・集計に必要な表だけ許可しています（書き込み権限は付きません）。

| 用途             | 何を読むか                                                        |
| ---------------- | ----------------------------------------------------------------- |
| 不具合・要望     | フィードバック                                                    |
| 生成ログ         | AI 生成の成否・失敗コード・所要時間など                           |
| 全体の AI 枠     | 日次の予約・送信件数                                              |
| 課金状態         | Plus 相当の status 集計（Stripe の ID は画面に出さない）          |
| 共有パイプライン | 共有 job の状態・滞留                                             |
| 共有レシピ       | レシピ一覧・詳細用の許可列（生 `menu_payload` は API に載せない） |

献立の生 JSON・アレルギー詳細・メールアドレスなどには **権限を付けていません**（共有レシピのプレビューは許可列と title 関数経由の正規化 DTO のみ）。

### うまくいかないとき（DB まわり）

| 症状                                      | よくある原因                                            |
| ----------------------------------------- | ------------------------------------------------------- |
| 起動直後に落ちる / `database_url_invalid` | URL が `postgres` ユーザー、port 6543、sslmode 不足     |
| `permission denied` / 起動 canary 失敗    | ① migration 未適用、または ② LOGIN 化・パスワード忘れ   |
| feedback だけいつも 0 件                  | migration 未適用の古い DB（RLS 用の SELECT 許可が無い） |
| ローカルで TLS エラー                     | 本番向け URL をローカル DB に使っている → 手順 A を使う |

---

## クイックスタート（推奨: Docker）

リポジトリ **ルート**（`admin/` の親）で実行する。

```bash
# 1. 環境ファイル
cp .env.admin.example .env.admin
# エディタで ADMIN_DATABASE_URL 等を設定（下記「環境変数」）
# ⚠ .env.admin は本番 host を指し得る → 起動前に host を目視確認すること

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

| 変数                            | 必須                          | 説明                                                                                                                                                                                |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_DATABASE_URL`            | はい                          | `kondate_ops_readonly` の Postgres URL                                                                                                                                              |
| `ADMIN_PORT`                    | いいえ                        | 既定 `5193`                                                                                                                                                                         |
| `ADMIN_BIND_HOST`               | いいえ                        | 既定 `127.0.0.1`（空/欠落も loopback）。コンテナ内 listen は compose が `0.0.0.0` に上書き。ホスト公開は `127.0.0.1:5193` 固定                                                                 |
| `ADMIN_LOCAL_TOKEN`             | **必須**（health 除く）       | 高エントロピー。未設定だと業務 API はルート未登録 → **404**。設定時は `/api/*` が `Authorization: Bearer …` 必須（`/api/health` は除外可）。Bearer 欠落・不一致は **401** |
| `ADMIN_ALLOW_INSECURE_LOCAL_DB` | ローカルのみ                  | `1` のとき loopback 等 + `sslmode=disable` を許可。本番 URL では使わない                                                                                                            |

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
  - `require`: 暗号化のみ（証明書検証なし）。Session pooler の自己署名連鎖向け
  - `verify-ca` / `verify-full`: 実行時に CA 検証する（pooler では連鎖エラーになり得る）
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

**既定は local DB**（本編 `docker compose` の Postgres + migration）。本番 URL での検証は意図したときだけ。

```bash
# admin パッケージ（ホスト Node 24）
cd admin
npm test
npm run typecheck
npm run lint
npm run format:check

# Docker 経由の例
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm ci
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm test
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm run typecheck
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm run lint

# リポジトリ境界（ports / ignore / format prune）
node --test tests/tooling/admin-compose.test.mjs

# DB ロール（本編スタック + migration 適用後・local）
docker compose --profile test run --rm db-test
# → ops_readonly_role.test.sql（共有レシピ GRANT / DML 不可を含む）
```

---

## トラブルシュート

| 症状                           | 確認                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 起動即 exit                    | `ADMIN_DATABASE_URL` 未設定 / `postgres` ユーザー / port 6543 / sslmode 不正 / ロールが LOGIN 未化         |
| `permission denied`            | migration 未適用、または GRANT 対象外の表を触っていないか                                                  |
| feedback が常に 0 件           | RLS policy `user_feedback_ops_readonly_select` があるか（migration）                                       |
| ブラウザで Host 400            | `http://127.0.0.1:5193` または `http://localhost:5193` で開く                                              |
| API 401                        | `ADMIN_LOCAL_TOKEN` 設定時は UI の token 欄に同じ値を入れる（sessionStorage）                              |
| 業務 API 404                   | `ADMIN_LOCAL_TOKEN` **未設定** → `/api/health` 以外はルート未登録（404）。`.env.admin` に token を設定して再起動 |
| 共有レシピ 401                 | token は設定済みだが Bearer 欠落・不一致。UI の token 欄に `.env.admin` と同じ値を入れる                   |
| compose が `.env.admin` で失敗 | ファイルを作成済みか（`env_file` 必須）                                                                    |
| 意図しない DB を見ている       | 起動前に `ADMIN_DATABASE_URL` の host を目視（本番誤接続防止）                                             |

---

## 関連ドキュメント

| 文書                                                                                                                                          | 内容                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [docs/local-development.md](../docs/local-development.md#運用管理コンソールローカル専用閲覧のみ)                                              | ローカル開発全体の中の短い節               |
| [docs/deployment/supabase.md](../docs/deployment/supabase.md) §6.1                                                                            | 本番での `kondate_ops_readonly` LOGIN 手順 |
| [docs/testing/database-access-matrix.md](../docs/testing/database-access-matrix.md)                                                           | 表権限                                     |
| [docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md](../docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md) | 設計                                       |
| [docs/superpowers/plans/2026-08-11-local-ops-admin-console.md](../docs/superpowers/plans/2026-08-11-local-ops-admin-console.md)               | 実装計画                                   |
