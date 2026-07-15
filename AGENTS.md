# リポジトリガイドライン

## プロジェクト概要

主に主婦などの家庭料理を作る一般の人向けのメニュー作成WebAppです。
本番デプロイ先は、NetlifyとSupabaseです。

## ビルド、テスト、開発コマンド

Node 24（`package.json` の `engines` を参照）を使用し、依存関係Docker上で `npm ci` でインストールします。
基本的にコマンドはDocker経由で行うこと。
- `docker compose run --rm --no-deps app npm run dev` は Vite 開発サーバーを起動します。
- `docker compose run --rm --no-deps app npm run build` は TypeScript プロジェクトのチェックを実行し、本番環境用の Vite ビルドを作成します。
- `docker compose run --rm --no-deps app npm run lint`、`docker compose run --rm --no-deps app npm run format:check`、`docker compose run --rm --no-deps app npm run typecheck` は、スタイル、フォーマット、型を検証します。
- `docker compose run --rm --no-deps app npm test` は Vitest をウォッチモードで実行します。CI スタイルのワンショット実行には `docker compose run --rm --no-deps app npx vitest run` を使用してください。 - `docker compose run --rm --no-deps app npm run e2e` は、設定済みのローカルアプリケーションに対して Playwright テストを実行します。
- `docker compose up -d --wait` は、ローカルアプリケーション/Supabase スタックを起動します。`docker compose run --rm --no-deps app npm run db:reset` はスタックを再作成し、`docker compose run --rm --no-deps app npm run db:test` は pgTAP データベーステストを実行します。

## コーディングスタイルと命名規則

2スペースのインデント、二重引用符、セミコロン、Prettier フォーマットを使用してください。厳密で明示的な TypeScript を推奨し、`any` や安全でないキャストは避けてください。React コンポーネント/型には `PascalCase`、変数/関数には `camelCase` を使用し、`*.test.ts`/`*.test.tsx` のような分かりやすいファイル名を使用してください。適切な箇所で、設定済みの `@/` および `@shared/` エイリアスを使用してください。

コード内のコメントは必ず日本語で書き、あとから人間がレビューしやすいように、背景・意図・思考を考えかつ具体的に説明する。

# レビュー

レビューをする際は、設計書に沿っているか、セキュリティに問題はないか、敵対的レビューの観点でサブエージェントを使って実施する。
レビュー後、異なるサブエージェントを使って、より深い検証と、指摘が正しければ修正するというフローを連続して行うこと。

## テストガイドライン

対象となるコードの横に、焦点を絞った Vitest/React Testing Library テストを追加します。ユーザー フローには Playwright を使用し、スキーマ/RLS 動作には pgTAP を使用します。変更を送信する前に、「npx vitest run」、「npm run e2e」、および関連するデータベース テストを実行します。テストを決定論的に保ち、カバレッジに依存する動作が変更された場合は更新します。

## コミットおよびプルリクエストのガイドライン

コミットメッセージは必ず日本語で書き、従来のコミット形式（例: `feat: 献立生成を追加`、`fix: 認証状態の復元を修正`、`chore: 開発設定を整理`）にする。ファイル名は短く、変更内容がわかる表現にする。リクエストには内容、実行した検証コマンド、関連問題や設計資料を記載し、UI変更にはスクリーンショットを添付データベース。マイグレーション、環境変数、セキュリティへの影響、ローカルスタックの変更は安全にする。

## セキュリティと構成のヒント

シークレットや生成されたローカル認証情報は決してコミットしないでください。 OpenRouter とサービスのシークレットをサーバー側の環境変数に保持します。目的の Supabase クライアント構成のみを公開します。移行と RLS ポリシーを運用環境に依存したものとして扱い、ローカルの Docker スタックを使用してスキーマの変更を検証します。