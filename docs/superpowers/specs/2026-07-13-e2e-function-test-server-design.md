# E2E Function Test Server Design

## Purpose

`@netlify/vite-plugin` のローカル Function ランナーが一時ストリーム用ポートへ接続できず、認証継続 API が `ECONNREFUSED` で失敗する。E2E 実行時だけ、このランナーを使わずに既存 Function handler を HTTP で公開する。

## Scope

- E2E 専用サーバーは `auth-continuation-create`、`auth-continuation-deposit`、`auth-continuation-claim` の3経路を公開する。
- Vite の `/api` リクエストは E2E 時だけ `http://127.0.0.1:5174` のテストサーバーへプロキシする。
- Function の `default` handler、環境変数、Supabase RPC、OAuth mock、Mailpit は既存のものを使用する。
- 本番ビルド、`netlify.toml`、Netlify のデプロイ時 Function 実行は変更しない。

## Architecture

`KONDATE_E2E_FUNCTION_SERVER=1` をE2Eモードの唯一の切替条件とする。Compose の `app` サービスはこの環境変数を設定し、`tools/run-e2e-app.mjs` で `tools/e2e-function-server.mjs` と Vite を同時に起動する。テストサーバーは `127.0.0.1:5174` だけで待ち受け、Node の HTTP リクエストを Fetch API の `Request` に変換する。返却された `Response` はステータス、ヘッダー、本文を保持して HTTP 応答へ変換する。

テストサーバーは Vite の SSR module loader を使って3つの Function モジュールを読み込む。経路とメソッドは各モジュールの `config.path` と `config.method` から導出し、`config` を複製した正規表現やルート表を持たない。`:continuationId` のみを `Context.params.continuationId` として抽出し、各モジュールの `default` handler を呼び出す。

通常の開発では従来どおり `@netlify/vite-plugin` が Function を処理する。E2E モードでは `netlify({ functions: { enabled: false } })` とし、同プラグインの Function 機能だけを無効化する。このオプションはプラグインの公開型 `NetlifyPluginOptions` と、`@netlify/dev` の `options.functions?.enabled !== false` により確認済みである。他の Vite プラグインと開発設定は維持する。

## Error Handling and Boundaries

- 未定義の API 経路は 404 を返す。
- Function handler が例外を送出した場合、テストサーバーは 500 を返す。標準エラーには固定のエラーコード、HTTPメソッド、パス名だけを記録し、リクエスト・レスポンスの本文、ヘッダー、例外メッセージ、スタックトレースは記録しない。
- Netlify 固有の rate limit や実行ランタイムは模倣しない。Function の入力・出力・認可・RPC は既存の単体テストとE2Eで検証する。
- サーバーは E2E コンテナのライフサイクルに従って終了し、ローカル開発プロセスには常駐しない。通常の `npm run dev` は `KONDATE_E2E_FUNCTION_SERVER` を設定しないため、ポート5174を使用しない。

## Verification

1. HTTP 変換、`config.path`/`config.method` からの3経路導出、`continuationId` の受け渡し、例外時の秘匿ログを単体テストでRED→GREENにする。
2. E2E モードのVite設定が Netlify Function ランナーを無効化し、`/api` を `http://127.0.0.1:5174` へ転送することを設定テストで確認する。
3. `docker compose --profile e2e run --rm e2e` で OAuth、認証回復、オンボーディング、設定のPlaywright仕様を実行する。
4. 既存の型検査、lint、フォーマット検査を実行する。
