# E2E Function Test Server Design

## Purpose

`@netlify/vite-plugin` のローカル Function ランナーが一時ストリーム用ポートへ接続できず、認証継続 API が `ECONNREFUSED` で失敗する。E2E 実行時だけ、このランナーを使わずに既存 Function handler を HTTP で公開する。

## Scope

- E2E 専用サーバーは `auth-continuation-create`、`auth-continuation-deposit`、`auth-continuation-claim` の3経路を公開する。
- Vite の `/api` リクエストは E2E 時だけそのサーバーへプロキシする。
- Function の `default` handler、環境変数、Supabase RPC、OAuth mock、Mailpit は既存のものを使用する。
- 本番ビルド、`netlify.toml`、Netlify のデプロイ時 Function 実行は変更しない。

## Architecture

Compose の `app` サービスは E2E モードでテストサーバーと Vite を同時に起動する。テストサーバーは Node の HTTP リクエストを Fetch API の `Request` に変換し、正規表現で抽出した `continuationId` を `Context.params` として該当 Function handler に渡す。返却された `Response` はステータス、ヘッダー、本文を保持して HTTP 応答へ変換する。

通常の開発では従来どおり `@netlify/vite-plugin` が Function を処理する。E2E モードでは同プラグインの Function 機能だけを無効化し、他の Vite プラグインと開発設定は維持する。

## Error Handling and Boundaries

- 未定義の API 経路は 404 を返す。
- Function handler が例外を送出した場合、テストサーバーは 500 を返して原因を標準エラーへ記録する。
- Netlify 固有の rate limit や実行ランタイムは模倣しない。Function の入力・出力・認可・RPC は既存の単体テストとE2Eで検証する。
- サーバーは E2E コンテナのライフサイクルに従って終了し、ローカル開発プロセスには常駐しない。

## Verification

1. HTTP 変換と3経路のルーティングを単体テストでRED→GREENにする。
2. E2E モードのVite設定が Netlify Function ランナーを無効化し、`/api` をテストサーバーへ転送することを設定テストで確認する。
3. `docker compose --profile e2e run --rm e2e` で OAuth、認証回復、オンボーディング、設定のPlaywright仕様を実行する。
4. 既存の型検査、lint、フォーマット検査を実行する。
