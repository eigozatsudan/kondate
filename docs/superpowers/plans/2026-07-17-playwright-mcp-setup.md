# Playwright MCP セットアップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex から Kondate のローカル開発環境だけをヘッドレス Chromium で操作できる、Docker版 Playwright MCP をプロジェクト設定へ追加し、検証を妨げる既存のブラウザーモジュール境界を修復する。

**Architecture:** 信頼済みリポジトリの `.codex/config.toml` から、manifest digest で固定した Microsoft 公式 Playwright MCP イメージを stdio コンテナとして起動する。コンテナはホストネットワーク経由で既存のループバック公開ポートへ接続し、Playwright MCP の許可オリジンと隔離ブラウザーコンテキストで用途をローカル開発に限定する。ブラウザーが共有レスポンス契約だけを読み込むよう、緊急献立の純粋なZod契約をサーバー専用フィルターから分離する。

**Tech Stack:** Codex CLI 0.144.5、TOML、Docker、Microsoft Playwright MCP、TypeScript、Zod 4、Vitest、Playwright、Markdown、Git

## Global Constraints

- 設計の正本は `docs/superpowers/specs/2026-07-17-playwright-mcp-setup-design.md` と `docs/superpowers/specs/2026-07-17-browser-entrypoint-fix-design.md` とする。
- ホスト上で Node.js、npm、Playwright を実行しない。
- Playwright MCP は Docker 上のヘッドレス Chromium で実行する。
- 公式イメージは `mcr.microsoft.com/playwright/mcp@sha256:3d871c22ea2d4cca0966e2cfb1860e1cb03eb7353725a3d6cffd133296fb04eb` に固定し、可変タグを設定へ保存しない。
- リポジトリやホストディレクトリを Playwright MCP コンテナへマウントしない。
- ブラウザー状態は `--isolated` でセッション終了時に破棄する。
- ブラウザーの許可先は `127.0.0.1` の既存ローカルオリジンだけにする。
- `package.json`、`package-lock.json`、Compose ファイル、Dockerfile、DB スキーマ、指紋アルゴリズムは変更しない。アプリケーションコードはTask 2のブラウザー契約分離だけを変更する。
- コマンドは結合せず、1コマンドごとに独立したツール呼び出しで実行する。
- コメント、コミットメッセージ、追加ドキュメントは日本語にする。
- ユーザー所有の未コミット変更が現れた場合は変更、整形、ステージ、コミットしない。

---

## File Structure

- Modify: `.codex/config.toml` — プロジェクト単位の Playwright MCP stdio サーバー定義を管理する。
- Modify: `docs/local-development.md` — 開発者向けの起動条件、利用方法、ローカル限定の制約を説明する。
- Create: `shared/emergency/contracts.ts` — ブラウザーとサーバーが共有する緊急献立レスポンス契約だけを管理する。
- Create: `shared/emergency/contracts.test.ts` — 契約のparse動作とサーバー専用依存の非混入を固定する。
- Modify: `shared/emergency/filter-emergency-menus.ts` — サーバー専用フィルターから共有契約定義を分離する。
- Modify: `src/features/emergency/emergency-menu-api.ts` — ブラウザー安全な契約モジュールを直接利用する。
- Modify: `src/features/emergency/emergency-menu-page.tsx` — ブラウザー安全なDTO型を直接利用する。
- Modify: `netlify/functions/emergency-menus.ts` — 共有契約とサーバーフィルターの責務分離に追従する。
- Modify: `e2e/specs/foundation.spec.ts` — ブラウザー起動時のpage errorがないことを回帰検証する。

---

### Task 0: 既存 AGENTS.md のフォーマット是正

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: リポジトリ既定のPrettier設定と、ユーザーが明示的に承認したフォーマットのみの変更。
- Produces: 内容と指示の意味を維持した、`npm run format:check` に合格する `AGENTS.md`。

- [ ] **Step 1: 既知のフォーマット不一致を再現する**

Run:

```bash
docker compose run --rm --no-deps app npx prettier --check AGENTS.md
```

Expected: 終了コード1で `AGENTS.md` のフォーマット不一致だけが表示される。

- [ ] **Step 2: Prettierで対象ファイルだけを整形する**

Run:

```bash
docker compose run --rm --no-deps app npx prettier --write AGENTS.md
```

Expected: `AGENTS.md` だけが整形される。

- [ ] **Step 3: 指示内容が変わっていないことを確認する**

