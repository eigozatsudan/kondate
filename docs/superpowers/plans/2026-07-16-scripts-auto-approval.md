# scripts検証スクリプト自動承認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` の直接実行だけを、Codexがユーザー承認なしで実行できるようにする。

**Architecture:** `.codex/rules/default.rules` に、許可する2つの相対パスを第一引数のunionとして明示列挙する。execpolicyの肯定・否定ケースで許可境界を検証し、既存の `git push`、Gitローカル操作、Docker Composeの判定が変わらないことを確認する。

**Tech Stack:** Codex project configuration, Codex execpolicy rules (Starlark), shell scripts

## Global Constraints

- 設計書 `docs/superpowers/specs/2026-07-16-scripts-auto-approval-design.md` を仕様の基準とする。
- 自動承認するのは `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` の直接実行だけとする。
- 許可対象スクリプトへの後続引数は許可する。
- `sh`、`bash`、先頭の `./` を省略したパス、絶対パス、シンボリックリンク、別名を経由した実行は許可に含めない。
- `scripts/` のその他の既存スクリプトと今後追加されるスクリプトは許可に含めない。
- `./scripts/run-tooling-git.sh` を許可に含めず、`git push` の毎回承認を維持する。
- `bash`、`sh`、`./scripts/` ディレクトリ全体を包括的に許可しない。
- 既存の `git worktree`、`git add`、`git commit`、`docker compose run` の自動承認を維持する。
- コード内のコメントは日本語で記述する。
- ユーザーの未コミット変更 `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` を編集、ステージ、コミットしない。
- Dockerコマンドとホスト側コマンドを `&&` などで結合せず、それぞれ独立したツール呼び出しとして実行する。

---

### Task 1: 選択した検証スクリプトの自動承認

**Files:**
- Modify: `.codex/rules/default.rules`

**Interfaces:**
- Consumes: Codex execpolicyの `prefix_rule()`、既存の `git push`・Gitローカル操作・`docker compose run` の判定
- Produces: `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` の直接実行に対する `allow` 判定

- [ ] **Step 1: 現行ルールでは対象スクリプトが未許可であることを確認する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/reset-local-db.sh
```

Expected: JSONの `matchedRules` が空で、`decision` が出力されない。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/run-e2e.sh
```

Expected: JSONの `matchedRules` が空で、`decision` が出力されない。

- [ ] **Step 2: 2つの直接実行パスを許可するルールを追加する**

`.codex/rules/default.rules` の末尾に次の内容を追加する。

```python

# 最終検証で使用する信頼済みスクリプトに限り、リポジトリ直下からの直接実行を承認待ちなしで利用できるようにする。
prefix_rule(
    pattern = [["./scripts/reset-local-db.sh", "./scripts/run-e2e.sh"]],
    decision = "allow",
    justification = "選択した検証スクリプトの直接実行は、信頼済みのローカル検証を完了するため許可されています",
    match = [
        "./scripts/reset-local-db.sh",
        "./scripts/run-e2e.sh",
        "./scripts/run-e2e.sh --project chromium",
    ],
    not_match = [
        "sh ./scripts/reset-local-db.sh",
        "bash ./scripts/run-e2e.sh",
        "scripts/run-e2e.sh",
        "/home/dev/projects/kondate/scripts/run-e2e.sh",
        "./scripts/../scripts/run-e2e.sh",
        "./scripts/run-tooling-git.sh push",
    ],
)
```

- [ ] **Step 3: 許可対象と後続引数を検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/reset-local-db.sh
```

Expected: JSONの `decision` が `"allow"` で、`matchedPrefix` が `["./scripts/reset-local-db.sh"]` になる。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/run-e2e.sh
```

Expected: JSONの `decision` が `"allow"` で、`matchedPrefix` が `["./scripts/run-e2e.sh"]` になる。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/run-e2e.sh --project chromium
```

Expected: JSONの `decision` が `"allow"` で、後続引数があっても `./scripts/run-e2e.sh` のルールに一致する。

- [ ] **Step 4: 許可対象外の呼び出し形式とスクリプトを検証する**

次のコマンドを、それぞれ独立して実行する。

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- sh ./scripts/reset-local-db.sh
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- bash ./scripts/run-e2e.sh
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- scripts/run-e2e.sh
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- /home/dev/projects/kondate/scripts/run-e2e.sh
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/../scripts/run-e2e.sh
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/run-tooling-git.sh push
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- ./scripts/apply-migrations.sh
```

Expected: 7件とも追加ルールに一致せず、JSONの `matchedRules` が空になる。

- [ ] **Step 5: 既存ルールの回帰を検証する**

次のコマンドを、それぞれ独立して実行する。

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push origin main
```

Expected: JSONの `decision` が `"prompt"` になる。

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git worktree add -b feature/example .worktrees/example
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git add src/example.ts
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git commit -m test
```

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose run --rm app npm test
```

Expected: `git worktree`、`git add`、`git commit`、`docker compose run` の4件はJSONの `decision` が `"allow"` になる。

- [ ] **Step 6: リポジトリ指定の最終検証を個別に実行する**

次のコマンドを、記載順にそれぞれ独立したツール呼び出しとして実行する。

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npx vitest run
```

```bash
./scripts/reset-local-db.sh
```

```bash
docker compose --profile test run --rm db-test
```

```bash
./scripts/run-e2e.sh
```

```bash
docker compose run --rm --no-deps app npm run build
```

```bash
git diff --check
```

Expected: 9件すべて終了コード0。各検証の失敗数が0で、`git diff --check` は出力なし。

- [ ] **Step 7: 権限ルールだけをコミットする**

```bash
git add .codex/rules/default.rules
```

```bash
git commit --only .codex/rules/default.rules -m "chore: 検証スクリプトの直接実行を許可"
```

Expected: `.codex/rules/default.rules` だけを含む新しいコミットが作成され、ユーザーの未コミット変更は残る。

- [ ] **Step 8: 反映条件を確認する**

Codexを再起動するか新しいセッションを開始し、このリポジトリが信頼済みであることを確認する。リポジトリ直下から `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` を直接実行したときに承認画面が表示されず、通常の `git push` では引き続き承認画面が表示されることを、必要な操作の直前までで確認する。
