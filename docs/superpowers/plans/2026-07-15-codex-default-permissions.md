# Codex デフォルト権限設定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** このリポジトリで `git push` の毎回承認を維持しながら、`git worktree` の全サブコマンド、`git add`、`git commit`、`docker compose run` を承認なしで実行できるようにする。

**Architecture:** 既存の `.codex/config.toml` と `git push` の `prompt` ルールは変更しない。`.codex/rules/default.rules` の限定的な `allow` ルールでworktree管理、ステージ、ローカルコミット、一時コンテナ実行を許可し、Codex CLI のexecpolicy検証で許可範囲と対象外コマンドを確認する。

**Tech Stack:** Codex project configuration (TOML), Codex execpolicy rules (Starlark), Codex CLI 0.144.4

## Global Constraints

- プロジェクトが信頼済みの場合にだけ、プロジェクトローカルの `.codex/` 設定が有効になる。
- 既定権限は `default_permissions = ":workspace"` とする。
- 標準的な `git push` および後続引数付きの呼び出しだけを毎回 `prompt` とする。
- `git -C <path> push` や `git --git-dir=<path> push` は今回の対象外とする。
- `git worktree` で始まる全サブコマンドを `allow` とする。
- `git branch` と `git switch -c` は `git worktree` の許可に含めない。
- `git add` と `git commit` を `allow` とし、リンクworktreeのGit管理領域へ書き込めるようにする。
- `git add` と `git commit` の許可は、このリポジトリを扱うすべてのCodexセッションへ適用される。
- sandbox外で動くGit hooksとclean filterを含め、リポジトリとGit設定が信頼済みであることを前提とする。
- `git reset` と `git rebase` は追加する許可に含めない。
- `docker compose run` で始まる呼び出しを `allow` とする。
- `docker compose up`、`down`、`exec` および `docker-compose run` は許可に含めない。
- Docker経由の強いホスト操作を許可するため、信頼済みのCompose構成を前提とする。
- コード内のコメントは日本語で記述する。
- アプリケーション、テスト、データベース、デプロイ設定は変更しない。

---

### Task 1: `git worktree` と `docker compose run` の自動許可

**Files:**
- Modify: `.codex/rules/default.rules`

**Interfaces:**
- Consumes: 既存の `git push` 用 `prefix_rule()`、Codex execpolicy の `allow`・`prompt` 判定
- Produces: `git worktree` と `docker compose run` の `allow` 判定、および既存の `git push` に対する `prompt` 判定

- [ ] **Step 1: 自動許可ルールとインライン検証例を追加する**

`.codex/rules/default.rules` を次の内容に更新する。

```python
# リモートリポジトリへの変更送信は外部状態を更新するため、毎回ユーザーの明示的な承認を必要とする。
prefix_rule(
    pattern = ["git", "push"],
    decision = "prompt",
    justification = "git push はリモートリポジトリを更新するため、実行前にユーザー承認が必要です",
    match = [
        "git push",
        "git push origin main",
    ],
    not_match = [
        "git pull",
        "git status",
    ],
)

# worktreeの作成から削除までを自律実行し、分離した作業環境を承認待ちなしで管理できるようにする。
prefix_rule(
    pattern = ["git", "worktree"],
    decision = "allow",
    justification = "git worktree の全サブコマンドは、このリポジトリの分離作業環境を管理するため許可されています",
    match = [
        "git worktree add -b feature/example .worktrees/example",
        "git worktree remove .worktrees/example",
    ],
    not_match = [
        "git branch feature/example",
        "git switch -c feature/example",
    ],
)

# 信頼済みのCompose構成で一時コンテナを実行する操作に限り、承認待ちなしで利用できるようにする。
prefix_rule(
    pattern = ["docker", "compose", "run"],
    decision = "allow",
    justification = "docker compose run は、信頼済みのCompose構成で一時コンテナを実行するため許可されています",
    match = [
        "docker compose run --rm app npm test",
    ],
    not_match = [
        "docker compose up -d",
        "docker compose down",
        "docker compose exec app npm test",
        "docker-compose run --rm app npm test",
    ],
)
```

- [ ] **Step 2: 自動許可ルールを検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git worktree add -b feature/example .worktrees/example
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git worktree remove .worktrees/example
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose run --rm app npm test
```

Expected: 3件とも JSON の `decision` が `"allow"` になり、追加したルールが一致する。

- [ ] **Step 3: 対象外コマンドと既存の `git push` ルールを検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git branch feature/example
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git switch -c feature/example
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose up -d
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose down
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose exec app npm test
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker-compose run --rm app npm test
```