Run: `git diff --word-diff=plain -- AGENTS.md`

Expected: Markdownの折り返しや空白だけが変わり、コマンド、順序、要件、禁止事項、見出し、意味のある文言は変わらない。

- [ ] **Step 4: フォーマットと差分を検証する**

Run:

```bash
docker compose run --rm --no-deps app npx prettier --check AGENTS.md
```

Expected: `All matched files use Prettier code style!`

Run: `git diff --check -- AGENTS.md`

Expected: 出力なし、終了コード0。

- [ ] **Step 5: Task 0をコミットする**

Run: `git add AGENTS.md`

Run: `git commit -m "style: AGENTS.mdを整形"`

作者情報が未設定で失敗した場合だけ、次を実行する。

```bash
git -c user.name=takahashi -c user.email=tkhstmykii@gmail.com commit -m "style: AGENTS.mdを整形"
```

Expected: `AGENTS.md` だけを含む日本語Conventional Commitが作成される。

- [ ] **Step 6: Task 0完了後のコンテキスト整理と照合レビューを行う**

親エージェントが `/compact` を実行する。整形前後のword diffを照合し、指示内容が変わっていないことを確認する。意味のある変更があればTask 1へ進まず元へ戻して再整形する。

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

### Task 2: ブラウザー安全な緊急献立契約の分離

**Files:**
- Create: `shared/emergency/contracts.ts`
- Create: `shared/emergency/contracts.test.ts`
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`
- Modify: `src/features/emergency/emergency-menu-api.ts`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `netlify/functions/emergency-menus.ts`
- Modify: `e2e/specs/foundation.spec.ts`

**Interfaces:**
- Consumes: `validatedMenuSchema`、`labelSourceTypes` と既存の緊急献立レスポンス形状。
- Produces: ブラウザー安全な `emergencyMenusDataSchema`、`EmergencyMenusData`、`EmergencyMenuCandidate`、`EmergencyLabelWarning`。サーバーフィルターは同じ契約を利用し、`node:*` 依存をブラウザーへ公開しない。

- [ ] **Step 1: 契約モジュールのREDテストを追加する**

`shared/emergency/contracts.test.ts` を次の内容で作成する。完全な候補値は既存factoryを使い、契約ファイル自体のimport境界も検証する。

```ts
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { emergencyMenusDataSchema } from "./contracts.js";

it("完全な緊急献立レスポンスを検証する", () => {
  expect(
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-11.v1",
      candidates: [
        {
          menu: makeValidatedMenu(),
          memberLabels: {},
          allergenLabels: {},
          labelWarnings: [],
        },
      ],
      message: "AIを使わない15分緊急献立です",
      consumesAiQuota: false,
    }).candidates,
  ).toHaveLength(1);
});

