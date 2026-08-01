# 本番デプロイ手順（CLI 初回〜更新）

アカウントを作った直後から、Docker Compose 上の **Netlify CLI** / **Supabase CLI** で
初回デプロイし、その後の更新を繰り返すまでのオペレータ向け手順です。

| 文書 | 役割 |
| --- | --- |
| **この README** | アカウント作成 → 初回デプロイ → 日常更新の手順書 |
| [supabase.md](./supabase.md) | Managed プロジェクト、Auth（コールバック / Google / **Custom SMTP**）、マイグレーション、メンテナンス LOGIN |
| [netlify.md](./netlify.md) | ブラウザ/サーバ env 境界、HMAC、CSP、preflight、**maintenance-cleanup**、保護リリース runner |
| [../testing/release-checklist.md](../testing/release-checklist.md) | リリースゲート（候補 SHA・検証コマンド） |
| [../runbooks/openrouter.md](../runbooks/openrouter.md) | 有料 OpenRouter allowlist |
| [../runbooks/billing-reconcile.md](../runbooks/billing-reconcile.md) | Stripe / Plus 運用 |
| [../runbooks/account-deletion.md](../runbooks/account-deletion.md) | アカウント削除のオペレータ経路 |

**このリポジトリのエージェント（AI）は本番・ステージングへデプロイしません。**
手順の実行主体は人間オペレータ（または承認済みの保護リリース runner）です。

秘密（パスワード、Supabase Secret / service_role、PAT、DB URL、HMAC 鍵、SMTP 資格情報）を
コマンド履歴・チケット・チャット・git・ビルドログに残さないでください。

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
| `SUPABASE_DB_URL` | Dashboard の接続文字列（**Shared Session pooler / 5432** 推奨） | `db push` / `migration list`（wrapper が注入） |

**`netlify-cli` / `supabase-cli` は git 管理外の `.deploy.env` だけを `env_file` で読む。**
ローカル開発用 `.env` の秘密は注入しない。CLI 用トークンは **`.deploy.env` にだけ**書く。

さらに `netlify-cli` は Vite が dotenv で読む `/workspace/.env` を
**`.deploy.env` で上書きマウント**する。ローカル `.env` の
`VITE_OAUTH_MOCK_ORIGIN` 等が production バンドルに焼けると
`getPublicEnv` が throw し、本番 SPA が白画面になる。

`.deploy.env` に **置いてはいけない**（ブラウザ公開設定）:
- `VITE_OAUTH_MOCK_ORIGIN`（本番では未設定。空文字も Netlify サイト env 禁止）

本番サイトの **Functions 用秘密**（Supabase Secret / service_role 等）を、CLI 用 PAT と混同しないこと。

```bash
# リポジトリルートに .deploy.env を用意（chmod 600 推奨・コミット禁止）
# 例:
#   NETLIFY_AUTH_TOKEN=...
#   NETLIFY_SITE_ID=...
#   SUPABASE_ACCESS_TOKEN=...
#   SUPABASE_DB_PASSWORD=...
#   SUPABASE_PROJECT_ID=...
#   SUPABASE_DB_URL=postgresql://postgres.<ref>:...@aws-0-...pooler.supabase.com:5432/postgres
#   VITE_SUPABASE_URL=https://<20文字ref>.supabase.co
#   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   VITE_AUTH_PROVIDER_MODE=supabase
#   VITE_MAGIC_LINK_RESEND_SECONDS=60
#   VITE_AUTH_CONTINUATION_TTL_MS=300000
# （VITE_OAUTH_MOCK_ORIGIN は書かない）
```

---

## 1. アカウント作成直後（ダッシュボード）

CLI だけでは完結しない準備です。アカウントを作った直後に実施します。

### 1.1 Supabase

