# Playwright MCP セットアップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex から Kondate のローカル開発環境だけをヘッドレス Chromium で操作できる、Docker版 Playwright MCP をプロジェクト設定へ追加する。

**Architecture:** 信頼済みリポジトリの `.codex/config.toml` から、manifest digest で固定した Microsoft 公式 Playwright MCP イメージを stdio コンテナとして起動する。コンテナはホストネットワーク経由で既存のループバック公開ポートへ接続し、Playwright MCP の許可オリジンと隔離ブラウザーコンテキストで用途をローカル開発に限定する。

**Tech Stack:** Codex CLI 0.144.5、TOML、Docker、Microsoft Playwright MCP、Markdown、Git

## Global Constraints

- 設計の正本は `docs/superpowers/specs/2026-07-17-playwright-mcp-setup-design.md` とする。
- ホスト上で Node.js、npm、Playwright を実行しない。
- Playwright MCP は Docker 上のヘッドレス Chromium で実行する。
- 公式イメージは `mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb` に固定し、可変タグを設定へ保存しない。
- リポジトリやホストディレクトリを Playwright MCP コンテナへマウントしない。
- ブラウザー状態は `--isolated` でセッション終了時に破棄する。
- ブラウザーの許可先は `127.0.0.1` の既存ローカルオリジンだけにする。
- `package.json`、`package-lock.json`、Compose ファイル、Dockerfile、アプリケーションコード、DB スキーマは変更しない。
- コマンドは結合せず、1コマンドごとに独立したツール呼び出しで実行する。
- コメント、コミットメッセージ、追加ドキュメントは日本語にする。
- ユーザー所有の未コミット変更が現れた場合は変更、整形、ステージ、コミットしない。

---

## File Structure

- Modify: `.codex/config.toml` — プロジェクト単位の Playwright MCP stdio サーバー定義を管理する。
- Modify: `docs/local-development.md` — 開発者向けの起動条件、利用方法、ローカル限定の制約を説明する。

---

### Task 1: Playwright MCP のプロジェクト設定と利用手順

**Files:**
- Modify: `.codex/config.toml`
- Modify: `docs/local-development.md`

**Interfaces:**
- Consumes: Docker Engine、ホストネットワーク、既存ローカルスタックの `127.0.0.1:5173`、`:8000`、`:8025`、`:8788`。
- Produces: Codex MCP server id `playwright`。stdio command は `docker`、起動タイムアウトは120秒、ツールタイムアウトは120秒。

- [ ] **Step 1: 作業ツリーと既存設定を確認する**

Run: `git status --short --branch`

Expected: 実装対象外の未コミット変更がない。変更がある場合は所有者と対象を確認し、以降のステージ対象から除外する。

Run: `sed -n '1,160p' .codex/config.toml`

Expected: `default_permissions = ":workspace"` が存在し、`mcp_servers.playwright` はまだ存在しない。

- [ ] **Step 2: Playwright MCP 未登録のRED状態を確認する**

Run: `codex mcp get playwright --json`

Expected: 終了コード1で、`playwright` というMCPサーバーが存在しない旨が表示される。

- [ ] **Step 3: 固定した公式イメージを取得する**

Run:

```bash
docker pull mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb
```

Expected: manifest listから現在のプラットフォーム向けイメージを取得し、終了コード0になる。

- [ ] **Step 4: Playwright MCP 設定を追加する**

`.codex/config.toml` を次の完全な内容にする。

```toml
# リポジトリ内の通常作業を許可し、境界外の操作は既存の承認フローに委ねる。
default_permissions = ":workspace"

# ブラウザー状態を残さず、既存のローカル開発用オリジンだけを操作対象にする。
[mcp_servers.playwright]
command = "docker"
args = [
  "run",
  "-i",
  "--rm",
  "--init",
  "--network",
  "host",
  "mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb",
  "--headless",
  "--browser",
  "chromium",
  "--no-sandbox",
  "--isolated",
  "--allowed-origins",
  "http://127.0.0.1:5173;ws://127.0.0.1:5173;http://127.0.0.1:8000;ws://127.0.0.1:8000;http://127.0.0.1:8025;http://127.0.0.1:8788",
]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 120
```

- [ ] **Step 5: Codex が設定を厳格読込できることを確認する**

Run: `codex --strict-config doctor --summary`

Expected: `Configuration` の `config` が `loaded`。ネットワーク到達性や既存state DBなど、設定以外のDoctor失敗はログで分離する。

- [ ] **Step 6: Playwright MCP の実効設定を確認する**

Run: `codex mcp get playwright --json`

Expected: 終了コード0。JSONに `"transport": { "type": "stdio" }` 相当のstdio設定、`"command": "docker"`、固定digest、`"enabled": true`、120秒の起動・ツールタイムアウトが含まれる。

