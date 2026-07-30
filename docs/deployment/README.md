# 本番デプロイ手順（CLI 初回〜更新）

アカウントを作った直後から、Docker Compose 上の **Netlify CLI** / **Supabase CLI** で
初回デプロイし、その後の更新を繰り返すまでのオペレータ向け手順です。

| 文書 | 役割 |
| --- | --- |
| **この README** | アカウント作成 → 初回デプロイ → 日常更新の手順書 |
| [supabase.md](./supabase.md) | Managed プロジェクト、マイグレーション、メンテナンス LOGIN、秘密の扱い |
| [netlify.md](./netlify.md) | ブラウザ/サーバ env 境界、CSP、preflight、保護リリース runner |
| [../testing/release-checklist.md](../testing/release-checklist.md) | リリースゲート（候補 SHA・検証コマンド） |
| [../runbooks/openrouter.md](../runbooks/openrouter.md) | 有料 OpenRouter allowlist |
| [../runbooks/billing-reconcile.md](../runbooks/billing-reconcile.md) | Stripe / Plus 運用 |

**このリポジトリのエージェント（AI）は本番・ステージングへデプロイしません。**
手順の実行主体は人間オペレータ（または承認済みの保護リリース runner）です。

秘密（パスワード、service role、PAT、DB URL、HMAC 鍵）をコマンド履歴・チケット・
チャット・git・ビルドログに残さないでください。

---

## 0. 前提

### ホスト

- Docker Engine と Docker Compose（v2 系。本リポジトリは Compose v5 でも検証）
- リポジトリのチェックアウトと、ローカル用 `.env`（`./scripts/generate-local-secrets.sh`）
- インターネット到達性（Netlify / Supabase / OpenRouter の API）

ホストへ Node / `netlify-cli` / `supabase` をグローバルインストールする必要は **ありません**。
CLI は `compose.yaml` の **profile `deploy`** サービスが、`package.json` にピン留めされた版を使います。

| Compose サービス | CLI | ピン |
| --- | --- | --- |
| `netlify-cli` | `npx netlify` | `netlify-cli@26.2.0` |
| `supabase-cli` | `npx supabase` | `supabase`（`package.json` の範囲） |

### よく使う起動形

profile 付き・一発実行（コンテナは終了後に削除）:

```bash
# リポジトリルートで。KONDATE_COMPOSE_PROJECT_NAME は .env に必要。
docker compose --profile deploy run --rm netlify-cli --help
docker compose --profile deploy run --rm supabase-cli --help
```

対話（ブラウザ login やパスワード入力）が必要なときだけ `-it` を付ける:

```bash
docker compose --profile deploy run --rm -it netlify-cli login
docker compose --profile deploy run --rm -it supabase-cli login
```

初回は依存イメージと `node_modules` ボリュームが要るため、未ビルドなら:

```bash
docker compose build app
# または通常スタック起動（node_modules が埋まる）
docker compose up -d --wait
```

### 認証トークン（推奨: 対話 login より PAT）

| 変数 | 取得場所 | 用途 |
| --- | --- | --- |
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → Personal access tokens | CLI 認証 |
| `NETLIFY_SITE_ID` | サイト Overview → Site ID（または `sites:list`） | サイト指定 |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens | CLI 認証 |
| `SUPABASE_DB_PASSWORD` | プロジェクト作成時の DB パスワード | `link` / 一部 DB 操作 |
| `SUPABASE_PROJECT_ID` | プロジェクト Settings → General の **Reference ID**（20 文字） | `link` 等 |

シェルに export するか、**git 管理外**の `.env` にだけ書いて Compose に渡します。
本番サイトの **Functions 用秘密**（service role 等）を、CLI 用 PAT と混同しないこと。

```bash
export NETLIFY_AUTH_TOKEN='...'          # 履歴に残さない入力方法を使う
export SUPABASE_ACCESS_TOKEN='...'
# 以降の docker compose --profile deploy run が読み取る
```

---

## 1. アカウント作成直後（ダッシュボード）

CLI だけでは完結しない準備です。アカウントを作った直後に実施します。

### 1.1 Supabase

