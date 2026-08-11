# ローカル開発環境

## 前提

ホストにはDocker Engine、Docker Compose、POSIXシェルが必要です。Node、npm、Git、Supabase CLI、Postgresクライアント、Playwrightはコンテナ内で実行します。

Compose project名はcheckoutのcanonical絶対pathをSHA-256化した `kondate-<lowercase hex 32桁>` 形式で、containerとvolumeは同名checkoutを含めて分離されます。project名の導出には `sha256sum` が必要で、利用できない場合は破壊操作を始めず停止します。`generate-local-secrets.sh`はこの値を `.env` に保存し、refresh/reset wrapperは欠落時だけmode 600を保ってatomic追加します。コピー元と異なる値がある場合は破壊操作前に停止するため、local secretsを再生成してください。固定portは共有できないため、複数checkoutのstackを同時には起動しないでください。

`COMPOSE_PROJECT_NAME`をdirect入口に設定しないでください。wrapperが絶対pathから導出して明示するproject名を使用します。

## 初回セットアップまたはSupabase構成更新後

ローカルDBとローカル専用認証情報を破棄して再作成します。このローカルDBは破棄可能な開発データだけを保存する前提であり、バックアップは作成されません。

```bash
./scripts/generate-local-secrets.sh --force
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase \
  -c 'sh -eu -c '\''test -f .env; test "$(stat -c %a .env)" = 600; if grep -q "^COMPOSE_FILE=" .env; then exit 1; fi; grep -q "^API_EXTERNAL_URL=http://127.0.0.1:8000/auth/v1$" .env; grep -Eq "^LOCAL_UID=[0-9]+$" .env; grep -Eq "^LOCAL_GID=[0-9]+$" .env; grep -Eq "^KONDATE_COMPOSE_PROJECT_NAME=kondate-[0-9a-f]{32}$" .env'\'''
docker compose pull --quiet --ignore-buildable
docker compose build
./scripts/reset-local-db.sh
```

リセットスクリプトは `down --volumes --remove-orphans` の後、公式Composeがbind mountするPGDATAも削除してから、health待機付きで再起動します。

expected projectの停止後も固定container `supabase-db` が残る場合、wrapperはlegacy/foreign Compose projectとしてPGDATA削除前に拒否します。元のcheckoutとCompose設定から `docker compose --project-name <元project名> down --remove-orphans` を実行し、containerを停止・削除してから再実行してください。PGDATA内に `postmaster.pid` が残る場合も削除を拒否するため、所有するDB processを先に停止してください。

Postgres 17を確認します。

```bash
docker compose exec db psql -U postgres -tAc "show server_version"
docker compose ps --all
```

healthcheckを持つサービスがhealthyで、`migrate` がexit 0であることを確認します。

## Codex から Playwright MCP を使う

Playwright MCP は、Docker 上のヘッドレス Chromium からローカル開発環境だけを操作します。ブラウザー状態はセッション終了時に破棄され、リポジトリやホストのファイルはコンテナへ共有されません。

初回は、`.codex/config.toml` に固定された公式 Playwright MCP イメージの取得が発生することがあります。ローカルスタックを起動してから、Codexを再起動するか新しいセッションを開始してください。

```bash
docker compose up -d --wait
```

利用時はCodexへ、Playwright MCPで `http://127.0.0.1:5173` を確認するよう依頼します。アクセス許可はViteアプリ、Supabase、Mailpit、OAuth mockの既存ローカルオリジンに限定されています。外部Webサイトの調査には使用しないでください。

ただし、`--allowed-origins` は誤操作を減らすためのガードレールであり、外部サイトへのアクセスを完全に防ぐセキュリティ境界ではありません。許可したページから別のページへ移動するリダイレクトも制限されません。また、`--network host` でホストのネットワークへ接続し、`--no-sandbox` でブラウザーの保護機能の一つを無効にして動かします。信頼できるローカルページと、内容を確認した入力・指示だけに使用してください。

