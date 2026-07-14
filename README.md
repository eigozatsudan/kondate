# こんだて日和

「こんだて日和」は、家族構成、食事の希望、冷蔵庫にある食材をもとに、家庭向けの献立作りを支援するWebアプリケーションです。

このrepositoryにはReactアプリ、Netlify Functions、共有contract、Supabaseのschemaとローカル開発環境が含まれます。

## 技術構成

- React 19 / TypeScript / Vite
- React Router / TanStack Query / React Hook Form / Zod
- Supabase PostgreSQL 17 / Auth / Storage / Realtime
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

主な検証コマンド:

```bash
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm db-test
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

より詳しいセットアップ、検証、Supabase更新、lockやsignalからの復旧は[docs/local-development.md](docs/local-development.md)を参照してください。
