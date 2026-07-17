# Playwright MCP セットアップ設計

## 目的

Codex から Playwright MCP を利用し、Kondate のローカル開発環境をヘッドレス Chromium で対話的に確認できるようにする。ホスト上では Node.js や Playwright を実行せず、リポジトリの Docker 実行方針を維持する。

## 対象範囲

- 信頼済みプロジェクトで読み込まれる `.codex/config.toml` に、プロジェクト単位の Playwright MCP サーバーを追加する。
- 公式の Playwright MCP Docker イメージを使用する。
- Playwright MCP からアクセスするブラウザーの送信先を、このリポジトリが使用するローカルオリジンに限定する。
- ローカル開発手順に、事前条件、起動方法、Codex の再起動、制約を追記する。

アプリケーションコード、DB スキーマ、Supabase 構成、既存 E2E テストの挙動は変更しない。

## 採用案

`.codex/config.toml` の `mcp_servers.playwright` から `docker run` を stdio モードで起動する。Microsoft が公開する Playwright MCP イメージを、不変の manifest digest で固定して使用する。

この方式には次の利点がある。

- ホスト上で `npx` を実行せず、リポジトリの Docker 原則に従える。
- `package.json` と `package-lock.json` に MCP 専用依存を追加せず、アプリケーションの Playwright 依存と分離できる。
- MCP サーバー、Chromium、ブラウザープロファイルを使い捨てコンテナ内に閉じ込められる。
- Codex のプロジェクト設定としてチームで同じ構成を共有できる。

## 代替案と不採用理由

### 既存 `e2e` イメージを利用する

`@playwright/mcp` を開発依存へ追加し、Compose の `e2e` サービスから起動する案である。lockfile で npm パッケージを固定できる一方、MCP が要求する Playwright と既存 E2E が使用する Playwright のブラウザーバイナリ整合を継続的に管理する必要がある。MCP 導入のためにアプリケーション依存と E2E イメージを変更するため、今回の目的には変更範囲が広い。

### ホスト上の `npx` を利用する

公式の標準的な Codex 設定は簡潔だが、ホスト上で Node.js、npm、Playwright を実行しないというリポジトリ規約に反するため採用しない。

## Codex 設定

`.codex/config.toml` に `mcp_servers.playwright` を追加する。

- `command` は `docker` とする。
- `args` は、`docker run -i --rm --init`、ホストネットワーク、digest 固定した公式イメージ、および Playwright MCP の制限オプションを表現する。
- `enabled = true` を明示する。
- 初回のイメージ取得や Chromium 起動を考慮し、`startup_timeout_sec = 120` とする。
- 画面遷移やローカルスタックの応答待ちを考慮し、`tool_timeout_sec = 120` とする。
- `required` は有効にしない。Docker が一時的に利用できない場合でも Codex 自体は起動できるようにする。

イメージの digest は実装時に公式イメージから取得し、設定と設計の意図どおり manifest digest 形式で固定する。`latest` や暗黙の可変タグは保存しない。

## ブラウザーとネットワーク

Docker 版 Playwright MCP がサポートするヘッドレス Chromium を使用する。コンテナは `--network host` で起動し、現在の Linux 開発環境で `127.0.0.1` に公開されたローカルスタックへ接続する。

Playwright MCP は `--isolated` で起動し、セッション間で Cookie、Local Storage、認証状態を永続化しない。リポジトリやホストディレクトリはコンテナへマウントしないため、ファイルアップロードやホストファイル参照は今回の対象外とする。

ブラウザーの許可オリジンは、既存 Compose 構成で利用する次のローカル URL に限定する。

- `http://127.0.0.1:5173`: Vite アプリ
- `http://127.0.0.1:8000`: Supabase API
- `ws://127.0.0.1:8000`: Supabase Realtime
- `http://127.0.0.1:8025`: Mailpit UI
- `http://127.0.0.1:8788`: OAuth mock

外部 URL は Playwright MCP の許可オリジン設定で拒否する。ただし Playwright MCP の公式説明どおり、この許可設定は完全なセキュリティ境界ではなく、リダイレクトも制御対象外である。今回はローカル環境の誤操作を防ぐガードレールとして使用し、外部サイトの調査用途には使用しない。

## データと状態

MCP サーバーは Codex が必要に応じて起動し、接続終了時に `--rm` でコンテナを削除する。`--isolated` によりブラウザー状態も破棄する。追加の永続ボリューム、認証情報ファイル、環境変数、シークレットは導入しない。

## エラー処理

- Docker デーモンが停止している、またはイメージを取得できない場合、Playwright MCP の起動は失敗するが Codex の起動は妨げない。
- ローカルスタックが停止している場合、ブラウザー操作は接続エラーになる。利用前に既存の `docker compose up -d --wait` を実行する。
- 設定変更は現在の Codex セッションへ動的反映されないため、実装後に Codex を再起動するか新しいセッションを開始する。
- 外部 URL への遷移が必要になった場合も許可リストを自動的に広げず、別の設計変更として扱う。

## ドキュメント

`docs/local-development.md` に Playwright MCP の節を追加し、次を説明する。

- Docker とローカルスタックが必要であること。
- `docker compose up -d --wait` で対象アプリを起動すること。
- 設定反映には Codex の再起動または新規セッションが必要であること。
- Playwright MCP はローカル URL 専用で、ブラウザー状態を保存しないこと。
- 初回は固定済みイメージの取得が発生し得ること。

## 検証

実装後、各コマンドを独立して実行して次を確認する。

1. Codex の厳格設定読込で `.codex/config.toml` が受理される。
2. `codex mcp list` と `codex mcp get playwright` で Playwright MCP が有効な stdio サーバーとして表示される。
3. 固定した Docker イメージを取得・検査できる。
4. Playwright MCP コンテナが stdio サーバーとして起動できる。
5. ローカルスタック起動後、新しい Codex セッションから `http://127.0.0.1:5173` を開き、アクセシビリティスナップショットを取得できる。
6. 外部 HTTPS URL への遷移が許可オリジン設定で拒否される。
7. `git diff --check` が成功する。

アプリケーションコード、DB、UI、既存テストを変更しないため、Vitest、pgTAP、既存 Playwright E2E、ビルドはこの設定変更の必須検証対象外とする。

## 変更対象

- `.codex/config.toml`
- `docs/local-development.md`

設計書と実装計画以外のファイルを追加せず、`package.json`、`package-lock.json`、Compose ファイル、Dockerfile は変更しない。

## 参考資料

- [Playwright MCP README](https://github.com/microsoft/playwright-mcp)
- [Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)
