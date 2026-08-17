# Supabase 本番デプロイ手順

アカウント作成直後からの **CLI 初回デプロイと更新の手順**は
[README.md](./README.md)（Compose profile `deploy` の `supabase-cli`）を先に読む。

Managed Supabase プロジェクトの作成から、API キー（**Publishable / Secret** と Legacy）、
Auth（コールバック / Google / **Custom SMTP**）、マイグレーション適用、least-privilege
メンテナンス LOGIN の用意、スキーマ検証までの正本。
**パスワード・接続 URL・Secret / service_role をコマンド履歴・チケット・ログに残さない。**

`QUOTA_IDENTITY_HMAC_KEY` の生成・配置・ローテ影響は Netlify Functions 側の鍵であり、
正本は [netlify.md](./netlify.md)（サーバ専用変数・HMAC）。

---

## 1. プロジェクト作成と秘密の記録

1. 選定リージョンで managed プロジェクトを作成する（日本向けなら **Asia-Pacific** など近いリージョン）。
2. **Database password** は強力な値を生成し、シークレットマネージャへ保存する（再表示できない想定）。
3. **New project 画面の Security**（作成時のチェックボックス）は次に固定する:

   | 項目 | 設定 | 理由 |
   | --- | --- | --- |
   | **Enable Data API** | **オン** | ブラウザの `supabase-js` が PostgREST（Data API）経由で `public` を読む。オフだとアプリの DB アクセスが成立しない |
   | **Automatically expose new tables** | **オフ** | 本リポジトリは migration で `revoke all` → 必要分だけ `grant` する least-privilege。新表の自動公開は権限境界と逆。Dashboard も手動制御時は無効を推奨。**オフのとき local Compose の default privileges（CREATE 時に `service_role` へ ALL）が本番では付かない**ため、`public` 表への `service_role` GRANT は migration で明示する（`20260731170000_service_role_public_table_grants.sql` / `docs/testing/database-access-matrix.md`）。未付与だと Functions の admin 読取が `42501 permission denied` になる |
   | **Enable automatic RLS** | **オン** | migration でも `enable row level security` 済み。Dashboard や手作業で `public` に表ができたときの fail-closed 保険（policy なしならクライアントから読めない） |

4. **GitHub (optional)** の「コード push で schema を自動デプロイ」は、本リポジトリの正本手順（クリーンなコミット上の `db push` / 保護リリース）と別経路になる。**未連携のまま**、または連携しても **自動 migration に頼らない**（適用順・検証は [README.md](./README.md) と本ファイル §3）。
5. 作成後、次をデプロイ用シークレットマネージャへ記録する（メンテナンス用クレデンシャルとは別）:
   - 正確な 20 文字 project ref（Settings → General の **Reference ID**。通称 project ref / Project ID と同値）
   - 正確な origin `https://<project-ref>.supabase.co`
   - **Publishable key** と **Secret key**（次節。Netlify env へ載せる値）
   - 管理者用デプロイ DB URL
6. この MVP ではカスタム / 任意 REST origin を拒否する。ブラウザとサーバのアプリ URL は同じ managed origin、**publishable も browser / server で同一値**とする。

### 1.1 API キー（Publishable / Secret と Legacy）

Dashboard の **Settings → API Keys**（または Project の Connect ダイアログ）に、世代の異なるキーがある。

| 役割 | 推奨（新形式） | Legacy（旧形式） | 本リポジトリの env |
| --- | --- | --- | --- |
| ブラウザ・低権限 | **Publishable** `sb_publishable_…` | **`anon`**（長寿命 JWT）。UI では *Legacy anon, service_role API keys* | `VITE_SUPABASE_PUBLISHABLE_KEY` と `SUPABASE_PUBLISHABLE_KEY`（**同一値**） |
| サーバ特権・RLS バイパス | **Secret** `sb_secret_…` | **`service_role`**（長寿命 JWT）。同上 Legacy | `SUPABASE_SERVICE_ROLE_KEY`（**Functions のみ**。env 名は歴史的に service_role） |

公式の整理:

- `anon` は publishable の legacy 版、`service_role` は secret の legacy 版。
- 新キーを作っても Legacy はすぐ無効にはならず、**当面は両方が並存**し得る。
- Supabase は **2026 年末までに Legacy を deprecate** する方針。新規プロジェクトは **Publishable + Secret を先に使う**。

#### 本番オペレータ手順