1. [Supabase Dashboard](https://supabase.com/dashboard) で組織・プロジェクトを作成する。
2. リージョンを選ぶ（日本向け利用者なら **Asia-Pacific** など近いリージョン）。
3. **Database password** を生成し、シークレットマネージャへ保存する（再表示できない想定で扱う）。
4. **New project の Security** は次の固定方針（詳細・理由は [supabase.md §1](./supabase.md)）:

   | 項目 | 設定 |
   | --- | --- |
   | Enable Data API | **オン**（PostgREST / `supabase-js` 必須） |
   | Automatically expose new tables | **オフ**（migration の明示 GRANT と least-privilege） |
   | Enable automatic RLS | **オン**（`public` 新表の fail-closed 保険） |

5. **GitHub (optional)** のスキーマ自動デプロイは、本リポジトリの運用（オペレータの `db push` / 保護手順）と別経路になるため、**未連携か、連携しても自動 migration に頼らない**。
6. 作成後、次を記録する（値は印刷・コミットしない。キーの世代は [supabase.md §1.1](./supabase.md) が正本）:
   - Project URL（`https://<20文字ref>.supabase.co` のみ。カスタム REST origin は不可）
   - **Publishable key**（推奨: `sb_publishable_…`。Dashboard の *Legacy anon…* は旧 `anon` JWT）
   - **Secret key**（推奨: `sb_secret_…`。Legacy の `service_role` JWT は過渡用。env 名は `SUPABASE_SERVICE_ROLE_KEY`）
7. **Settings → General** の **Reference ID**（20 文字 project ref。通称 Project ID と同値）を `SUPABASE_PROJECT_ID` として控える。
8. Auth は [supabase.md](./supabase.md) に従う（Site URL / Redirect / Google / **Custom SMTP** / メールテンプレート）:
   - Site URL は **後で決まる Netlify 本番 origin** に合わせる（仮 URL のままだとマジックリンクがずれる）。
   - ローカル開発用 `http://127.0.0.1:5173/auth/callback` は許可リストに残してよい。
   - **マジックリンク本番運用には Custom SMTP が必須**（既定 SMTP はチーム内探索用。正本: supabase.md §2.3）。
   - ローカル Compose の `SMTP_*` / mailpit は本番にコピーしない。

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
| Google OAuth（本番 Auth） | Cloud Console の承認済みリダイレクトに `https://<ref>.supabase.co/auth/v1/callback`。証跡: [google-oauth-staging.md](../testing/google-oauth-staging.md) |
| Auth メール / Custom SMTP | マジックリンク用。Supabase Dashboard で設定（[supabase.md §2.3](./supabase.md)）。Netlify env ではない |
| Stripe（Plus を有効にする場合） | Live/Test の `sk_` / endpoint `whsec_` / Price ID。Webhook URL `https://<origin>/api/billing/webhook`。kill は `BILLING_ENABLED`（[netlify.md](./netlify.md) / [billing-reconcile.md](../runbooks/billing-reconcile.md)） |

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

詳細・Auth メール・メンテナンス LOGIN・型ドリフトは [supabase.md](./supabase.md) が正本です。ここでは CLI の最短列だけ示します。

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

クリーンなタグ付きコミット上で、**管理者用 DB URL** を `.deploy.env` の `SUPABASE_DB_URL` に置く
（Session pooler 推奨。例の文字列をコピペ運用・履歴に残さない）。

`supabase-cli` の wrapper が `db push` / `migration list` でコンテナ内の
`SUPABASE_DB_URL` を `--db-url` に渡す。ホストで `export` や `"$SUPABASE_DB_URL"` は不要。

```bash
docker compose --profile deploy run --rm supabase-cli db push --include-all
```

明示したいときだけ従来どおり `--db-url` / `--linked` / `--local` を付ける（その場合は wrapper は上書きしない）。

- マイグレーションは前方のみ。失敗したら新しいマイグレーションで直す（`db reset` や破壊的巻き戻しは本番で使わない）。
- **未適用分をすべて**載せる（Plan 7 / アカウント削除 / メンテナンスに加え identity 枠・Billing 系も。正本: [supabase.md](./supabase.md) §3）。
- マイグレーション外の **メンテナンス LOGIN**（`kondate_maintenance_login`）は同 §4。  
  `SUPABASE_MAINTENANCE_DB_URL` は Netlify Functions スコープだけに入れる（同 §5–6）。

### 3.3 Auth を Netlify origin に合わせる（+ SMTP）

Netlify の本番 origin が決まったら、Supabase Auth を更新する:

- Site URL: `https://<production-host>`
- Redirect: `https://<production-host>/auth/callback`
- ローカル: `http://127.0.0.1:5173/auth/callback`（開発継続用）
- **Custom SMTP** と Magic Link テンプレート（[supabase.md §2.2–2.3](./supabase.md)）が未設定なら、一般利用者へマジックリンクが届かない

---

## 4. 初回: Netlify（サイト作成・env・デプロイ）

env の完全表と禁止事項は [netlify.md](./netlify.md) が正本です。
`npm run preflight:production` の必須キー集合とも一致させる。

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
| ブラウザ安全 | `VITE_SUPABASE_*`、`VITE_AUTH_PROVIDER_MODE=supabase`、`VITE_MAGIC_LINK_RESEND_SECONDS`、`VITE_AUTH_CONTINUATION_TTL_MS` | Builds + 必要なら Functions |
| サーバ専用 | Supabase Secret（`SUPABASE_SERVICE_ROLE_KEY`）、OpenRouter、**両 HMAC**、continuation 暗号鍵、maintenance DB URL、Stripe | **Functions のみ**（Builds / ログ / `VITE_` 禁止） |

最低限そろえる対応関係（抜けやすい必須を含む。数値・禁止の正本は [netlify.md](./netlify.md)）:

| Netlify 変数 | 値の出所 |
| --- | --- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | 同一の `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | 同一 **Publishable**（推奨 `sb_publishable_…`。過渡的に Legacy `anon` JWT 可） |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret**（推奨 `sb_secret_…`。過渡的に Legacy `service_role` JWT 可）。Functions のみ |
| `SERVER_SITE_ORIGIN` | 正確な Netlify HTTPS origin（末尾スラッシュなし） |
| `VITE_AUTH_PROVIDER_MODE` | `supabase` のみ（本番） |
| `VITE_MAGIC_LINK_RESEND_SECONDS` | 正の整数（例: 60） |
| `VITE_AUTH_CONTINUATION_TTL_MS` | `300000` |
| `AUTH_CONTINUATION_TTL_SECONDS` | `300`（Functions） |
| `AUTH_CONTINUATION_ENCRYPTION_KEY` | canonical base64・32 バイト（Functions のみ） |
| `GENERATION_REQUEST_HMAC_KEY` | canonical base64・32 バイト。ローカル/サンプル禁止（Functions のみ） |
| `QUOTA_IDENTITY_HMAC_KEY` | 同上。**生成 HMAC と別鍵**（Functions のみ） |
| `SUPABASE_MAINTENANCE_DB_URL` | least-privilege LOGIN の TLS URL（Functions のみ。[supabase.md](./supabase.md)） |
| 枠・予算系 | `USER_DAILY_AI_LIMIT=3`、`USER_DAILY_EXTERNAL_CALL_LIMIT=6`、`USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT=4`、`USER_SHORT_WINDOW_SECONDS=600`、`GLOBAL_DAILY_AI_LIMIT`（本番推奨 80）、`OPENROUTER_TIMEOUT_MS=24000`、`FUNCTION_TOTAL_BUDGET_MS=55000`、`AI_PROCESSING_STALE_SECONDS=180` |
| OpenRouter | 有料 allowlist + `OPENROUTER_API_KEY` + `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` |
| Stripe（Plus 時） | [netlify.md](./netlify.md) の Billing 行。Webhook: `https://<origin>/api/billing/webhook` |

CLI で 1 件入れる例（値はシェルから。echo しない）:

```bash
# 非秘密（全 context / All scopes 既定）
docker compose --profile deploy run --rm netlify-cli env:set \
  VITE_AUTH_PROVIDER_MODE supabase

# 秘密: --secret は non-dev の context 必須。--context は可変長なので = 形式を使う
# （--context production KEY と書くと KEY が context に飲まれ missing key になる）
docker compose --profile deploy run --rm netlify-cli env:set \
  --secret --context=production \
  OPENROUTER_API_KEY 'sk-or-...'
```

#### 無料プランでの env スコープ（Specific scopes 不可）

Netlify 無料プランでは UI の **Specific scopes**（Builds / Functions の分割）が **Upgrade ロック**される。  
設計書の「サーバ秘密は Functions のみ」は **Pro 以上**で UI/CLI の scope 分割ができる前提の理想形である。

| プラン | できること |
| --- | --- |
| **Free** | **All scopes** のみ（ビルドにも秘密が渡る） |
| **Pro+** | Functions のみ / Builds のみ など scope 分割可 |

**Free での代替防御（必須）**

1. サーバ秘密に **`VITE_` を絶対に付けない**（Vite は `VITE_` だけをブラウザ JS に埋め込む）
2. 秘密は `--secret --context=production` で登録し、UI では **Contains secret values** を付ける
3. ビルドログに env を echo しない
4. 管理画面に入れるメンバーには env が見える／扱える前提で権限を絞る

`VITE_` なしでも **Netlify のプロジェクト権限者**には env が存在する（Secret でもマスクされるだけで権限は残る）。

大量の秘密は Dashboard の UI または保護されたシークレット注入の方が事故が少ないです。  
**禁止の再掲**: `VITE_OAUTH_MOCK_ORIGIN`、あらゆる `VITE_*` サーバ秘密（`VITE_QUOTA_IDENTITY_HMAC_KEY` 含む）、ローカル mock の OpenRouter base、サンプル HMAC、ローカル `SMTP_*`。

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

**CLI ローカルビルドの注意**: 上記はコンテナ内で `npm run build` 相当を走らせる。
`.deploy.env` が無い／`VITE_OAUTH_MOCK_ORIGIN` が混入していると production の
`getPublicEnv` が失敗し、デプロイ後に真っ白になる（Netlify UI ビルドでは
サイト env だけが使われるため再現しないことが多い）。失敗時は
Dashboard の **Clear cache and deploy**、または `.deploy.env` を直してから
CLI で再 `deploy --build --prod`。

#### Function `memory` と無料プラン（422）

`flyer-weekly` の **memory 指定（例: 2048）は Credit-based Pro+ 専用**。  
無料プランでは CDN 設定 API が次で **デプロイ全体を失敗**させる（無視されない）:

```text
Configuring function memory requires a Pro plan or higher with credit-based pricing. 422
```

設定箇所は次の **両方**（どちらか片方だけ外しても、もう一方で 422 になり得る）:

- `netlify.toml` の `[functions."flyer-weekly"]` → `memory = "2048"`
- `netlify/functions/flyer-weekly.ts` の `export const config` → `memory: 2048`

**Free でデプロイする場合**: 上記 memory を **設定しない**（既定 1024MB）。  
**Pro でチラシを 2048MB 運用する場合**: 両方に復帰する。  
sharp / チラシの方針は [netlify.md](./netlify.md) の flyer 節。

Git 継続デプロイを主にする場合:

1. GitHub 等へリポジトリを接続する。
2. production branch を決める。
3. 上記 env を UI に入れたうえで push / 「Clear cache and deploy」。
4. CLI は status / env / 手動 promote の補助に使う。

### 4.4 デプロイ後の最小確認

保護 runner があるなら [netlify.md](./netlify.md) の preflight / `verify:production-deploy` / `smoke:production` を正とする。  
手元の最小確認（秘密を印刷しない）:

1. 本番 origin が HTTPS で開き、SPA がロードされる。
2. **マジックリンク**: チーム外の実メールで受信 → リンク → Auth コールバック完了（Custom SMTP 未設定だとここで止まる）。
3. **Google**: 同じ origin でコールバック完了。
4. Functions が 5xx の嵐にならない（例: `/api/` 配下の公開ヘルス相当があれば）。
5. Netlify の Function ログに PII・プロンプト・生 AI 出力が出ていない。
6. **`maintenance-cleanup`**: production publish 後に Scheduled が載り、`SUPABASE_MAINTENANCE_DB_URL` があること（[netlify.md](./netlify.md)）。
7. Plus を使うなら Stripe Webhook が `https://<origin>/api/billing/webhook` に届くこと。

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
docker compose --profile deploy run --rm supabase-cli db push --include-all
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
4. 保護 runner: preflight:production（サーバ秘密はビルドに載せない。両 HMAC 必須）
5. Netlify: production デプロイ
6. verify:production-deploy → smoke:production → verify:production-deploy
7. マジックリンク到達・maintenance-cleanup・（Plus 時）Webhook を確認
8. 証跡は保護システムのみ（git に origin / secret / 生ログを書かない）
```

---

## 6. トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| `KONDATE_COMPOSE_PROJECT_NAME is required` | `.env` を `./scripts/generate-local-secrets.sh` で用意する |
| `netlify` / `supabase` が not found | `docker compose build app` と `node_modules` ボリューム。`npm ci` 済みの development イメージを使う |
| Netlify 認証エラー | `NETLIFY_AUTH_TOKEN` の有効期限・スコープ。`status` で確認 |
| `link` が `"undefined"` / Site ID | **UUID の Site ID** を使う（サイト名 slug ではない）。既 link なら `status` で確認。Dashboard または `sites:list` |
| env UI で Specific scopes / All scopes が使えない | Free は **All scopes のみ**。ダイアログを閉じてやり直すか `env:set`（`--scope` なし）。§4.2 |
| `env:set` が `missing required argument 'key'` | `--context production KEY` で KEY が context に飲まれている。**`--context=production`** を使う |
| `env:set --secret` が context エラー | `--secret` 時は **`--context=production`**（non-dev）必須 |
| Supabase 認証エラー | `SUPABASE_ACCESS_TOKEN`。組織の権限 |
| `db push` が Unix ソケット / 空 URL | `.deploy.env` に `SUPABASE_DB_URL` が無い／空。§3.2。ホストの `"$…"` 展開に頼らない |
| `db push` が `db.<ref>.supabase.co` no such host | Direct / link 先は IPv6 のみになりがち。`.deploy.env` の **Shared Session pooler（5432）** を使う。Dedicated IPv4 add-on は必須ではない。[supabase.md](./supabase.md) |
| `db push` 失敗（その他） | DB パスワード、ネットワーク、既適用 checksum との食い違い（手編集 migration 禁止） |
| production ビルドで OpenRouter 検証失敗 | 有料 allowlist・`OPENROUTER_API_KEY`・`OPENROUTER_BASE_URL` が production env にあるか。`OPENROUTER_MODELS` の空要素・末尾カンマ禁止 |
| deploy が memory 422 で post-build 失敗 | Free では Function **memory 指定禁止**。`netlify.toml` と `flyer-weekly.ts` の **両方**から外す。§4.3 |
| sharp / flyer ビルド失敗 | `npm run verify:sharp:netlify`（lock に linux-x64）。[netlify.md](./netlify.md) |
| Auth コールバック失敗 | Supabase Redirect URLs と `SERVER_SITE_ORIGIN` / 実 origin の一致 |
| マジックリンクが届かない / チーム外だけ失敗 | Custom SMTP 未設定・既定 SMTP 制限・SPF/DKIM・Auth Rate Limits（[supabase.md §2.3](./supabase.md)） |
| マジックリンクは届くがログインできない | Site URL / Redirect / リンク内 origin のずれ |
| CSP で Supabase が弾かれる | `VITE_SUPABASE_URL` の exact origin。ref 変更時は URL 系を同時更新 |
| preflight が `QUOTA_IDENTITY_HMAC_KEY` で失敗 | Functions に別鍵の canonical base64 32 バイトがあるか。`VITE_` 別名は禁止 |
| `maintenance-cleanup` が動かない | production publish か、`SUPABASE_MAINTENANCE_DB_URL` の有無（preview では動かない） |
| Stripe が Plus にならない | Webhook URL `…/api/billing/webhook`・`whsec_`・`BILLING_ENABLED`（[billing-reconcile.md](../runbooks/billing-reconcile.md)） |

---

## 7. セキュリティチェックリスト（毎回）

- [ ] PAT / DB URL / Supabase Secret（service_role）/ SMTP 資格情報を git・screenshot・チケットに載せていない
- [ ] 本番に `VITE_OAUTH_MOCK_ORIGIN` や mock OpenRouter base が無い
- [ ] `VITE_` 付きでサーバ秘密を付けていない（`VITE_QUOTA_IDENTITY_HMAC_KEY` 含む）
- [ ] `GENERATION_REQUEST_HMAC_KEY` と `QUOTA_IDENTITY_HMAC_KEY` は別鍵
- [ ] `SUPABASE_MAINTENANCE_DB_URL` は Functions のみ・least-privilege LOGIN
- [ ] Auth マジックリンクは **Custom SMTP**（ローカル mailpit を本番に使っていない）
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
docker compose --profile deploy run --rm netlify-cli env:set KEY value
docker compose --profile deploy run --rm netlify-cli env:set --secret --context=production KEY value
docker compose --profile deploy run --rm netlify-cli deploy --build
docker compose --profile deploy run --rm netlify-cli deploy --build --prod

# Supabase（SUPABASE_DB_URL は .deploy.env。Direct ではなく Session pooler 推奨）
docker compose --profile deploy run --rm supabase-cli projects list
docker compose --profile deploy run --rm -it supabase-cli link --project-ref "$SUPABASE_PROJECT_ID"
docker compose --profile deploy run --rm supabase-cli db push --include-all
docker compose --profile deploy run --rm supabase-cli migration list
```

環境変数・枠・CSP・保護 runner の数値と禁止事項は、必ず [netlify.md](./netlify.md) と [supabase.md](./supabase.md) を再確認してください。本 README は手順の骨格であり、ロック値の正本ではありません。
