# scripts検証スクリプト自動承認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` の直接実行だけを、Codexがユーザー承認なしで実行できるようにする。

**Architecture:** `.codex/rules/default.rules` に、許可する2つの相対パスを第一引数のunionとして明示列挙する。execpolicyの肯定・否定ケースで字句上の許可境界を検証し、トップレベルから直接実行する `git push`、Gitローカル操作、Docker Composeの判定が変わらないことを確認する。許可済みスクリプトの子プロセスが再評価されないこと、カレントディレクトリを拘束しないこと、許可済みパス名のシンボリックリンクがリンク先を実行することを残存リスクとして明記する。

**Tech Stack:** Codex project configuration, Codex execpolicy rules (Starlark), shell scripts

## Global Constraints

- 設計書 `docs/superpowers/specs/2026-07-16-scripts-auto-approval-design.md` を仕様の基準とする。
- 自動承認するのは `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` の直接実行だけとする。
- 許可対象スクリプトへの後続引数は許可する。
- `sh`、`bash`、先頭の `./` を省略したパス、絶対パス、`./scripts/../...` のように許可した文字列と異なる字句形式は許可に含めない。
- `prefix_rule` はリテラルな引数列へ一致し、カレントディレクトリやリポジトリルートを拘束しないため、別のカレントディレクトリにある同じ `./scripts/...` 形式も許可する。
- 許可済みのパス名をシンボリックリンクへ置き換えた場合もルールに一致し、リンク先を実行する。
- ユーザーは2026-07-16にこの2つの残存リスクを明示的に受容し、相対パスのルールを維持する選択肢を選んだ。
- `scripts/` のその他の既存スクリプトと今後追加されるスクリプトは許可に含めない。
- `./scripts/run-tooling-git.sh` を許可に含めず、トップレベルから直接実行する `git push` の毎回承認を維持する。
- 許可対象の変更可能なスクリプトは、その子プロセスが行う操作も含めて実行を許可する。
- 子プロセスの `git push` はexecpolicyで再評価されず、許可対象スクリプトの変更によって承認を迂回できる。
- `./scripts/run-tooling-git.sh` の個別除外は、許可済みの変更可能なスクリプトを経由する一般的な迂回可能性を解消しない。
- ユーザーは2026-07-16にこの残存リスクを明示的に受容し、2スクリプトの自動承認を維持する選択肢を選んだ。
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

以下のコメントは字句上の相対パスargvだけを説明する。`prefix_rule` 自体はカレントディレクトリを検証しないため、別のカレントディレクトリにある同じ相対パスにも一致する。

```python

# 最終検証で使用する信頼済みスクリプトに限り、列挙した2つのリテラルな相対パスargvによる直接実行を承認待ちなしで利用できるようにする。
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

Expected: JSONの `decision` が `"allow"` で、`matchedPrefix` が `["./scripts/reset-local-db.sh"]` になる。この静的判定はカレントディレクトリを入力に取らない。

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

Expected: トップレベルから直接実行するこのコマンドは、JSONの `decision` が `"prompt"` になる。許可済みスクリプト内の子プロセスとして実行する `git push` は再評価されず、同じ保証の対象外である。

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

Codexを再起動するか新しいセッションを開始し、このリポジトリが信頼済みであることを確認する。リポジトリ直下から `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` を直接実行したときに承認画面が表示されず、トップレベルから直接実行する通常の `git push` では引き続き承認画面が表示されることを、必要な操作の直前までで確認する。許可済みスクリプト内の子プロセスはこの確認の保証対象外であり、承認を迂回できる残存リスクは修正せず受容済みとして扱う。相対ルールはリポジトリ直下に限定されず、別のカレントディレクトリの同じ引数列や、許可済みパス名へ置いたシンボリックリンクにも一致する。この2つの残存リスクも修正せず、2026-07-16のユーザー判断により受容済みとして扱う。
