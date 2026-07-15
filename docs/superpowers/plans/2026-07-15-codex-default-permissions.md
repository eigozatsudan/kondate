# Codex デフォルト権限設定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** このリポジトリで Codex のワークスペース権限を既定にし、通常の `git push` だけは実行前に毎回ユーザー承認を求める。

**Architecture:** プロジェクトローカルの `.codex/config.toml` で組み込みの `:workspace` 権限プロファイルを選択する。独立した `.codex/rules/default.rules` で `git push` の引数プレフィックスだけを `prompt` と判定し、Codex CLI の execpolicy 検証で一致・不一致を確認する。

**Tech Stack:** Codex project configuration (TOML), Codex execpolicy rules (Starlark), Codex CLI 0.144.4

## Global Constraints

- プロジェクトが信頼済みの場合にだけ、プロジェクトローカルの `.codex/` 設定が有効になる。
- 既定権限は `default_permissions = ":workspace"` とする。
- 標準的な `git push` および後続引数付きの呼び出しだけを毎回 `prompt` とする。
- `git -C <path> push` や `git --git-dir=<path> push` は今回の対象外とする。
- コード内のコメントは日本語で記述する。
- アプリケーション、テスト、データベース、デプロイ設定は変更しない。

---

### Task 1: プロジェクト権限と `git push` 承認ルール

**Files:**
- Create: `.codex/config.toml`
- Create: `.codex/rules/default.rules`

**Interfaces:**
- Consumes: Codex 組み込み権限プロファイル `:workspace`、`prefix_rule()` の `pattern`・`decision`・`justification`・`match`・`not_match`
- Produces: このリポジトリで有効になる既定権限と、`git push` に対する `prompt` 判定

- [ ] **Step 1: `git push` の承認ルールとインライン検証例を追加する**

`.codex/rules/default.rules` を次の内容で作成する。

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
```

- [ ] **Step 2: ルール単体を検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push origin main
```

Expected: どちらも JSON の `decision` が `"prompt"` になり、追加したルールが一致する。

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git pull
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git status
```

Expected: どちらも追加した `git push` ルールに一致せず、JSON の `matchedRules` が空になる。

- [ ] **Step 3: ワークスペース権限をプロジェクトの既定値にする**

`.codex/config.toml` を次の内容で作成する。

```toml
# リポジトリ内の通常作業を許可し、境界外の操作は既存の承認フローに委ねる。
default_permissions = ":workspace"
```

- [ ] **Step 4: プロジェクト設定と変更内容を検証する**

Run:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git push
git diff --check
git diff -- .codex/config.toml .codex/rules/default.rules
```

Expected: Codex がプロジェクト設定を構文エラーなく読み込み、`git push` の `decision` が `"prompt"`、`git diff --check` が終了コード 0 になり、差分が設計どおりの2ファイルだけを示す。

- [ ] **Step 5: 設定をコミットする**

```bash
git add .codex/config.toml .codex/rules/default.rules
git commit -m "chore: Codexのプロジェクト権限を設定"
```

Expected: `.codex/config.toml` と `.codex/rules/default.rules` だけを含む新しいコミットが作成される。

- [ ] **Step 6: 利用時の反映条件を確認する**

Codex を再起動するか新しいセッションを開始し、このリポジトリが信頼済みであることを確認する。通常の `git push` を実行する際に承認画面が表示されることを、実際の push は承認せずに確認する。