it("サーバー専用モジュールへ依存しない", async () => {
  const source = await readFile(new URL("./contracts.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(
    /filter-emergency-menus|validate-generated-menu|fingerprint|node:/u,
  );
});
```

- [ ] **Step 2: 契約テストが期待どおり失敗することを確認する**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency/contracts.test.ts
```

Expected: 終了コード1。`./contracts.js` を解決できないため失敗し、テスト記述やfixture生成の別エラーではない。

- [ ] **Step 3: 既存ブラウザー障害をREDとして保存する**

main側スタックをボリューム削除なしで停止・コンテナ削除してからworktree側スタックを起動する。各コマンドは独立して実行する。

Run from `/home/dev/projects/kondate`:

```bash
docker compose down
```

Run from this worktree:

```bash
docker compose up -d --wait
```

Run:

```bash
./scripts/run-e2e.sh e2e/specs/foundation.spec.ts --project=desktop-chromium
```

Expected: main側の名前付きボリュームを残したまま固定名コンテナが削除され、worktree側スタックがhealthyになる。E2Eは終了コード1で、保存したPlaywrightログまたはpage errorに `node:crypto` と `createHash` が含まれる。別の失敗なら実装へ進まず再調査する。

- [ ] **Step 4: 純粋な共有契約を作成する**

`shared/emergency/filter-emergency-menus.ts` にある次の定義を、実装内容を変えず `shared/emergency/contracts.ts` へ移す。

```ts
import { z } from "zod";
import { labelSourceTypes, validatedMenuSchema } from "../contracts/generation.js";

const memberRefSchema = z.string().regex(/^member_[1-9][0-9]*$/u);
const allergenIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const humanTextSchema = z.string().trim().min(1).max(300);

export const emergencyLabelWarningSchema = z
  .object({
    sourceType: z.enum(labelSourceTypes),
    sourceId: z.uuid(),
    sourcePath: z.string().trim().min(1).max(200),
    sourceDisplayName: humanTextSchema,
    allergenId: allergenIdSchema,
    allergenDisplayName: humanTextSchema,
    anonymousMemberRef: memberRefSchema,
    memberDisplayName: humanTextSchema,
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.literal("pending"),
  })
  .strict();

export const emergencyMenuCandidateSchema = z
  .object({
    menu: validatedMenuSchema,
    memberLabels: z.record(memberRefSchema, humanTextSchema),
    allergenLabels: z.record(allergenIdSchema, humanTextSchema),
    labelWarnings: z.array(emergencyLabelWarningSchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const requiredRefs = new Set(value.menu.adaptations.map((item) => item.anonymousMemberRef));
    for (const ref of requiredRefs) {
      if (value.memberLabels[ref] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["memberLabels", ref],
          message: "対象者の表示名が必要です",
        });
      }
    }
    const requiredAllergenIds = new Set(
      value.menu.labelConfirmations.map((item) => item.allergenId),
    );
    if (
      Object.keys(value.allergenLabels).length !== requiredAllergenIds.size ||
      [...requiredAllergenIds].some((id) => value.allergenLabels[id] === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["allergenLabels"],
        message: "原材料表示確認のアレルゲン表示名が必要です",
      });
    }
    if (value.labelWarnings.length !== value.menu.labelConfirmations.length) {
      context.addIssue({
        code: "custom",
        path: ["labelWarnings"],
        message: "すべての原材料表示確認に人向け表示が必要です",
      });
    }
    for (const [index, confirmation] of value.menu.labelConfirmations.entries()) {
      const warning = value.labelWarnings[index];
      if (
        warning === undefined ||
        warning.sourceType !== confirmation.sourceType ||
        warning.sourceId !== confirmation.sourceId ||
        warning.sourcePath !== confirmation.sourcePath ||
        warning.sourceDisplayName !== confirmation.sourceText ||
        warning.allergenId !== confirmation.allergenId ||
        warning.allergenDisplayName !== value.allergenLabels[confirmation.allergenId] ||
        warning.anonymousMemberRef !== confirmation.anonymousMemberRef ||
        warning.memberDisplayName !== value.memberLabels[confirmation.anonymousMemberRef] ||
        warning.dictionaryVersion !== confirmation.dictionaryVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["labelWarnings", index],
          message: "原材料表示確認と人向け警告の対応が一致しません",
        });
      }
    }
  });

export const emergencyMenusDataSchema = z
  .object({
    fixtureVersion: z.string().trim().min(1),
    candidates: z.array(emergencyMenuCandidateSchema),
    message: z.string().trim().min(1),
    consumesAiQuota: z.literal(false),
  })
  .strict();

export type EmergencyLabelWarning = z.infer<typeof emergencyLabelWarningSchema>;
export type EmergencyMenuCandidate = z.infer<typeof emergencyMenuCandidateSchema>;
export type EmergencyMenusData = z.infer<typeof emergencyMenusDataSchema>;
```

`filter-emergency-menus.ts` は上記定義を削除し、先頭で次を利用する。

```ts
import {
  emergencyMenuCandidateSchema,
  type EmergencyMenuCandidate,
} from "./contracts.js";
export type {
  EmergencyLabelWarning,
  EmergencyMenuCandidate,
  EmergencyMenusData,
} from "./contracts.js";
```

- [ ] **Step 5: ブラウザーとサーバーのimport先を責務別に変更する**

`src/features/emergency/emergency-menu-api.ts` と `emergency-menu-page.tsx` は、実行時スキーマとDTO型を `@shared/emergency/contracts` からimportする。`netlify/functions/emergency-menus.ts` はDTO型を `shared/emergency/contracts.ts`、`filterEmergencyMenus` と `buildEmergencyMenuCandidate` を `filter-emergency-menus.ts` からimportする。既存API、レスポンス形状、UI文言は変更しない。

- [ ] **Step 6: GREENのfocusedテストを実行する**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run shared/emergency src/features/emergency netlify/functions/emergency-menus.test.ts
```

Expected: 対象テストがすべて成功し、終了コード0。

- [ ] **Step 7: ブラウザー回帰テストを強化してGREENを確認する**

`e2e/specs/foundation.spec.ts` の既存テストで `pageerror` を収集し、最後に空であることを検証する。

```ts
test("protects app routes and fits the active viewport", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // 既存の /pantry、/login、viewport、ボタン高さの検証はそのまま維持する。

  expect(pageErrors).toEqual([]);
});
```

Run:

```bash
./scripts/run-e2e.sh e2e/specs/foundation.spec.ts --project=desktop-chromium
```

Expected: 見出し `こんだて日和` が表示され、`/login` へ遷移し、page errorなしで終了コード0。

- [ ] **Step 8: Task 2をコミットする**

Run: `git add shared/emergency src/features/emergency/emergency-menu-api.ts src/features/emergency/emergency-menu-page.tsx netlify/functions/emergency-menus.ts e2e/specs/foundation.spec.ts`

Run: `git commit -m "fix: ブラウザー起動時のサーバー依存を分離"`

Expected: 契約分離、回帰テスト、必要なimport変更だけを含む日本語Conventional Commitが作成される。

- [ ] **Step 9: 独立Reviewerによる一次・二次レビューを行う**

一次Reviewerは設計適合性、契約の単一正本、Zod検証の完全維持、サーバー依存の非混入、悪意ある不完全レスポンス、循環依存、不要な公開APIを確認する。別の二次Reviewerは各指摘を独立再現し、妥当性と重要度を判定する。妥当なCriticalまたはImportantは単一Implementerで修正し、Step 6から再実行する。

- [ ] **Step 10: Task 2完了後のコンテキスト整理と照合レビューを行う**

親エージェントが `/compact` を実行する。ブラウザー修復設計、実装差分、RED/GREENログ、一次・二次レビューを照合する。`fingerprint.ts`、依存パッケージ、DB、UI仕様に変更があればTask 3へ進まず修正する。

---

### Task 3: MCP 動作確認、独立レビュー、提出前検証

**Files:**
- Verify: `.codex/config.toml`
- Verify: `docs/local-development.md`
- Verify: `docs/superpowers/specs/2026-07-17-playwright-mcp-setup-design.md`
- Verify: `docs/superpowers/specs/2026-07-17-browser-entrypoint-fix-design.md`

**Interfaces:**
- Consumes: Task 1 が登録した MCP server id `playwright`、Task 2 が復旧したブラウザーエントリーポイント、固定Dockerイメージ、稼働中のローカルスタック。
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
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_snapshot","arguments":{}}}
```

