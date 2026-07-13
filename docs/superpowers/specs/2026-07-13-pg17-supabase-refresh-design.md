# PG17・Supabase公式Docker構成更新 設計書

## 目的

ローカル開発環境をPostgres 17へ一本化し、`infra/supabase/` を更新時点の最新の公式Supabase Docker構成へ置き換える。プロジェクトは実装序盤であり、既存のローカルDBデータは保持しない。PG15からのインプレースアップグレード、PG15互換構成、ロールバック機構は設けない。

完了後は、公式DB、マイグレーション用クライアント、pgTAPテスト用イメージ、Supabase CLI設定がすべてPG17を前提とし、将来のvendor更新でバージョン不整合を自動検出できる状態にする。

## 採用方針

公式 `supabase/supabase` リポジトリの `master` HEADを更新実行時に一度だけ解決し、その40文字の完全なコミットSHAから `docker/` を取得する。取得したSHAは `infra/supabase.version` に記録する。

常に移動する `master` を実行時に直接参照し続けるのではなく、展開と記録には解決済みSHAを使う。これにより、更新時点の最新構成を採用しながら、取り込んだ内容を再現可能にする。

最新リリースタグ `v1.26.05` の継続利用は採用しない。このタグは現在の公式 `master` のPG17標準構成と最新サービス群を含まないためである。Postgres関連だけの手動更新も、Supabase構成全体を最新化する目的に合わないため採用しない。

## 更新境界

### 公式vendor構成

`scripts/vendor-supabase.sh` は次の責務を持つ。

1. 公式リポジトリの `master` HEADを取得する。
2. 40文字の完全SHAを確定する。
3. SHAで固定した `docker/` を一時ディレクトリへ展開する。
4. 公式Composeの `db` が `supabase/postgres:17.*` を使用していることを検証する。
5. PG15移行・互換専用資産を除外する。
6. すべての検証後に `infra/supabase/` を入れ替える。
7. 完全SHAを `infra/supabase.version` に保存する。

更新時はホストのGitではなく、次のtoolingサービスを入口にする。

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -f compose.tooling.yaml run --rm vendor-supabase --refresh
```

除外対象は次の4ファイルとする。

- `docker-compose.pg15.yml`
- `docker-compose.pg17.yml`
- `utils/upgrade-pg17.sh`
- `tests/test-pg17-upgrade.sh`

公式の `run.sh` はPG以外のCompose override管理にも使用できるため保持する。公式のREADME、CHANGELOG、バージョン履歴もvendorスナップショットの来歴として保持する。

`infra/supabase/` は第三者の公式vendorスナップショットとして原文を保持し、上流由来の英語コメントは翻訳しない。プロジェクト側で新規作成または変更するコードコメントは、リポジトリ規約どおり日本語で記述する。

### プロジェクト固有構成

次の構成を公式ComposeのPostgresイメージへ合わせる。

- `compose.yaml` の `migrate` サービス
- `Dockerfile.db-test` のベースイメージ
- `supabase/config.toml` の `major_version`

vendor更新用には、GitとPOSIXツールだけを含む小さな専用ツールイメージを追加する。シークレット生成とvendor更新は、Supabase本体をincludeしない独立した `compose.tooling.yaml` のサービスとして定義する。これにより、`.env` や `infra/supabase/` がまだ存在しない状態でも実行できるようにする。

`compose.yaml` は更新後も `infra/supabase/docker-compose.yml` と `infra/supabase.override.yaml` をincludeし、アプリ、メール、OAuth/OpenRouterモック、マイグレーション、DBテストなどプロジェクト固有サービスだけを所有する。

`app` サービスには、コンテナ内部からDB型を生成するための `LOCAL_DB_URL` を追加する。ホスト向け `.env` の `127.0.0.1:54322` はコンテナ内では使用せず、`db:5432` を接続先とする。

過去の判断記録である既存の `docs/superpowers/plans/` と `docs/superpowers/specs/` に含まれるPG15表記は変更しない。

## Postgresバージョン管理

Postgresイメージの基準値は、vendor取得した `infra/supabase/docker-compose.yml` の `db` サービスに記載された完全なイメージタグとする。設計時点の公式 `master` では `supabase/postgres:17.6.1.136` だが、実装時には固定した公式コミット内の値を使用する。

公式Compose、ルートの `migrate`、`Dockerfile.db-test` は同一の完全タグを持つ。`supabase/config.toml` はパッチやSupabaseビルド番号を表現できないため、`major_version = 17` とする。

公式ファイルを環境変数化して改変することは避ける。代わりに `tests/tooling/compose.test.mjs` が3箇所の完全タグを抽出し、同一かつ `supabase/postgres:17.*` であることを検証する。vendor更新後に公式タグだけが変わった場合、テストを失敗させてプロジェクト固有構成の明示的なレビューと更新を要求する。

## データと初期化

PG15のデータディレクトリは再利用しない。移行、バックアップ、復元、ロールバック用のスクリプトや手順は追加しない。

切り替え時は、最新の `infra/supabase/.env.example` を基に独立したNodeコンテナでローカル環境変数を再生成してから、Docker volumeを削除してPG17を新規初期化する。シークレット生成時点では `.env` が存在しない可能性があるため、Supabase本体とは独立したtooling用Composeファイルを使用する。

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -f compose.tooling.yaml run --rm local-secrets --force
docker compose down --volumes
docker compose up -d --wait
```

`.env` はGit管理外のローカルファイルであり、変更対象には含めない。DBを破棄する前提のため、`--force` によるJWT、APIキー、ローカル認証情報の再生成を許容する。通常のvolume再作成ではシークレットを再生成せず、既存のPG17用 `.env` を継続利用する。