1. **Settings → API Keys** を開く（*Legacy* タブだけに頼らない）。
2. Publishable が無ければ **Create new API Keys** 等で作成し、`sb_publishable_…` を控える。
3. Secret を 1 本以上作成し、`sb_secret_…` を控える（コンポーネントごとに分ける運用も可。本 MVP は Functions 用 1 本で足りる）。
4. Netlify へは次のように載せる（値は印刷しない）:
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = Publishable（Builds 可）
   - `SUPABASE_PUBLISHABLE_KEY` = **同じ** Publishable（Functions）
   - `SUPABASE_SERVICE_ROLE_KEY` = Secret（**Functions のみ**。`VITE_` 禁止）
5. **禁止**: Secret / Legacy `service_role` をブラウザ・`VITE_`・git・チケット・ビルドログへ。
6. Legacy の `anon` / `service_role` JWT も **過渡的には**同じ env スロットに入れて動くが、新規は新形式を正とする。移行後に Legacy を Dashboard で無効化するのは別ステップ（アプリ全経路が新キーに切り替わってから）。

#### ローカルとの違い

ローカル Compose は self-host 互換のため、`scripts/generate-local-secrets.mjs` が **JWT 形式の `ANON_KEY` / `SERVICE_ROLE_KEY`** を生成し、それを publishable / service スロットへマップする。  
**本番 Managed にローカル JWT をコピーしない。** 本番は Dashboard の Publishable / Secret（または当面の Legacy）を使う。

## 2. Auth サイト URL とコールバック

1. Site URL を canonical な Netlify HTTPS origin にする（末尾スラッシュなし）。
2. 許可するコールバック（Redirect URLs）は次のみ:
   - ローカル: `http://127.0.0.1:5173/auth/callback`
   - Netlify 本番: `https://<production-host>/auth/callback`
   - 明示承認した deploy-preview コールバックのみ
3. カスタムドメインへ切り替えるときは Site URL・Redirect・Netlify の `SERVER_SITE_ORIGIN` /
   `VITE_SUPABASE_URL` 系を**同時**に更新する（ずれは Google OAuth コールバックを壊す。メール番号経路はリンクを踏まない）。

### 2.1 Google プロバイダ

1. Google Cloud Console で OAuth クライアントを作成する。
2. 承認済みリダイレクト URI に **Supabase のコールバック**だけを入れる:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
3. Client ID / Secret を Supabase Dashboard の Auth → Providers → Google に設定する。
4. ステージングでの実 Google 成功証跡の形式は
   [google-oauth-staging.md](../testing/google-oauth-staging.md)（リポジトリ外 JSON。token / email 禁止）。

### 2.2 番号メールテンプレート（URL 禁止・`{{ .Token }}` 必須）

1. Auth → Email Templates で **Magic Link** と **Confirm sign up** の両方を同じ制約で設定する。Invite / Recovery は触らない。
2. 件名は両方とも `こんだて日和の番号`。氏名・メール本文の再掲・アレルギー等の PII、プロンプトは載せない。
3. **本文に URL を置かない。** マジックリンクも `token_hash` も踏ませない。届いた 6 桁をアプリの画面に入力する。

   ```html
   <p>アプリの画面に、この 6 つの数字を入力してください。</p>
   <p style="font-size:28px;letter-spacing:0.2em">{{ .Token }}</p>
   ```

   - `{{ .Token }}` を置く（桁は 6）。
   - 置かない: `{{ .ConfirmationURL }}` / `{{ .TokenHash }}` / `{{ .RedirectTo }}` / 生の `http` / `https`。
4. 寿命・桁・レートはローカル override と本番 Dashboard で同一にする:
   - OTP exp **3600** 秒
   - OTP length **6**
   - `RATE_LIMIT_OTP` **30**
   - `RATE_LIMIT_VERIFY` **360**
   - `SMTP_MAX_FREQUENCY` **60s**
5. GoTrue の `POST /auth/v1/otp`（メール）は内部で Magic Link と同じ入口なので、ローカル compose は `GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED=true` のままにする（false だと 6 桁番号も `email_provider_disabled` になる）。リンク経路を閉じる防御は **URL 無しテンプレ**側に置く。hosted Dashboard でこのフラグを切れなくても同じ。本文から URL を除く。
6. テンプレートだけでは届かない。**次節の Custom SMTP が本番番号メールの前提**である。
7. デプロイ後の確認: メール HTML に 6 桁があり、`http` / `https` が無いこと。`…supabase.co/auth/v1/verify` や callback URL が残っていたらテンプレ未更新。

## 2.3 Auth メール / Custom SMTP（本番必須）

本プロダクトのログインは Google OAuth と **メール 6 桁番号**の二本立てである。
番号メールは **Managed Supabase Auth が送信**する（Netlify Functions やアプリの
`SMTP_*` 環境変数は使わない）。

### なぜ Custom SMTP が必須か

