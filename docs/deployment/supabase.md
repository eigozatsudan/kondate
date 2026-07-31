# Supabase 本番デプロイ手順

アカウント作成直後からの **CLI 初回デプロイと更新の手順**は
[README.md](./README.md)（Compose profile `deploy` の `supabase-cli`）を先に読む。

Managed Supabase プロジェクトの作成から、Auth（コールバック / Google / **Custom SMTP**）、
マイグレーション適用、least-privilege メンテナンス LOGIN の用意、スキーマ検証までの正本。
**パスワード・接続 URL・サービスロールキーをコマンド履歴・チケット・ログに残さない。**

`QUOTA_IDENTITY_HMAC_KEY` の生成・配置・ローテ影響は Netlify Functions 側の鍵であり、
正本は [netlify.md](./netlify.md)（サーバ専用変数・HMAC）。

---

## 1. プロジェクト作成と秘密の記録

1. 選定リージョンで managed プロジェクトを作成する。
2. 次をデプロイ用シークレットマネージャへ記録する（メンテナンス用クレデンシャルとは別）:
   - 正確な 20 文字 project ref
   - 正確な origin `https://<project-ref>.supabase.co`
   - publishable key
   - service-role key
   - 管理者用デプロイ DB URL
3. この MVP ではカスタム / 任意 REST origin を拒否する。ブラウザとサーバのアプリ URL は同じ managed origin、publishable key も同一値とする。

## 2. Auth サイト URL とコールバック

1. Site URL を canonical な Netlify HTTPS origin にする（末尾スラッシュなし）。
2. 許可するコールバック（Redirect URLs）は次のみ:
   - ローカル: `http://127.0.0.1:5173/auth/callback`
   - Netlify 本番: `https://<production-host>/auth/callback`
   - 明示承認した deploy-preview コールバックのみ
3. カスタムドメインへ切り替えるときは Site URL・Redirect・Netlify の `SERVER_SITE_ORIGIN` /
   `VITE_SUPABASE_URL` 系を**同時**に更新する（ずれはマジックリンク・OAuth 両方を壊す）。

### 2.1 Google プロバイダ

1. Google Cloud Console で OAuth クライアントを作成する。
2. 承認済みリダイレクト URI に **Supabase のコールバック**だけを入れる:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
3. Client ID / Secret を Supabase Dashboard の Auth → Providers → Google に設定する。
4. ステージングでの実 Google 成功証跡の形式は
   [google-oauth-staging.md](../testing/google-oauth-staging.md)（リポジトリ外 JSON。token / email 禁止）。

### 2.2 マジックリンク用メールテンプレート

1. Auth → Email Templates で Magic Link（必要なら Confirmation 等）を設定する。
2. 件名・本文は**日本語・平易**。氏名・メール本文の再掲・アレルギー等の PII、プロンプトは載せない。
3. リンク先が §2 の Site URL / Redirect と矛盾しないことを確認する。
4. テンプレートだけでは届かない。**次節の Custom SMTP が本番マジックリンクの前提**である。

## 2.3 Auth メール / Custom SMTP（本番必須）

本プロダクトのログインは Google OAuth と **メール・マジックリンク**の二本立てである。
マジックリンクは **Managed Supabase Auth が送信**する（Netlify Functions やアプリの
`SMTP_*` 環境変数は使わない）。

### なぜ Custom SMTP が必須か

Supabase がプロジェクトに付ける**既定のメール送信**は探索・チーム内テスト向けであり、本番の
一般利用者向けマジックリンクには使わない:

- 組織チームに紐づくアドレス以外への配送を拒否し得る
- 厳しい送信レート制限（変更され得る。本番 SLA なし）
- 到達性・送信元レピュテーションの保証がない

公式ガイドの趣旨どおり、マジックリンク等のメール Auth を本番で使うなら
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

1. **チーム外**の実メールアドレスへマジックリンクを送る（既定 SMTP のチーム限定をすり抜けたつもりにならない）。
2. 受信箱（必要なら迷惑メール）でリンクを開き、§2 の callback でセッションが完了する。
3. Google コールバックも同じ Site URL 前提で確認する。

### 禁止

- ローカル Compose の `SMTP_*` / mailpit（`mailpit:1025`）を本番 Supabase や Netlify にコピーしない
- Netlify のサイト env に `SMTP_HOST` 等を置かない（Auth は Supabase Dashboard / Management API 側）
- 送信ログ・サポート票に利用者メール全文やマジックリンク URL を残さない運用にする

## 3. マイグレーション適用順

クリーンなタグ付きコミットから:

```bash
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

スケジュール実行の本体は Netlify の `maintenance-cleanup`（[netlify.md](./netlify.md)）。

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
