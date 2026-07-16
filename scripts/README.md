# scripts/

ローカル開発・CI で使うシェル/Node スクリプト集です。ほとんどのスクリプトは
Docker Compose 経由での実行を前提としており、直接ホストで実行するものと、
Compose サービスの `entrypoint` として実行されるものが混在しています。

より広いローカル開発フロー（初回セットアップ手順、`.env` の扱い、Compose
プロジェクト名の分離方針など）は [`docs/local-development.md`](../docs/local-development.md)
を参照してください。このREADMEは各スクリプト単体の役割と使い方に絞ります。

## 呼び出し経路の早見表

| スクリプト                      | 主な呼び出し元                                                       |
| ------------------------------- | -------------------------------------------------------------------- |
| `apply-migrations.sh`           | `compose.yaml` の `migrate` サービス entrypoint（`npm run db:push`） |
| `compose-project-name.sh`       | 他の多くのスクリプトから内部的に呼び出される                         |
| `ensure-compose-project-env.sh` | 他の多くのスクリプトから内部的に呼び出される                         |
| `generate-database-types.sh`    | `npm run db:types`                                                   |
| `generate-local-secrets.mjs`    | `generate-local-secrets.sh` から Compose 経由で実行される            |
| `generate-local-secrets.sh`     | 直接実行（初回セットアップ、`--force` でローテーション）             |
| `refresh-supabase.sh`           | 直接実行（Supabase 取り込み内容の更新）                              |
| `reset-local-db.sh`             | `npm run db:reset`                                                   |
| `run-e2e.sh`                    | 直接実行、`AGENTS.md` の検証手順                                     |
| `run-pgtap.sh`                  | `compose.yaml` の `db-test` サービス entrypoint（`npm run db:test`） |
| `run-tooling-git.sh`            | 直接実行（生成物のコミット等、コンテナ内gitが必要な場面）            |
| `vendor-supabase.sh`            | `compose.tooling.yaml` の `vendor-supabase` サービス entrypoint      |
| `wait-for-supabase.sh`          | Compose のヘルスチェック待ちが必要な場面で利用                       |

## 各スクリプトの詳細

### `apply-migrations.sh`

`/workspace/supabase/migrations/*.sql` を、まだ適用されていないものだけ順番に
`DATABASE_URL` のデータベースへ適用します。適用履歴は
`supabase_migrations.schema_migrations` テーブルで管理し、1ファイルにつき
1トランザクションでSQL本体と履歴INSERTをまとめて実行します。

- 必須環境変数: `DATABASE_URL`
- 単体では通常呼び出さず、`npm run db:push`（Compose の `migrate` サービス）
  経由で実行します。

### `compose-project-name.sh`

絶対パスのリポジトリルートから、決定的な Docker Compose プロジェクト名
（`kondate-<32桁hex>`）を導出して標準出力に書き出します。同じチェックアウトの
実体パスからは常に同じ名前になり、複数チェックアウト（worktree 等）が
同時に存在してもコンテナ名・ボリューム名が衝突しません。

```sh
./scripts/compose-project-name.sh /absolute/path/to/repo
```

他の多くのスクリプトが内部で呼び出す共通ヘルパーで、単体で直接使うことは
ほとんどありません。

### `ensure-compose-project-env.sh`

`.env` に `KONDATE_COMPOSE_PROJECT_NAME` を記録・検証します。未記入なら
`compose-project-name.sh` が導出した値をアトミックに追記し、記入済みなら
一致するか確認します。一致しない場合は「別チェックアウトの `.env` を誤って
使っている」可能性があるため、破壊的な操作を実行する前に停止します。

```sh
./scripts/ensure-compose-project-env.sh /absolute/path/to/repo kondate-<32桁hex>
```

`refresh-supabase.sh` / `reset-local-db.sh` / `run-e2e.sh` などから内部的に
呼び出される共通ヘルパーです。

### `generate-database-types.sh`

稼働中の Postgres Meta サービスからスキーマ情報を取得し、TypeScript の
型定義として `src/shared/types/database.generated.ts` を生成します。
取得結果は実際にTypeScriptとしてパースし、期待する `Json` / `Database` 型が
エクスポートされていることまで確認してから書き込みます。

```sh
npm run db:types
# 内部的には: bash scripts/generate-database-types.sh
```

Compose スタック（特に `meta` サービス）が起動している必要があります。
`PG_META_TYPES_URL` で取得先を上書きできます。

### `generate-local-secrets.mjs`

ローカル開発用の `.env` を生成する Node スクリプト本体です。
`infra/supabase/.env.example` をベースに、パスワード・JWT・APIキーなどの
ローカル専用シークレットを都度ランダム生成して埋め込みます。既存の `.env`
は `--force` を渡さない限り上書きしません。書き込みは一時ファイル経由で
アトミックに行われます。

ホストの Node から直接実行する想定ではなく、`generate-local-secrets.sh`
経由でコンテナ内 Node から実行してください。

### `generate-local-secrets.sh`

`generate-local-secrets.mjs` を、tooling 用 Compose の `local-secrets`
サービス（コンテナ内 Node）経由で実行する薄いラッパーです。ホスト側に
Node のインストールを要求せずに済みます。