Supabase がプロジェクトに付ける**既定のメール送信**は探索・チーム内テスト向けであり、本番の
一般利用者向け番号メールには使わない:

- 組織チームに紐づくアドレス以外への配送を拒否し得る
- 厳しい送信レート制限（変更され得る。本番 SLA なし）
- 到達性・送信元レピュテーションの保証がない

公式ガイドの趣旨どおり、番号メール等のメール Auth を本番で使うなら
**Custom SMTP を有効化する**。

### 設定場所と項目

Dashboard: **Authentication → SMTP**（または Project の Auth SMTP 設定）。

| 項目 | 要件 |
| --- | --- |
| Custom SMTP | 有効 |
| Host / Port | プロバイダの SMTP（例: 587） |
| User / Password | プロバイダ資格情報（シークレットマネージャへ。git / Netlify env / チケット禁止） |
| Sender email（From） | 所有ドメインの送信専用アドレス（例: `noreply@…`） |
| Sender name | 例: `こんだて日和` |

プロバイダ例（非網羅）: Resend、Amazon SES、Postmark、SendGrid 等。SMTP プロトコルを
サポートすればよい。

### DNS と到達性

1. 送信ドメインに **SPF / DKIM**（推奨: **DMARC**）をプロバイダ手順どおり設定する。
2. Auth 用送信ドメインとマーケティング用を分ける（レピュテーション分離）。
3. Custom SMTP 有効後も Auth 側の **Rate Limits**（Dashboard）を確認し、想定トラフィックに合わせる。
4. 任意: ボット濫用が問題になったら Auth CAPTCHA 等を検討（本 MVP の必須手順ではない）。

### 検証（ステージング優先）

1. **チーム外**の実メールアドレスへ番号メールを送る（既定 SMTP のチーム限定をすり抜けたつもりにならない）。
2. 受信箱（必要なら迷惑メール）の 6 桁をアプリのログイン画面に入力し、セッションが完了する。
3. Google コールバックも同じ Site URL 前提で確認する。

### 禁止

- ローカル Compose の `SMTP_*` / mailpit（`mailpit:1025`）を本番 Supabase や Netlify にコピーしない
- Netlify のサイト env に `SMTP_HOST` 等を置かない（Auth は Supabase Dashboard / Management API 側）
- 送信ログ・サポート票に利用者メール全文や確認番号を残さない運用にする

## 3. マイグレーション適用順

クリーンなタグ付きコミットから:

```bash
# 推奨（Compose profile deploy。.deploy.env の SUPABASE_DB_URL を wrapper が渡す）
docker compose --profile deploy run --rm supabase-cli db push --include-all

# ホストに Node がある場合の同等（URL は自分で渡す）
npm exec --offline supabase -- db push --db-url "$SUPABASE_DB_URL" --include-all
```

`db push --include-all` はリポジトリ上の **未適用 migration をすべて**前方適用する
（Plan 7・アカウント削除・メンテナンスに加え、identity 日次枠・Billing / Plus 枠・
後続の安全・Auth 修正など、ファイル名順の全チェーン）。

確認の目安（手入力の短縮名ではなく CLI が吐いたパスを正とする）:

1. Plan 7 系（`optional_household_profiles` / `target_mode_storage` / `generation_command_v2` / `idea_generation_boundary`）
2. アカウント削除: `supabase/migrations/20260724075916_account_deletion.sql`
3. メンテナンス: `supabase/migrations/20260724110606_maintenance_cleanup.sql`
4. 以降の identity quota / billing / plan-aware 枠なども **同じ push で未適用分が載ること**
   （個別に「Plan 6 まで」で止めない）

マイグレーションは前方のみ。トラフィック前の失敗は新しいマイグレーションで直し、フロントのロールバックは Netlify の前デプロイで行う。`db reset` や破壊的な逆マイグレーションは使わない。

## 4. メンテナンス LOGIN（マイグレーション外）

コミット済みマイグレーションが作るのは **NOLOGIN** の `kondate_maintenance_executor` と RPC 権限だけである。

1. デプロイ用シークレットマネージャで一意のメンテナンスパスワードを生成する。
2. 管理者 `psql` で履歴・echo・statement logging・shell tracing を無効化し、次を実行する（秘密は stdin / 環境経由。CLI 引数や SQL エディタの秘密貼り付けは禁止）:
   - `kondate_maintenance_login` を
     `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`
     として作成または正規化
   - パスワード設定 / ローテーション（psql の保護されたパスワード入力経路）
   - `GRANT kondate_maintenance_executor TO kondate_maintenance_login`
   - `ALTER ROLE kondate_maintenance_login SET statement_timeout = '20s'`