## 通常の検証

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/*.test.mjs
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm db-test
docker compose run --rm app npm run db:types
./scripts/run-tooling-git.sh diff --exit-code -- src/shared/types/database.generated.ts
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run typecheck
```

DB型生成は稼働中の公式Postgres Metaサービスを使用します。コンテナ内でPodmanを起動せず、応答を検証してから生成ファイルを原子的に置き換えます。

### E2E スイートの選び方

| 目的 | コマンド |
| --- | --- |
| full（release 相当） | `./scripts/run-e2e.sh` |
| smoke（PR 相当） | `KONDATE_E2E_SUITE=smoke ./scripts/run-e2e.sh` |
| 1 ファイル | `./scripts/run-e2e.sh e2e/specs/foo.spec.ts --project=mobile-chromium` |
| 1 ファイル（`--` 付き慣習） | `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts --project=mobile-chromium`（先頭の裸 `--` は wrapper が捨てる） |

**注意:** PR の smoke は受け入れ E2E 全量の代替ではない。full は push / `ci.sh` / release-checklist。account-deletion 等は full のみ。パスはリポジトリルートからの Playwright 引数（`e2e/specs/...`）で渡す。

#### Playwright 並列（Phase 3 + project 並列）

- `playwright.config.ts` は `workers: 2` と `fullyParallel: true` を固定する（CI で workers を 1 に落とす分岐はない）。
- **full**（`--project` 未指定）は `run-e2e.sh` が `mobile-chromium` と `desktop-chromium` を **同一 wrapper 内で並列**起動する。`setup` は直前に 1 回だけ直列。
- **壁時計の見方:** 非 AI の UI 区間では ≈ **max(mobile, desktop)** に寄せられる。一方、アプリ全体の AI 共有枠は **単一行ロック**（`private.ai_global_daily_usage` の `FOR UPDATE`）のため、生成予約は process を跨いでも直列化し得る。生成密集 file の `test.describe.configure({ mode: "serial" })` は **単一 Playwright process 内**のみ有効で、mobile\|\|desktop の process 間排他にはならない。
- 並列時の成果物は `test-results/{mobile,desktop}-chromium` と `playwright-report/{mobile,desktop}-chromium` に分離する（env: `KONDATE_E2E_OUTPUT_DIR` / `KONDATE_E2E_HTML_REPORT`）。ホストにこれらを export したまま単一 project 実行すると既定パスが上書きされるので、通常は export しない。
- 実効ブラウザ並列は最大 **workers × 2 project**（4）。race・共有 storageState・Realtime signal 系の file も process 内 serial を維持する。
- 短縮の主因は **UI 系**の workers 並列と project 並列。AI 生成区間の短縮は行ロック residual により限定的。

#### AI 日次枠（local compose vs E2E）

| 面 | `GLOBAL_DAILY_AI_LIMIT` | 備考 |
| --- | --- | --- |
| 通常 `compose.yaml`（製品ローカル） | **20** | 製品 preflight / 運用推奨と整合 |
| E2E `compose.e2e.yaml` | **500** | 製品 max 一杯。並列 E2E 用の ENV 上書きのみ。製品契約は変えない |
| suite 開始 | shell が `reset-e2e-ai-quota.sh` で共有枠を truncate（**1 回**） | project 境界の中間 reset はしない（mobile\|\|desktop 並列のため）。test / fixture からの per-test truncate は禁止 |

#### wrapper の起動・終了

E2E wrapperは専用overrideのAuthをhealthyまで待機し、Kong、OAuth mock、appを再作成してからPlaywrightを起動します。同じcheckoutからの**別 wrapper**の並行実行は、共有するone-off、Auth、appを互いに変更しないようDocker起動前に拒否します（directory lock）。1 wrapper 内の mobile\|\|desktop 並列は想定内です。E2E終了後は成功、失敗、signalのいずれでもone-offを即時停止・削除します。**ローカル**では続けて通常構成のAuthとappを復元し、復元に成功した場合はE2Eの終了statusを保持します。**`CI=true`（GHA や `ci.sh`）** では runner が直後に `down --volumes` するため auth/app の force-recreate 復元を省略し壁時計を短縮します。通常のstack定義は変更しません。

開発反復で開始時の force-recreate を飛ばすには、**ローカルのみ**:

```bash
KONDATE_E2E_SKIP_RECREATE=1 ./scripts/run-e2e.sh
```

`KONDATE_E2E_SKIP_RECREATE` は**開発専用**です。rate-limit カウンタや古い app env が残るリスクがあるため、**`CI=true` と同時指定すると `run-e2e.sh` は exit 2** で拒否します。CI や release ゲートでは使わないでください。

SIGKILLでwrapperが終了するとrepository rootの`.run-e2e.lock`にstale lockが残り、次回実行は安全側に停止します。該当checkoutのE2Eプロセスがないことを確認してから、そのlock directoryを手動で削除してください。

## Supabase公式Docker構成の更新

```bash
./scripts/refresh-supabase.sh
```

wrapperはローカルstackを停止してから、vendor更新だけrootで実行し、ローカルDBを破棄してクリーン再起動します。異UIDのruntime dataを含む旧backupを削除し、新vendor成果物は更新処理内で `LOCAL_UID` / `LOCAL_GID` へ戻します。HUP、INT、TERMは実行中の子processへ転送して回収します。処理が中断した場合も、同じwrapperを再実行すれば収束します。

repository内の `./scripts/refresh-supabase.sh` 実体パスから実行してください。portableな実体パス解決を保証できないため、symbolic link経由の起動はサポートしません。

wrapper完了後はPostgresタグの整合性テストを実行してください。PG15データの移行とロールバックはサポートしません。

## 運用管理コンソール（ローカル専用・閲覧のみ）

本番（または staging）Postgres を **SELECT 専用ロール** `kondate_ops_readonly` で読む内部 UI です。本編 `compose.yaml` とは分離し、`compose.admin.yaml` のみで起動します。

### 禁止事項・前提

- **共有 PC では起動しない**（アプリログインなし。Host allowlist + loopback + 推奨 token のみ）。
- `postgres` スーパーユーザ URL では起動しません。必ず `kondate_ops_readonly` の Session pooler URL（port **5432**、`sslmode=require` 等）を使う。
- `.env.admin` にだけ秘密を置く（git 管理外）。`VITE_*` に DB URL を載せない。

### 準備

1. migration `20260811180000_ops_readonly_role.sql` を対象 DB に適用済みであること。
2. ロールを LOGIN 化しパスワードを設定（ローカルは `./scripts/provision-ops-readonly-role.sh`、本番は deploy 文書参照）。
3. 接続 URL 例:
   - direct: `postgresql://kondate_ops_readonly:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require`
   - session pooler: `postgresql://kondate_ops_readonly.[20-char-ref]:[password]@….pooler.supabase.com:5432/postgres?sslmode=require`
4. `.env.admin.example` をコピーして `.env.admin` を作成し `ADMIN_DATABASE_URL` 等を埋める。`ADMIN_LOCAL_TOKEN` 推奨。

### 起動

```bash
cp .env.admin.example .env.admin
# ADMIN_DATABASE_URL を readonly URL で設定
docker compose -f compose.admin.yaml up --build
# ブラウザ: http://127.0.0.1:5193
```

ports は **`127.0.0.1:5193:5193` 固定**（LAN 公開しない）。ビルドのみなら DB URL 無しでも `docker compose -f compose.admin.yaml build` 可能。

### 検証（admin パッケージ内）

```bash
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm test
docker run --rm -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm run build
```