```sh
./scripts/generate-local-secrets.sh          # 初回のみ、.env が既に存在すると失敗する
./scripts/generate-local-secrets.sh --force  # 既存の .env を上書きしてローテーション
```

### `refresh-supabase.sh`

Compose スタックを停止し、`vendor-supabase.sh --refresh` でベンダー取り込み
済みの Supabase ソース（`infra/supabase`）を最新化してから、
`reset-local-db.sh` でローカル DB を作り直す一連の手順をまとめて実行します。

```sh
./scripts/refresh-supabase.sh
```

`reset-local-db.sh` と同様、ローカル DB のデータを破棄します。シンボリック
リンク経由の起動はサポートしていないため、リポジトリ内の実体パスから
実行してください。

### `reset-local-db.sh`

ローカルの Supabase/Postgres を完全に作り直します。Compose スタックを
ボリュームごと停止し、他プロジェクトの DB コンテナが残っていないことを
確認したうえで PGDATA の bind mount を削除し、スタックを再起動します。

```sh
npm run db:reset
# 内部的には: ./scripts/reset-local-db.sh
```

**ローカル DB のデータを破棄します。** 開発用の破棄可能なデータだけを
保存してください。

### `run-e2e.sh`

E2E テスト用 Compose プロファイルを起動し、Playwright コンテナ（`e2e`）を
実行して、成功・失敗・中断のいずれの経路でも必ず E2E 専用コンテナを片付け、
通常の開発スタック（`auth`/`app`）を元の状態に復元するラッパーです。

```sh
./scripts/run-e2e.sh                              # 全E2Eテスト
./scripts/run-e2e.sh e2e/specs/foundation.spec.ts  # 特定specのみ（Playwrightの引数をそのまま転送）
```

多重起動防止のディレクトリロック（`.run-e2e.lock`）と、中断時の
シグナル転送・強制killロジックを持つため内部実装はやや複雑です。読む際は
「`run_child` = 子プロセスの起動とシグナル/終了待ち」「`cleanup` = E2E
コンテナの後始末」「`finish` = ロック解放と最終exit」の3層構造として
捉えてください。`KONDATE_E2E_SIGNAL_GRACE_SECONDS`（既定5秒）で、シグナル
受信後に子プロセスの自然終了を待つ猶予秒数を調整できます。

### `run-pgtap.sh`

`pg_prove` 経由で pgTAP データベーステストを実行します。引数を渡さなければ
`supabase/tests/database` 配下の `*.test.sql` を全て実行し、引数を渡せば
それらのファイルだけを対象にします。

- 必須環境変数: `DATABASE_URL`
- 単体では通常呼び出さず、`npm run db:test`（Compose の `db-test` サービス）
  経由で実行します。

### `run-tooling-git.sh`

ホストの git をコンテナ内では使わず、`vendor-supabase` ツーリングイメージに
積まれた git を Compose コンテナ経由で実行する薄いラッパーです。カレントの
リポジトリが linked worktree の場合、`.git` gitfile が指す common dir を
コンテナ内にも同じ絶対パスでマウントし、worktree 特有の git 操作
（`commondir` を参照するもの等）が動くようにします。

```sh
./scripts/run-tooling-git.sh add scripts/vendor-supabase.sh
./scripts/run-tooling-git.sh commit -m "chore: ..."
./scripts/run-tooling-git.sh diff --exit-code -- src/shared/types/database.generated.ts
```

生成物（`database.generated.ts` 等）をコンテナ内 git で扱う必要がある場面
で使います。

### `vendor-supabase.sh`

公式 [supabase/supabase](https://github.com/supabase/supabase) リポジトリの
`docker/` ディレクトリを `infra/supabase` にベンダリング（取り込み）します。
`infra/supabase` が既に存在する場合は `--refresh` を渡さない限り失敗します
（誤って上書きしないため）。

```sh
docker compose -f compose.tooling.yaml run --rm --user 0:0 vendor-supabase           # 初回取り込み
docker compose -f compose.tooling.yaml run --rm --user 0:0 vendor-supabase --refresh # 更新
```

通常は直接呼ばず、`refresh-supabase.sh` から `--refresh` 付きで呼び出されます。

処理はステージング領域に一旦全て準備してから、既存の `infra/supabase` ・
`infra/supabase.version` を退避しつつ新しい内容を設置します。途中で失敗した
場合は退避物から元の状態へのロールバックを試み、それでも安全に戻せない
場合はステージングを残してエラーメッセージで手動対応を促します。
`SUPABASE_REPOSITORY` / `SUPABASE_REF` で取り込み元リポジトリ/refを
上書きできます。

### `wait-for-supabase.sh`

指定したヘルスチェックURL（既定は Kong 経由の auth ヘルスエンドポイント）に
1秒間隔で最大60回ポーリングし、Supabase スタックの起動完了を待ちます。

```sh
./scripts/wait-for-supabase.sh                          # 既定URLを使う
./scripts/wait-for-supabase.sh http://kong:8000/health   # URLを指定する
```

Compose のヘルスチェック（`healthcheck`/`depends_on`）だけでは待ちきれない
場面や、CI・スクリプトから明示的に起動完了を待ちたい場面で利用します。