3. 非秘密の grant / default 文だけは、トランスクリプトが保護されている場合に限り SQL エディタでも可。

定期実行の HTTP 入口は Netlify の `maintenance-cleanup`（secret 付き POST。起動は GitHub Actions 等 — [netlify.md](./netlify.md)）。

## 5. `SUPABASE_MAINTENANCE_DB_URL` の組み立て

1. Netlify ランタイムがプロジェクトの IPv6 直接 endpoint に届く、または IPv4 add-on がある場合:
   - ホスト `db.<記録した-project-ref>.supabase.co:5432`
   - ユーザ名 `kondate_maintenance_login`
   - `sslmode=require`（または `verify-ca` / `verify-full`）
2. それ以外は公式 IPv4 Supavisor **Session**（port `5432`）を使い、ロール接頭辞だけを `kondate_maintenance_login` に差し替え、**同じ** project-ref ルーティング接尾辞を残す。
3. 別環境からコピーした ref は、接続できてもハード失敗とする。
4. クレデンシャル成分は percent-encode し、中間 URL を印刷しない。結果は Netlify Functions スコープの `SUPABASE_MAINTENANCE_DB_URL` のみに格納し、ローカルコピーは直ちに破棄する。
5. **禁止**: port `6543` / transaction mode、service-role JWT、管理者 DB パスワード、リポジトリ、チケット、shell 履歴、ログへの保管。

## 6. 接続検証（ブール / ロール名のみ）

専用 URL で 1 回接続し、トランザクション前に:

- `session_user = current_user = 'kondate_maintenance_login'`
- `current_setting('statement_timeout') = '20s'`

その後トランザクション内で:

- `SET LOCAL ROLE kondate_maintenance_executor` が可能
- 同じ `20s` が見える
- `public.run_kondate_maintenance` のみ実行可
- 所有テーブルの SELECT や他アプリ RPC は不可

接続コマンドと URL は出力しない。

## 6.1 運用閲覧ロール `kondate_ops_readonly`（ローカル admin コンソール）

ローカル専用運用 UI（`compose.admin.yaml`）が本番/staging を **SELECT のみ**で読むための LOGIN。  
maintenance（cleanup RPC 専用）とは **別ロール**。executor 二段は使わない。

1. migration `20260811180000_ops_readonly_role.sql` を適用する（NOLOGIN + GRANT + `user_feedback` RLS SELECT policy + ops 索引）。
2. 管理者 `psql` で履歴を無効化し、次を実行する（パスワードは stdin / 環境経由。CLI 引数禁止）:
   - `ALTER ROLE kondate_ops_readonly WITH LOGIN PASSWORD … NOINHERIT CONNECTION LIMIT 4`
   - `statement_timeout = 15s` と `default_transaction_read_only = on` が残っていることを確認
3. Session pooler URL を組み立て `.env.admin` のみに保存する（リポジトリ・チケット・ログ禁止）:
   - `postgresql://kondate_ops_readonly.<project-ref>:<password>@…pooler…:5432/postgres?sslmode=require`
   - username は **exact** `kondate_ops_readonly` または `kondate_ops_readonly.<20-char-ref>` のみ
   - port `6543` / transaction mode 禁止。管理者 `postgres` URL 禁止
4. ローカル Compose では `./scripts/provision-ops-readonly-role.sh`（`OPS_READONLY_DB_PASSWORD`）で LOGIN 化できる。
5. admin プロセス起動時 canary（`session_user`、READ ONLY、INSERT privilege 無し）が通ることを確認する。

SELECT 対象は migration で固定した 6 表のみ。`auth` USAGE や書き込み RPC は付与しない。

## 7. ステージング検証と型ドリフト

1. 本番ではなくステージングで DB スイートを実行する（30 日境界、4 カウント readback、実 20 秒キャンセル / ロールバック統合テストを含む）。
2. ステージング通過後に同じマイグレーションファイルを本番へ昇格する。
3. スキーマドリフト確認は **`scripts/generate-database-types.sh`** を `PG_META_TYPES_URL` 経由でステージングへ向け、結果を `src/shared/types/database.generated.ts` と `diff -u` する。
   `supabase gen types` の出力とは比較しない（ジェネレータ差が実ドリフトに見える）。

## 8. カタログとデモデータ

- アレルゲン / 食事ルールのカタログ版とプライバシー説明版を確認する。
- 本番にデモ世帯データは作らない。

## 9. メンテナンス資格情報のロールバック

スケジュールを止め、LOGIN または executor メンバーシップを revoke し、当該 login のセッションだけを terminate し、秘密をローテートし、ロール / 既定 / 権限を readback してから再有効化する。
運用コマンドはパスワードも接続 URL も印刷しない。
