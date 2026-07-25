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

### ローカルでのログイン（Google）

アプリは次の正規オリジンだけを使います。

```text
http://127.0.0.1:5173
```

ログイン画面: [http://127.0.0.1:5173/login](http://127.0.0.1:5173/login)

1. 「Googleで続ける」を押す
2. 表示される **oauth-mock**（「ローカルGoogle認証」）で「Googleテスト利用者で続ける」を選ぶ

ローカルでは本物の Google OAuth は使いません。`VITE_AUTH_PROVIDER_MODE=oauth_mock` のとき、ブラウザは `http://127.0.0.1:8788` の mock に飛び、成功後に認証継続 API（`/api/auth/continuations`）と Supabase セッション確立へ進みます。

#### なぜ `localhost` ではログインできないか

`http://localhost:5173` と `http://127.0.0.1:5173` はブラウザ上で**別オリジン**です。ローカル契約は次のように `127.0.0.1` に固定されています。

| 設定 | 値 |
| --- | --- |
| アプリ / `SERVER_SITE_ORIGIN` / `SITE_URL` | `http://127.0.0.1:5173` |
| oauth-mock の `appOrigin` / exchange CORS | `http://127.0.0.1:5173` のみ |
| Supabase redirect allow list | `http://127.0.0.1:5173/**` |

そのため `localhost` で開くと、認証継続 create が Origin 不一致で失敗したり、callback / CORS が噛み合わず、Google ログインが成立しません。ブックマークやアドレスバーも常に `127.0.0.1` を使ってください。

#### `/api/auth/continuations` が 404 になる場合

通常の `npm run dev`（Compose の `app`）では、`@netlify/vite-plugin` の **middleware 経由**で Netlify Functions を配信します。本番 CSP をローカルに載せないために middleware 全体を切ると、Function も一緒に死に、`POST /api/auth/continuations` が空の 404 になります。CSP だけ落とす現行の `vite.config.ts` を変えず、スタックを `docker compose up -d --wait` で起動した状態で `127.0.0.1` から開いてください。

### ローカルで OpenRouter 実 API を使う（献立を作る）

既定のローカル構成は **openrouter-mock** です。決定論的なモック応答で E2E・単体が安定します。
API キーを設定すると、同じ UI から **本番と同じ OpenRouter 経路**で「献立を作る」を試せます。

#### 1. 鍵とモデルを用意する

1. [OpenRouter](https://openrouter.ai/) で API キーを発行する
2. **`:free` で終わるモデル ID だけ**を使う（有料モデルと `openrouter/auto` は起動時に拒否される）
3. 候補は Models API で確認する（構造化出力 `structured_outputs` + `response_format` 対応が必要）

例（利用可能な free モデルは時期で変わるため、必ず最新を確認すること）:

```text
google/gemma-3-27b-it:free
mistralai/mistral-small-3.2-24b-instruct:free
```

#### 2. `.env` を上書きする

リポジトリ直下の `.env`（`generate-local-secrets.sh` が作る）を編集します。**コミットしないでください。**

```bash
# 実 API（本番相当）
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODELS=google/gemma-3-27b-it:free,mistralai/mistral-small-3.2-24b-instruct:free
```

注意:

- `VITE_OPENROUTER_API_KEY` は使わない（ブラウザへ漏れるため禁止）
- `OPENROUTER_BASE_URL` は末尾スラッシュなしで `https://openrouter.ai/api/v1` と完全一致させる
- `OPENROUTER_MODELS` はカンマ区切り・重複なし・すべて `:free` 終わり
- 既定 mock に戻すときは次のいずれかにする:

```bash
OPENROUTER_API_KEY=local-mock-key
OPENROUTER_BASE_URL=http://openrouter-mock:8787/api/v1
OPENROUTER_MODELS=mock/kondate-primary:free,mock/kondate-repair:free
```

または `./scripts/generate-local-secrets.sh --force` のあと必要な鍵だけ復元する（OpenRouter 3 変数は mock 既定に戻る）。

#### 3. app を作り直して反映する

`.env` は Compose の変数置換経由で `app` に入るため、変更後は **app の再作成**が必要です。

```bash
docker compose up -d --wait --force-recreate app
```

#### 4. モデル設定を確認する（任意・推奨）

```bash
docker compose run --rm --no-deps app npm run verify:openrouter:config
# 実 Models API まで見る場合（ネットワーク必須）
docker compose run --rm --no-deps app npm run verify:openrouter:models
```

#### 5. ブラウザで試す

1. [http://127.0.0.1:5173](http://127.0.0.1:5173) を開く（`localhost` ではない）
2. ログイン → ウィザードで条件を入力 → **献立を作る**
3. 生成中画面のあと結果が表示されれば、実 OpenRouter 経由で動いている

#### 制約（本番と同じ）

| 項目 | 値 |
| --- | --- |
| 成功生成 / 利用者 / JST 日 | 5 |
| 外部 AI 送信 / 利用者 / JST 日 | 12 |
| 外部送信 / 600 秒窓 | 4 |
| 1 試行タイムアウト | 20 秒 |
| Function 総予算 | 50 秒 |

free モデルは提供状況・レート制限が変わります。失敗時はアプリが緊急献立など既存のフォールバックへ誘導します。E2E は **mock のまま**実行してください（実 API だと決定論が崩れ、クォータも消費します）。

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