Run: `codex mcp list --json`

Expected: `playwright` と既存の `openaiDeveloperDocs` がどちらも有効であり、既存サーバーが削除されていない。

- [ ] **Step 7: 固定イメージが実行可能であることを確認する**

Run:

```bash
docker run --rm mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb --help
```

Expected: 終了コード0で Playwright MCP のCLIオプションが表示され、`--headless`、`--allowed-origins`、`--isolated` が含まれる。

- [ ] **Step 8: ローカル開発手順を追記する**

`docs/local-development.md` の「通常の検証」の前に次の節を追加する。

````markdown
## Codex から Playwright MCP を使う

Playwright MCP は、Docker 上のヘッドレス Chromium からローカル開発環境だけを操作します。ブラウザー状態はセッション終了時に破棄され、リポジトリやホストのファイルはコンテナへ共有されません。

初回は、`.codex/config.toml` に固定された公式 Playwright MCP イメージの取得が発生することがあります。ローカルスタックを起動してから、Codexを再起動するか新しいセッションを開始してください。

```bash
docker compose up -d --wait
```

利用時はCodexへ、Playwright MCPで `http://127.0.0.1:5173` を確認するよう依頼します。アクセス許可はViteアプリ、Supabase、Mailpit、OAuth mockの既存ローカルオリジンに限定されています。外部Webサイトの調査には使用しないでください。
````

- [ ] **Step 9: 変更ファイルのフォーマットを検証する**

Run:

```bash
docker compose run --rm --no-deps app npx prettier --check docs/local-development.md
```

Expected: `All matched files use Prettier code style!`

Run: `git diff --check -- .codex/config.toml docs/local-development.md`

Expected: 出力なし、終了コード0。

- [ ] **Step 10: Task 1 の差分を確認する**

Run: `git diff -- .codex/config.toml docs/local-development.md`

Expected: Playwright MCP定義とローカル開発手順だけが表示され、パッケージ、Compose、Dockerfile、アプリケーション、DBの変更がない。

- [ ] **Step 11: Task 1 をコミットする**

Run: `git add .codex/config.toml docs/local-development.md`

Run: `git commit -m "feat: Playwright MCPを追加"`

Expected: 2ファイルだけを含む日本語Conventional Commitが作成される。

作者情報が未設定で失敗した場合だけ、リポジトリ設定を変更せず、確認済みの直近コミット作者を今回のコミットへ一時指定する。

Run:

```bash
git -c user.name=takahashi -c user.email=tkhstmykii@gmail.com commit -m "feat: Playwright MCPを追加"
```

Expected: 2ファイルだけを含むコミットが作成され、`git config --local --list` に作者設定を追加しない。

- [ ] **Step 12: Task 1 完了後のコンテキスト整理と照合レビューを行う**

親エージェントが `/compact` を実行する。続いて承認済み設計書、`.codex/config.toml`、`docs/local-development.md` を照合し、digest、ローカル許可オリジン、隔離状態、変更対象が一致することを確認する。不一致があればTask 2へ進まずTask 1で修正する。

---

### Task 2: MCP 動作確認、独立レビュー、提出前検証

**Files:**
- Verify: `.codex/config.toml`
- Verify: `docs/local-development.md`
- Verify: `docs/superpowers/specs/2026-07-17-playwright-mcp-setup-design.md`

**Interfaces:**
- Consumes: Task 1 が登録した MCP server id `playwright`、固定Dockerイメージ、稼働中のローカルスタック。
- Produces: ローカル画面取得、外部URL拒否、独立レビュー、リポジトリ必須検証の証拠。

- [ ] **Step 1: 承認済みスクリプトの差分がないことを確認する**

Run: `git diff -- scripts/reset-local-db.sh scripts/run-e2e.sh`

Expected: 出力なし。差分がある場合はスクリプトの破壊的操作、外部送信、シークレット参照を再確認するまで実行しない。

- [ ] **Step 2: ローカルスタックを起動する**

Run: `docker compose up -d --wait`

Expected: appを含むhealthcheck対象サービスがhealthy、migrateが終了コード0になる。

- [ ] **Step 3: Playwright MCP のstdioセッションを開始する**

次のコマンドをTTYなしの継続セッションとして起動する。

Run:

```bash
docker run -i --rm --init --network host mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb --headless --browser chromium --no-sandbox --isolated --allowed-origins "http://127.0.0.1:5173;ws://127.0.0.1:5173;http://127.0.0.1:8000;ws://127.0.0.1:8000;http://127.0.0.1:8025;http://127.0.0.1:8788"
```

Expected: プロセスがstdio入力待ちで継続し、即時終了しない。

- [ ] **Step 4: MCP initialize とローカル画面取得を確認する**