1. [Supabase Dashboard](https://supabase.com/dashboard) で組織・プロジェクトを作成する。
2. リージョンを選び、**Database password** を生成してシークレットマネージャへ保存する（再表示できない想定で扱う）。
3. **Settings → API** から次を記録する（値は印刷・コミットしない）:
   - Project URL（`https://<20文字ref>.supabase.co` のみ。カスタム REST origin は不可）
   - `anon` / publishable key
   - `service_role` key
4. **Settings → General** の Reference ID（20 文字）を `SUPABASE_PROJECT_ID` として控える。
5. Auth / コールバック / Google プロバイダは [supabase.md](./supabase.md) の「Auth サイト URL とコールバック」に従う。
   - Site URL は **後で決まる Netlify 本番 origin** に合わせる（仮 URL のままだとマジックリンクがずれる）。
   - ローカル開発用 `http://127.0.0.1:5173/auth/callback` は許可リストに残してよい。

### 1.2 Netlify

1. [Netlify](https://app.netlify.com/) でチームに参加し、空のサイトを 1 つ作る  
   （CLI の `sites:create` でも可。次節）。
2. サイトの **HTTPS origin**（例: `https://<subdomain>.netlify.app` またはカスタムドメイン）を確定する。
3. User settings で **Personal access token** を発行し、`NETLIFY_AUTH_TOKEN` とする。
4. サイトの **Site ID** を `NETLIFY_SITE_ID` とする。
5. リポジトリ連携（Git 継続デプロイ）を使う場合も、**秘密は Netlify UI の env にだけ**置き、`netlify.toml` や git に書かない。

### 1.3 外部サービス（初回に揃える）

| サービス | 必要なもの |
| --- | --- |
| OpenRouter | API キーと、有料 allowlist モデル ID（`:free` 禁止。正本: [openrouter.md](../runbooks/openrouter.md)） |
| Google OAuth（本番 Auth） | 承認済みリダイレクト URI に Supabase コールバック |
| Stripe（Plus を有効にする場合） | `sk_` / `whsec_` / Price ID。kill スイッチは `BILLING_ENABLED`（[netlify.md](./netlify.md)） |

---

## 2. Compose 上の CLI ラッパ

`compose.yaml` の profile **`deploy`** だけが対象です。通常の `docker compose up` には含まれません（`test` / `e2e` と同様）。

```bash
# 動作確認
docker compose --profile deploy run --rm netlify-cli --version
docker compose --profile deploy run --rm supabase-cli --version

# 以降、README では次のエイリアス相当で書く
#   netlify  → docker compose --profile deploy run --rm netlify-cli
#   supabase → docker compose --profile deploy run --rm supabase-cli
```

引数はサービス名の後ろにそのまま渡せます（entrypoint が `npx netlify` / `npx supabase` のあとへ連結）。

```bash
docker compose --profile deploy run --rm netlify-cli status
docker compose --profile deploy run --rm supabase-cli projects list
```

---

## 3. 初回: Supabase（スキーマ投入）

詳細・メンテナンス LOGIN・型ドリフトは [supabase.md](./supabase.md) が正本です。ここでは CLI の最短列だけ示します。

### 3.1 ログインとプロジェクト紐付け

```bash
export SUPABASE_ACCESS_TOKEN='...'   # または -it login
export SUPABASE_DB_PASSWORD='...'    # プロジェクト DB パスワード
export SUPABASE_PROJECT_ID='xxxxxxxxxxxxxxxxxxxx'  # 20 文字 ref

docker compose --profile deploy run --rm supabase-cli projects list

docker compose --profile deploy run --rm -it supabase-cli link \
  --project-ref "$SUPABASE_PROJECT_ID"
```

`link` は作業ツリー側にローカル state を書きます（コミットしない）。

### 3.2 マイグレーション適用

クリーンなタグ付きコミット上で、**管理者用 DB URL** をシークレットマネージャから一時的にだけ注入する:

```bash
# SUPABASE_DB_URL は履歴に残さない。例の文字列をコピペ運用しない。
# 形式は Dashboard の接続文字列（直接または Session プール）に従う。
docker compose --profile deploy run --rm supabase-cli db push \
  --db-url "$SUPABASE_DB_URL" \
  --include-all
```

- マイグレーションは前方のみ。失敗したら新しいマイグレーションで直す（`db reset` や破壊的巻き戻しは本番で使わない）。
- 適用順・Plan 7 / アカウント削除 / メンテナンス migration の確認は [supabase.md](./supabase.md) §3。
- マイグレーション外の **メンテナンス LOGIN**（`kondate_maintenance_login`）は同 §4。  
  `SUPABASE_MAINTENANCE_DB_URL` は Netlify Functions スコープだけに入れる（同 §5–6）。

### 3.3 Auth を Netlify origin に合わせる

Netlify の本番 origin が決まったら、Supabase Auth の Site URL と Redirect URLs を更新する:

- Site URL: `https://<production-host>`
- Redirect: `https://<production-host>/auth/callback`
- ローカル: `http://127.0.0.1:5173/auth/callback`（開発継続用）

---

## 4. 初回: Netlify（サイト作成・env・デプロイ）

env の完全表と禁止事項は [netlify.md](./netlify.md) が正本です。

### 4.1 ログインとサイト

```bash
export NETLIFY_AUTH_TOKEN='...'

docker compose --profile deploy run --rm netlify-cli status
docker compose --profile deploy run --rm netlify-cli sites:list

# 未作成なら（対話）
docker compose --profile deploy run --rm -it netlify-cli sites:create

export NETLIFY_SITE_ID='...'   # 作成結果または Dashboard の Site ID

# 作業ツリーをサイトに紐付け（.netlify/ は gitignored）
docker compose --profile deploy run --rm netlify-cli link --id "$NETLIFY_SITE_ID"
```

### 4.2 環境変数を入れる（UI または CLI）

**ブラウザに出してよいもの（Build に渡す）** と **Functions のみ** を分けます。

| 区分 | 例 | 置き場 |
| --- | --- | --- |
| ブラウザ安全 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_AUTH_PROVIDER_MODE=supabase`, TTL 系 | Builds + 必要なら Functions |
| サーバ専用 | `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_*`, HMAC, `SUPABASE_MAINTENANCE_DB_URL`, Stripe | **Functions のみ**（Builds / ログ / `VITE_` 禁止） |

最低限そろえる対応関係:

| Netlify 変数 | 値の出所 |
| --- | --- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | 同一の `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | 同一 publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role（Functions のみ） |
| `SERVER_SITE_ORIGIN` | 正確な Netlify HTTPS origin（末尾スラッシュなし） |
| `VITE_AUTH_PROVIDER_MODE` | `supabase` のみ（本番） |
| 枠・予算系 | `USER_DAILY_AI_LIMIT=3` など [netlify.md](./netlify.md) の固定値 |
| OpenRouter | 有料 allowlist + `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` |

CLI で 1 件入れる例（値はシェルから。echo しない）:

```bash
# スコープは運用ポリシーに合わせる（build / functions / post-processing 等）
docker compose --profile deploy run --rm -it netlify-cli env:set VITE_AUTH_PROVIDER_MODE supabase
```

大量の秘密は Dashboard の UI または保護されたシークレット注入の方が事故が少ないです。  
**禁止の再掲**: `VITE_OAUTH_MOCK_ORIGIN`、あらゆる `VITE_*` サーバ秘密、ローカル mock の OpenRouter base、サンプル HMAC。

### 4.3 初回デプロイ

本番ビルドは `netlify.toml` の production context が
`verify:openrouter:models` と `verify:sharp:netlify` を含みます。  
OpenRouter の env が揃っていないと production ビルドは失敗します。

```bash
# ドラフト（本番公開しない）。ビルドは Netlify 側または --build
docker compose --profile deploy run --rm netlify-cli deploy --build

# 内容を確認したうえで本番公開
docker compose --profile deploy run --rm netlify-cli deploy --build --prod
```

Git 継続デプロイを主にする場合:

1. GitHub 等へリポジトリを接続する。
2. production branch を決める。
3. 上記 env を UI に入れたうえで push / 「Clear cache and deploy」。
4. CLI は status / env / 手動 promote の補助に使う。

### 4.4 デプロイ後の最小確認

保護 runner があるなら [netlify.md](./netlify.md) の preflight / `verify:production-deploy` / `smoke:production` を正とする。  
手元の最小確認（秘密を印刷しない）:

1. 本番 origin が HTTPS で開き、SPA がロードされる。
2. マジックリンクまたは Google で Auth コールバックが完了する。
3. Functions が 5xx の嵐にならない（例: `/api/` 配下の公開ヘルス相当があれば）。
4. Netlify の Function ログに PII・プロンプト・生 AI 出力が出ていない。

---

## 5. 更新手順（日常・リリース）

### 5.1 アプリ（フロント + Functions）だけ更新

スキーマ変更なし:

```bash
export CANDIDATE_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"

# ローカル候補ゲート（要約）。完全版は release-checklist
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run build

# デプロイ（CLI 直 or Git 連携の production デプロイ）
docker compose --profile deploy run --rm netlify-cli deploy --build --prod
```

env だけ変えた場合も、Functions が新しい値を読むには **再デプロイまたは env 反映後の deploy** が必要です（特に `GLOBAL_DAILY_AI_LIMIT` 等）。

### 5.2 DB マイグレーションを含む更新

1. 候補コミットでローカル `db:test` 等を通す（[release-checklist](../testing/release-checklist.md)）。
2. **本番トラフィック前**にマイグレーションを適用する:

```bash
docker compose --profile deploy run --rm supabase-cli db push \
  --db-url "$SUPABASE_DB_URL" \
  --include-all
```

3. 続けて Netlify をデプロイする（古いフロントが新スキーマ前提 API を叩かない順を守る）。
4. メンテナンス LOGIN や `SUPABASE_MAINTENANCE_DB_URL` を変えた場合は [supabase.md](./supabase.md) / [netlify.md](./netlify.md) のローテーション手順。

ロールバック:

- **フロント/Functions**: Netlify の直前デプロイへ publish を戻す。
- **DB**: 破壊的 reverse はしない。前方修正マイグレーションで直す。

### 5.3 推奨リリース順（要約）

```text
1. 候補 SHA を固定（clean worktree）
2. ローカル / CI ゲート（format・lint・typecheck・vitest・pgTAP・e2e・build）
3. Supabase: 未適用 migration を db push（必要時のみ）
4. 保護 runner: preflight:production（サーバ秘密はビルドに載せない）
5. Netlify: production デプロイ
6. verify:production-deploy → smoke:production → verify:production-deploy
7. 証跡は保護システムのみ（git に origin / secret / 生ログを書かない）
```

---

## 6. トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| `KONDATE_COMPOSE_PROJECT_NAME is required` | `.env` を `./scripts/generate-local-secrets.sh` で用意する |
| `netlify` / `supabase` が not found | `docker compose build app` と `node_modules` ボリューム。`npm ci` 済みの development イメージを使う |
| Netlify 認証エラー | `NETLIFY_AUTH_TOKEN` の有効期限・スコープ。`status` で確認 |
| Supabase 認証エラー | `SUPABASE_ACCESS_TOKEN`。組織の権限 |
| `db push` 失敗 | DB パスワード、ネットワーク、既適用 checksum との食い違い（手編集 migration 禁止） |
| production ビルドで OpenRouter 検証失敗 | 有料 allowlist・`OPENROUTER_API_KEY`・`OPENROUTER_BASE_URL` が production env にあるか |
| sharp / flyer ビルド失敗 | `npm run verify:sharp:netlify`（lock に linux-x64）。[netlify.md](./netlify.md) |
| Auth コールバック失敗 | Supabase Redirect URLs と `SERVER_SITE_ORIGIN` / 実 origin の一致 |
| CSP で Supabase が弾かれる | `VITE_SUPABASE_URL` の exact origin。ref 変更時は URL 系を同時更新 |

---

## 7. セキュリティチェックリスト（毎回）

- [ ] PAT / DB URL / service role を git・screenshot・チケットに載せていない
- [ ] 本番に `VITE_OAUTH_MOCK_ORIGIN` や mock OpenRouter base が無い
- [ ] `VITE_` 付きでサーバ秘密を付けていない
- [ ] `GENERATION_REQUEST_HMAC_KEY` と `QUOTA_IDENTITY_HMAC_KEY` は別鍵
- [ ] `SUPABASE_MAINTENANCE_DB_URL` は Functions のみ・least-privilege LOGIN
- [ ] ログにメール・アレルギー・プロンプト・生 AI 出力が無い

---

## 8. 関連コマンド早見

```bash
# CLI ヘルプ / 版
docker compose --profile deploy run --rm netlify-cli --version
docker compose --profile deploy run --rm supabase-cli --version

# Netlify
docker compose --profile deploy run --rm netlify-cli status
docker compose --profile deploy run --rm netlify-cli sites:list
docker compose --profile deploy run --rm netlify-cli env:list
docker compose --profile deploy run --rm netlify-cli deploy --build
docker compose --profile deploy run --rm netlify-cli deploy --build --prod

# Supabase
docker compose --profile deploy run --rm supabase-cli projects list
docker compose --profile deploy run --rm -it supabase-cli link --project-ref "$SUPABASE_PROJECT_ID"
docker compose --profile deploy run --rm supabase-cli db push --db-url "$SUPABASE_DB_URL" --include-all
docker compose --profile deploy run --rm supabase-cli migration list
```

環境変数・枠・CSP・保護 runner の数値と禁止事項は、必ず [netlify.md](./netlify.md) と [supabase.md](./supabase.md) を再確認してください。本 README は手順の骨格であり、ロック値の正本ではありません。
