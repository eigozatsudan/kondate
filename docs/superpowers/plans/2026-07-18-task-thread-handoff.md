# Task別サブエージェントスレッド引き継ぎ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実行不能な `/compact` 指示を、Taskごとの新規サブエージェントスレッドと短いファイル引き継ぎへ置き換える。

**Architecture:** 親セッションはcontrollerとして維持し、各TaskではImplementer、Verifier、Reviewerの役割ごとに新しいサブエージェントスレッドを使用する。Task間の状態はGit管理外の単一ファイル `.superpowers/sdd/next-task.md` に必要最小限だけ記録し、次Taskのスレッドは正本との照合後に作業を始める。

**Tech Stack:** Markdown、Codex multi-agent、Git

## Global Constraints

- `AGENTS.md` の「実装の進め方」にある `/compact` 指示を置き換える。
- `SubAgents.md` が定めるTask brief、report、review package、progress ledger、レビュー、Verifier、single-writerの規則は変更しない。
- トップレベルのCodexセッションは新規作成しない。
- raw diff、raw log、設計書本文、過去Taskの累積要約は引き継ぎファイルへ記載しない。
- 次Taskが存在しない場合、exact path `.superpowers/sdd/next-task.md` は非symlinkの通常ファイルだけを削除して失効させ、不存在なら何もせず、その他のファイル種別は削除せずblockerとして報告する。

---

### Task 1: AGENTS.mdのTask境界運用を更新

**Files:**
- Modify: `AGENTS.md:53`
- Reference: `SubAgents.md`
- Reference: `docs/superpowers/specs/2026-07-18-task-thread-handoff-design.md`

**Interfaces:**
- Consumes: `SubAgents.md` の役割分離、レビュー、検証、progress ledger、single-writer規則
- Produces: Taskごとのfresh subagent threadと `.superpowers/sdd/next-task.md` を使うリポジトリ共通運用

- [ ] **Step 1: Implementerが現行ルールの実行不能な `/compact` 要求を変更前に確認する**

このStepは変更前の状態に依存するImplementer専用の確認とし、commit後のVerifierは実行しない。

Run: `rg -n '/compact|各 Task 完了ごと' AGENTS.md`

Expected: `AGENTS.md` の「各 Task 完了ごとに」に `/compact` が表示される。

- [ ] **Step 2: 「実装の進め方」を新しいスレッド・引き継ぎ規則へ置き換える**

`AGENTS.md` の `## 4. 実装の進め方` を次の内容にする。

```markdown
## 4. 実装の進め方

1. 実装は **Plan 単位**で管理し、各 Plan 内の **Task を1つずつ順番に**進める。
2. 各Taskでは、`SubAgents.md` が定める役割ごとに**新しいサブエージェントスレッド**を使用する。完了したTaskのImplementer、Verifier、Reviewerの各スレッドを次Taskへ再利用しない。
3. **各 Task 完了ごとに**、直前のTaskの変更が次のTaskに悪影響を与えていないか、**コードベースと設計書を照合してレビュー**し、必要なら修正する。レビューと検証が完了するまで次Taskを開始しない。
4. 次Taskが存在する場合、親エージェントは `.superpowers/sdd/next-task.md` を上書きし、次の情報だけを記録する:
   - 完了したPlan / Taskとcommit。
   - 検証、一次レビュー、二次検証の結論と未解決ブロッカー。
   - 次のPlan / Taskと、設計書、Task brief、reportのパス。
   - 次Taskが使用する確定済みinterfaceと設計判断。
   - worktree、branch、HEAD。
5. 次Taskが存在しない場合、親エージェントはexact path `.superpowers/sdd/next-task.md` が通常ファイルであり、かつsymlinkでないことを確認してから削除し、古い引き継ぎを失効させる。パスが存在しない場合は何もしない。symlink、directory、その他の通常ファイルでない場合は削除せず、blockerとして報告する。
6. `.superpowers/sdd/next-task.md` にはraw diff、raw log、設計書本文、過去Taskの累積要約を記載しない。次Taskの新規スレッドには引き継ぎファイルと必要資料のパスだけを渡す。
7. 次Taskの新規スレッドは、引き継ぎ内容を `AGENTS.md`、`SubAgents.md`、対象Task、承認済み設計書、`.superpowers/sdd/progress.md`、`git log`、branch、HEAD、worktreeの状態と照合してから作業を始める。不一致は独自判断で補わず、親エージェントへ報告する。
8. 設計書に記載のない仕様変更を勝手に行わない。判断に迷う場合は設計書を正とし、設計書自体の不備が疑われる場合は明示的に指摘する。
```

- [ ] **Step 3: `/compact` が削除され、必要な引き継ぎ語句が存在することを確認する**

Run: `rg -n '/compact' AGENTS.md`

Expected: 終了コード1、出力なし。

Run: `rg -n '新しいサブエージェントスレッド|next-task\.md|raw diff|progress\.md|次Taskが存在しない|symlink|blocker' AGENTS.md`

Expected: 新規スレッド、引き継ぎファイル、禁止内容、正本照合、安全な失効、非通常ファイルのblocker報告の各規則が表示される。

- [ ] **Step 4: Markdown差分を検証する**

Run: `git diff --check`

Expected: 終了コード0、出力なし。

Run: `git diff -- AGENTS.md`

Expected: `## 4. 実装の進め方` だけが設計どおりに変更され、`SubAgents.md` を含む他ファイルに変更がない。この未コミットdiff確認はImplementer専用とし、commit後のVerifierは実行しない。

- [ ] **Step 5: 変更をコミットする**

Run: `git add AGENTS.md`

Run: `git commit -m "docs: Task間の引き継ぎ運用を更新"`

Expected: `AGENTS.md` の変更だけを含む日本語Conventional Commitが作成される。

- [ ] **Step 6: Verifierがcommit後も安定する確認を独立して実行する**

Run: `rg -n '/compact' AGENTS.md`

Expected: 終了コード1、出力なし。

Run: `rg -n '新しいサブエージェントスレッド|next-task\.md|raw diff|progress\.md|次Taskが存在しない|symlink|blocker' AGENTS.md`

Expected: 終了コード0。新規スレッド、引き継ぎファイル、禁止内容、正本照合、安全な失効、非通常ファイルのblocker報告の各規則が表示される。

Run: `git diff --check 285c6c0..5429ce5`

Expected: 終了コード0、出力なし。Task実装commit `5429ce5` までの固定範囲だけを検証する。

Run: `git status --short`

Expected: 終了コード0、出力なし（clean）。