Step 3のstdinへ、次のJSONを1行ずつ送信する。

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"kondate-smoke-test","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"http://127.0.0.1:5173"}}}
```

Expected: id 1がMCPサーバー情報を返す。id 2が成功し、アクセシビリティスナップショットまたはページ情報に `こんだて日和` が含まれる。

- [ ] **Step 5: 外部URLが拒否されることを確認する**

同じstdinへ次のJSONを送信する。

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}
```

Expected: id 3がエラーまたはエラー内容を持つ結果を返し、`https://example.com` が許可オリジン外であるためページ内容を取得しない。

- [ ] **Step 6: MCPセッションを正常終了する**

同じstdinへ次のJSONを送信し、続いてstdinへEOFを送る。

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browser_close","arguments":{}}}
```

Expected: id 4が成功し、EOF後にコンテナが終了して `--rm` により削除される。

- [ ] **Step 7: 一次レビューを独立Reviewerへ委譲する**

読み取り専用Reviewerへ、承認済み設計書、Task 1コミット、`.codex/config.toml`、`docs/local-development.md` を渡す。次の観点を必須とする。

```text
設計適合性、固定digest、Docker stdio引数、ホストネットワークの必要性と危険性、
許可オリジンの過不足、リダイレクトを含む制限の限界、ブラウザー状態とファイル共有、
既存Codex設定への回帰、悪意あるURL・入力、タイムアウト、文書の正確性を確認してください。
指摘はCritical、Important、Minorに分類し、ファイルと行、再現条件、推奨修正を示してください。
リポジトリは変更しないでください。
```

Expected: 根拠付きレビュー報告。親エージェントが差分と設計書を直接確認してから採否を判断する。

- [ ] **Step 8: 一次指摘を別Reviewerで二次検証する**

一次Reviewerとコンテキストを共有しない別の読み取り専用Reviewerへ、同じ設計書・差分と一次報告を渡す。

```text
一次レビューの各指摘を独立に再現し、妥当、誤検知、重要度変更を判定してください。
一次レビューが見落としたCriticalまたはImportantがないかも、ローカル限定要件と
Playwright MCPのセキュリティ境界ではない性質を中心に確認してください。
リポジトリは変更しないでください。
```

Expected: 各指摘の検証結果。妥当なCriticalまたはImportantが残る場合は単一Implementerでまとめて修正し、focused検証後にStep 7から再実行する。修正は別の日本語Conventional Commitにする。

- [ ] **Step 9: 必須検証1〜4を順番に実行する**

各コマンドを独立して実行する。

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: 終了コード0。既存の対象外ファイルだけが原因で失敗する場合も、提出前必須検証として未解決のまま扱い、原因と対応をユーザーへ明示する。

Run: `docker compose run --rm --no-deps app npm run lint`

Expected: 終了コード0。

Run: `docker compose run --rm --no-deps app npm run typecheck`

Expected: 終了コード0。

Run: `docker compose run --rm --no-deps app npx vitest run`

Expected: 全テスト成功、終了コード0。

- [ ] **Step 10: 必須検証5〜7を順番に実行する**

Run: `./scripts/reset-local-db.sh`

Expected: ローカルDBを再作成し、スタックがhealthy、migrateが終了コード0になる。

Run: `docker compose --profile test run --rm db-test`

Expected: pgTAPテストがすべて成功し、終了コード0。

Run: `./scripts/run-e2e.sh`

Expected: E2Eテストがすべて成功し、通常のAuthとappの復元にも成功する。

- [ ] **Step 11: 必須検証8〜9を順番に実行する**

Run: `docker compose run --rm --no-deps app npm run build`

Expected: TypeScriptチェックとVite本番ビルドが成功し、終了コード0。

Run: `git diff --check`

Expected: 出力なし、終了コード0。

いずれかが失敗した場合、原因を特定して修正し、失敗したステップ以降を順番どおり再実行する。今回と無関係な既存不具合を独断で変更しない。

- [ ] **Step 12: 最終状態を確認する**

Run: `git status --short --branch`

Expected: Playwright MCPの実装と必要なレビュー修正がコミット済みで、意図しない未コミット変更がない。設計・計画コミットと実装コミットが `origin/main` より先行していることは許容する。

Run: `git log -5 --oneline`

Expected: `feat: Playwright MCPを追加` と、必要な場合だけレビュー修正コミットが表示される。

- [ ] **Step 13: Task 2 完了後のコンテキスト整理と最終照合を行う**

親エージェントが `/compact` を実行する。承認済み設計書、実装差分、MCPスモークテスト、一次・二次レビュー、必須検証結果を照合し、未解決のCriticalまたはImportantがなく、外部URL拒否とローカル画面取得の証拠が揃っていることを確認して完了報告する。Codexの現在セッションには新しいMCPが動的追加されないため、ユーザーへ再起動または新規セッション開始が必要であることを明記する。
