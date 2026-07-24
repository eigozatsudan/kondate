# Supabase 本番デプロイ手順

Managed Supabase プロジェクトの作成から、マイグレーション適用、least-privilege メンテナンス LOGIN の用意、スキーマ検証までの正本。
**パスワード・接続 URL・サービスロールキーをコマンド履歴・チケット・ログに残さない。**

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

1. Site URL を canonical な Netlify HTTPS origin にする。
2. 許可するコールバックは次のみ:
   - ローカル: `http://127.0.0.1:5173/auth/callback`
   - Netlify 本番コールバック
   - 明示承認した deploy-preview コールバック
3. Google プロバイダとマジックリンク用メールテンプレートを設定し、ステージングで両コールバックを確認する。

## 3. マイグレーション適用順

クリーンなタグ付きコミットから:

```bash
npm exec --offline supabase -- db push --db-url "$SUPABASE_DB_URL" --include-all
```

ファイル名順で次を確認する（手入力の短縮名ではなく CLI が吐いたパスを正とする）:

1. Plan 7 系（`optional_household_profiles` / `target_mode_storage` / `generation_command_v2` / `idea_generation_boundary`）
2. アカウント削除: `supabase/migrations/20260724075916_account_deletion.sql`
3. メンテナンス: `supabase/migrations/20260724110606_maintenance_cleanup.sql`

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