Expected: id 1がMCPサーバー情報を返す。id 2がローカルURLへの遷移に成功する。id 3のYAMLアクセシビリティスナップショットに、静的titleだけでなく表示中の見出し `こんだて日和` と操作要素が含まれる。

- [ ] **Step 5: 外部URLが拒否されることを確認する**

同じstdinへ次のJSONを送信する。

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}
```

Expected: id 4がエラーまたはエラー内容を持つ結果を返し、`https://example.com` が許可オリジン外であるためページ内容を取得しない。

- [ ] **Step 6: MCPセッションを正常終了する**

同じstdinへ次のJSONを送信し、続いてstdinへEOFを送る。

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"browser_close","arguments":{}}}
```

Expected: id 5が成功し、EOF後にコンテナが終了して `--rm` により削除される。

- [ ] **Step 7: 新しいCodexセッションからMCP統合を確認する**

対話承認を持たない一時セッションに限り、MCPツール呼び出しの承認要求を自動レビューへ送る設定上書きを使う。ファイルとシェルは読み取り専用sandboxで禁止したままにする。

Run:

```bash
codex --strict-config -c 'approval_policy="on-request"' -c 'approvals_reviewer="auto_review"' exec --ephemeral --sandbox read-only --json 'Playwright MCPだけを使用し、http://127.0.0.1:5173/ を開いてbrowser_snapshotを取得してください。ファイル編集やシェル実行は禁止です。最後にURL、タイトル、主要な見出しと操作要素、コンソールエラーの有無を報告してください。'
```

Expected: JSONLに `server: "playwright"` の `browser_navigate` と `browser_snapshot` 成功イベントが含まれ、最終報告にURL、`こんだて日和`、意味のある操作要素、コンソールエラー0件が含まれる。`user cancelled MCP tool call`、`about:blank`、空のYAMLスナップショットは失敗として扱う。

- [ ] **Step 8: 一次レビューを独立Reviewerへ委譲する**

読み取り専用Reviewerへ、承認済み設計書、Task 1コミット、`.codex/config.toml`、`docs/local-development.md` を渡す。次の観点を必須とする。

```text
設計適合性、固定digest、Docker stdio引数、ホストネットワークの必要性と危険性、
許可オリジンの過不足、リダイレクトを含む制限の限界、ブラウザー状態とファイル共有、
既存Codex設定への回帰、悪意あるURL・入力、タイムアウト、文書の正確性を確認してください。
指摘はCritical、Important、Minorに分類し、ファイルと行、再現条件、推奨修正を示してください。
リポジトリは変更しないでください。
```

Expected: 根拠付きレビュー報告。親エージェントが差分と設計書を直接確認してから採否を判断する。

- [ ] **Step 9: 一次指摘を別Reviewerで二次検証する**

一次Reviewerとコンテキストを共有しない別の読み取り専用Reviewerへ、同じ設計書・差分と一次報告を渡す。

```text
一次レビューの各指摘を独立に再現し、妥当、誤検知、重要度変更を判定してください。
一次レビューが見落としたCriticalまたはImportantがないかも、ローカル限定要件と
Playwright MCPのセキュリティ境界ではない性質を中心に確認してください。
リポジトリは変更しないでください。
```

Expected: 各指摘の検証結果。妥当なCriticalまたはImportantが残る場合は単一Implementerでまとめて修正し、focused検証後にStep 8から再実行する。修正は別の日本語Conventional Commitにする。

- [ ] **Step 10: 必須検証1〜4を順番に実行する**

各コマンドを独立して実行する。

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: 終了コード0。既存の対象外ファイルだけが原因で失敗する場合も、提出前必須検証として未解決のまま扱い、原因と対応をユーザーへ明示する。

Run: `docker compose run --rm --no-deps app npm run lint`

Expected: 終了コード0。

Run: `docker compose run --rm --no-deps app npm run typecheck`

Expected: 終了コード0。

Run: `docker compose run --rm --no-deps app npx vitest run`

Expected: 全テスト成功、終了コード0。

- [ ] **Step 11: 必須検証5〜7を順番に実行する**

Run: `./scripts/reset-local-db.sh`

Expected: ローカルDBを再作成し、スタックがhealthy、migrateが終了コード0になる。

Run: `docker compose --profile test run --rm db-test`

Expected: pgTAPテストがすべて成功し、終了コード0。

Run: `./scripts/run-e2e.sh`

Expected: E2Eテストがすべて成功し、通常のAuthとappの復元にも成功する。

- [ ] **Step 12: 必須検証8〜9を順番に実行する**

Run: `docker compose run --rm --no-deps app npm run build`

Expected: TypeScriptチェックとVite本番ビルドが成功し、終了コード0。

Run: `git diff --check`

Expected: 出力なし、終了コード0。

いずれかが失敗した場合、原因を特定して修正し、失敗したステップ以降を順番どおり再実行する。今回と無関係な既存不具合を独断で変更しない。

- [ ] **Step 13: 最終状態を確認する**

Run: `git status --short --branch`

Expected: Playwright MCPの実装と必要なレビュー修正がコミット済みで、意図しない未コミット変更がない。設計・計画コミットと実装コミットが `origin/main` より先行していることは許容する。

Run: `git log -5 --oneline`

Expected: `feat: Playwright MCPを追加` と、必要な場合だけレビュー修正コミットが表示される。

- [ ] **Step 14: main側のローカルスタックを復元する**

Run from this worktree:

```bash
docker compose down
```

Expected: worktree側の名前付きボリュームを削除せず、worktree側コンテナが停止・削除される。

Run from `/home/dev/projects/kondate`:

```bash
docker compose up -d --wait
```

Expected: main側の既存名前付きボリュームを再利用し、元のローカルスタックがhealthyになる。

- [ ] **Step 15: Task 3 完了後のコンテキスト整理と最終照合を行う**

親エージェントが `/compact` を実行する。承認済み設計書、実装差分、MCPスモークテスト、一次・二次レビュー、必須検証結果を照合し、未解決のCriticalまたはImportantがなく、外部URL拒否とローカル画面取得の証拠が揃っていることを確認して完了報告する。Codexの現在セッションには新しいMCPが動的追加されないため、ユーザーへ再起動または新規セッション開始が必要であることを明記する。