## コマンド実行環境

ホストに要求する実行環境はDocker Engine、Docker Compose、POSIXシェルとする。Node、npm、Supabase CLI、Git、psql、pgTAP、Playwrightはホストで直接実行しない。

用途ごとの実行先は次のとおりとする。

- シークレット生成: `compose.tooling.yaml` の独立した `node:24-bookworm-slim` サービス
- 公式vendor取得: `compose.tooling.yaml` のGitを含む専用サービス
- JavaScript/TypeScript検証: `app` Composeサービス
- DB操作: 公式 `db`、プロジェクトの `migrate`、`db-test` Composeサービス
- E2E: Chromiumを含む `e2e` Composeサービス

`compose.tooling.yaml` は通常の `docker compose up` から参照されないため、toolingサービスがアプリスタックへ混入しない。vendorスクリプトはコンテナ内で `/workspace` にマウントされたリポジトリだけを書き換える。tooling実行時にホストのUID/GIDを渡し、生成物がrootまたは別ユーザー所有になることを防ぐ。シークレット生成処理は受け取ったUID/GIDを `.env` の `LOCAL_UID` と `LOCAL_GID` に保存し、以後の `app`、`e2e`、DB型生成も同じ所有者で実行する。tooling用Compose自身の構文は `.env` なしで解決できることをテストする。

日常の検証コマンドは、ホストのnpmスクリプトを入口にせず、次のDocker Compose形式へ統一する。

```bash
docker compose run --rm --no-deps app node --test tests/tooling/*.test.mjs
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm db-test
docker compose run --rm app npm run db:types
docker compose --profile e2e run --rm e2e
```

`app` の依存サービスを必要としない静的検証には `--no-deps` を指定する。DB型生成は実行中の `db` と `migrate` を必要とするため `--no-deps` を指定しない。E2Eは専用プロファイルを明示して、通常起動へブラウザイメージを混入させない。

## 失敗時の扱い

vendor更新は `infra/` と同じファイルシステム上の一時ディレクトリ内で取得、展開、PG17検証、除外を完了してから既存の `infra/supabase/` を置き換える。置換時だけ旧ディレクトリを一時名へ退避し、新ディレクトリとバージョンファイルの配置が完了したら即座に削除する。置換途中に失敗した場合はtrapで旧ディレクトリと旧バージョンファイルを元の位置へ戻し、一時資産を削除する。これはvendor更新を中途半端な状態にしないためのトランザクション処理であり、PG15データや実行環境のロールバック機構ではない。

次のいずれかが失敗した場合は異常終了し、現在のvendor構成と `infra/supabase.version` を変更しない。

- ネットワークアクセスまたはGit fetch
- `master` HEADの完全SHA取得
- `docker/` アーカイブの展開
- 公式Composeまたは `db` サービスの検出
- Postgres 17イメージタグの検証

PG15への復帰処理やバックアップディレクトリは作成しない。PG17でのクリーン初期化に失敗した場合は、原因を修正して `docker compose down --volumes` と `docker compose up -d --wait` を再実行する。

## テスト設計

### 静的整合性

Nodeのtoolingテストで次を検証する。

- `infra/supabase.version` が40文字の16進SHAである。
- PG15移行・互換専用の4ファイルが存在しない。
- 公式DB、`migrate`、`db-test` の完全なイメージタグが一致する。
- 一致したタグが `supabase/postgres:17.*` である。
- `supabase/config.toml` が `major_version = 17` である。
- `.env` がなくても `docker compose -f compose.tooling.yaml config` が成功する。

生成済み `.env` を使い、`docker compose config` が未解決変数や構文エラーなしで成功することも確認する。toolingテスト自体は `app` コンテナで実行する。

### DB初期化とデータベーステスト

クリーンなDocker volumeに対して `docker compose down --volumes` と `docker compose up -d --wait` を実行し、次を確認する。

- 全サービスが起動条件を満たす。
- `SHOW server_version` が17系を返す。
- すべてのプロジェクトマイグレーションが適用される。
- `pgcrypto` と `pgtap` が利用できる。
- `docker compose run --rm db-test` ですべてのpgTAPテストが成功する。
- `docker compose run --rm app npm run db:types` が内部DB接続URLを使ってPG17環境から型を生成できる。

### アプリ統合

公式サービス更新による影響を検出するため、次を実行する。

- Auth、REST、Realtime、Storage、Studio、Supavisorのhealth確認
- `docker compose run --rm --no-deps app npx vitest run`
- `docker compose --profile e2e run --rm e2e`
- `docker compose run --rm --no-deps app npm run build`
- `docker compose run --rm --no-deps app npm run lint`
- `docker compose run --rm --no-deps app npm run format:check`

既存E2Eに含まれるOAuthモックとメール認証フローを、Authサービス更新後の主要な回帰確認として使用する。

## ドキュメント

開発者向け文書には、Dockerコンテナによる初回切り替え時の `.env` 再生成とvolume再作成、PG17確認方法、Docker Compose経由の通常検証コマンドを記載する。PG15からのアップグレード、データ保持、ロールバックはサポート対象として記載しない。

## 完了条件

- 最新の公式Supabase Docker構成が完全SHAでvendor固定されている。
- ローカルスタック、マイグレーション、DBテスト、Supabase CLIがPG17へ統一されている。
- PG15移行・互換専用資産がプロジェクトから除外されている。
- クリーンなPG17環境ですべてのDBテスト、アプリテスト、E2E、ビルド、静的検査が成功する。
- 将来のvendor更新でPostgresタグの不整合をtoolingテストが検出する。
