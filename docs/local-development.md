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

E2E wrapperは専用overrideのAuthをhealthyまで待機し、Kong、OAuth mock、appを再作成してからPlaywrightを起動します。同じcheckoutからの並行実行は、共有するone-off、Auth、appを互いに変更しないようDocker起動前に拒否します。E2E終了後は成功、失敗、signalのいずれでもone-offを即時停止・削除してから通常構成のAuthとappを復元し、復元に成功した場合はE2Eの終了statusを保持します。通常のstack定義は変更しません。

SIGKILLでwrapperが終了すると`${TMPDIR:-/tmp}/kondate-run-e2e-<project-name>.lock`にstale lockが残り、次回実行は安全側に停止します。該当checkoutのE2Eプロセスがないことを確認してから、そのlock directoryを手動で削除してください。

## Supabase公式Docker構成の更新

```bash
./scripts/refresh-supabase.sh
```

wrapperはローカルstackを停止してから、vendor更新だけrootで実行し、ローカルDBを破棄してクリーン再起動します。異UIDのruntime dataを含む旧backupを削除し、新vendor成果物は更新処理内で `LOCAL_UID` / `LOCAL_GID` へ戻します。HUP、INT、TERMは実行中の子processへ転送して回収します。処理が中断した場合も、同じwrapperを再実行すれば収束します。

repository内の `./scripts/refresh-supabase.sh` 実体パスから実行してください。portableな実体パス解決を保証できないため、symbolic link経由の起動はサポートしません。

wrapper完了後はPostgresタグの整合性テストを実行してください。PG15データの移行とロールバックはサポートしません。