Expected: 6件とも追加した `allow` ルールに一致せず、JSON の `matchedRules` が空になる。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push origin main
```

Expected: 2件とも JSON の `decision` が `"prompt"` になり、既存ルールの挙動が維持される。

- [ ] **Step 4: プロジェクト設定と変更内容を検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push
git diff --check
git diff -- .codex/rules/default.rules
```

Expected: Codex がプロジェクト設定とルールを構文エラーなく読み込み、`git push` の `decision` が `"prompt"`、`git diff --check` が終了コード 0 になり、差分が設計どおり `.codex/rules/default.rules` だけを示す。

- [ ] **Step 5: 設定をコミットする**

```bash
git add .codex/rules/default.rules
git commit -m "chore: Codexの許可コマンドを追加"
```

Expected: `.codex/rules/default.rules` だけを含む新しいコミットが作成される。

- [ ] **Step 6: 利用時の反映条件を確認する**

Codex を再起動するか新しいセッションを開始し、このリポジトリが信頼済みであることを確認する。`git worktree` と `docker compose run` が承認なしで実行され、通常の `git push` では承認画面が表示されることを確認する。検証では破壊的なworktree操作、コンテナ実行、実際のpushは行わず、必要な操作の直前で停止する。

### Task 2: リンクworktreeでのステージとローカルコミットの自動許可

**Files:**
- Modify: `.codex/rules/default.rules`

**Interfaces:**
- Consumes: 既存の `git push`・`git worktree`・`docker compose run` 用 `prefix_rule()`、Codex execpolicy の `allow`・`prompt` 判定
- Produces: `git add` と `git commit` の `allow` 判定、および既存ルールの判定維持

- [ ] **Step 1: 現行ルールで `git add` と `git commit` が未許可であることを確認する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git add src/example.ts
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git commit -m test
```

Expected: 2件とも JSON の `matchedRules` が空で、`decision` が出力されない。

- [ ] **Step 2: ステージとローカルコミットの自動許可ルールを追加する**

`.codex/rules/default.rules` の `git worktree` ルールの直後に、次の内容を追加する。

```python
# リンクworktreeの保護されたGit管理領域へ書き込み、変更のステージとローカルコミットを完了できるようにする。
prefix_rule(
    pattern = ["git", ["add", "commit"]],
    decision = "allow",
    justification = "git add と git commit は、信頼済みリポジトリで変更をステージしローカルコミットを作成するため許可されています",
    match = [
        "git add src/example.ts",
        "git commit -m test",
    ],
    not_match = [
        "git reset --hard",
        "git rebase main",
        "git push",
    ],
)
```

- [ ] **Step 3: 追加ルールと対象外コマンドを検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git add src/example.ts
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git add -A
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git commit -m test
```

Expected: 3件とも JSON の `decision` が `"allow"` になり、追加したルールが一致する。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git reset --hard
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git rebase main
```

Expected: 2件とも追加したルールに一致せず、JSON の `matchedRules` が空になる。

- [ ] **Step 4: 既存ルールの回帰とプロジェクトテストを検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git worktree add -b feature/example .worktrees/example
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose run --rm app npm test
git diff --check
git diff -- .codex/rules/default.rules
docker compose run --rm --no-deps app npx vitest run
```

Expected: `git push` は `"prompt"`、`git worktree add` と `docker compose run` は `"allow"`、`git diff --check` は終了コード 0、差分は `.codex/rules/default.rules` だけになり、Vitestは全件成功する。

- [ ] **Step 5: 設定をコミットする**

```bash
git add .codex/rules/default.rules
git commit --only .codex/rules/default.rules -m "chore: Codexのローカルコミットを許可"
```

Expected: `.codex/rules/default.rules` だけを含む新しいコミットが作成され、既存のステージ済み変更はコミットに含まれない。

- [ ] **Step 6: 利用時の反映条件を確認する**

Codexを再起動するか新しいセッションを開始し、このリポジトリが信頼済みであることを確認する。サブエージェントのリンクworktree内で `git add` と `git commit` が承認なしで実行され、通常の `git push` では引き続き承認画面が表示されることを確認する。
