# ローカル開発環境

## 前提

ホストにはDocker Engine、Docker Compose、POSIXシェルが必要です。Node、npm、Git、Supabase CLI、Postgresクライアント、Playwrightはコンテナ内で実行します。

## 初回セットアップまたはSupabase構成更新後

ローカルDBとローカル専用認証情報を破棄して再作成します。このローカルDBは破棄可能な開発データだけを保存する前提であり、バックアップは作成されません。

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -f compose.tooling.yaml run --rm local-secrets --force
./scripts/reset-local-db.sh
```

リセットスクリプトは `down --volumes --remove-orphans` の後、公式Composeがbind mountするPGDATAも削除してから、health待機付きで再起動します。

Postgres 17を確認します。

```bash
docker compose exec db psql -U postgres -tAc "show server_version"
```

## 通常の検証

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/*.test.mjs
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm db-test
docker compose run --rm app npm run db:types
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run typecheck
```

## Supabase公式Docker構成の更新

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -f compose.tooling.yaml run --rm --user 0:0 vendor-supabase --refresh
```

実更新だけrootへoverrideして異UIDのruntime dataを含む旧backupを削除し、新vendor成果物はスクリプト内で `LOCAL_UID` / `LOCAL_GID` へ戻します。

更新後はPostgresタグの整合性テストを実行し、ローカル環境を再作成してください。PG15データの移行とロールバックはサポートしません。
