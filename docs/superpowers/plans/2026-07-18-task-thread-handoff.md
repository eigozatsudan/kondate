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
- `.superpowers/sdd/next-task.md` の存在確認、上書き、削除では、Gitの正本からworktree rootを解決し、canonical pathのworktree内制約、実ディレクトリかつ非symlinkの祖先、symlink非追従のleaf、操作直前の状態不変を確認する。確認できない場合は一切変更せずblockerとして報告する。
- 次Taskが存在する場合、検証済み `.superpowers/sdd` 内の一時ファイルからatomic renameで上書きする。存在しない親を作成する場合は各階層の作成直後に同じ安全条件を確認する。
- 次Taskが存在しない場合、安全に確認した不存在または安全条件下の削除成功時だけPlan完了へ進む。leaf非通常、祖先・解決先の検証失敗、状態変化、削除失敗はblocker解消までPlan完了を停止する。

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
4. 親エージェントは `.superpowers/sdd/next-task.md` の存在確認、上書き、削除より前に、Gitの正本からworktree rootを解決する。exact pathの祖先 `.superpowers` と `.superpowers/sdd` が実ディレクトリかつ非symlinkであり、対象のcanonical pathがworktree root内にあることを確認する。次Taskが存在し、存在しない親ディレクトリを作成する場合は、各階層を作成した直後に同じ条件を確認する。
5. 存在確認と操作ではleafと全祖先をsymlink追従しない方式で扱う。変更操作の直前に、canonical path、祖先、leaf、および検証後の状態不変を再確認する。安全条件または状態不変を確認できない場合は一切変更せず、blockerとして報告する。
6. 次Taskが存在する場合、親エージェントは検証済みの `.superpowers/sdd` 内に一時ファイルを作成し、検証済みleafへatomic renameして `.superpowers/sdd/next-task.md` を上書きする。同じ安全条件は新規作成と既存ファイルの置換の両方に適用し、次の情報だけを記録する:
   - 完了したPlan / Taskとcommit。
   - 検証、一次レビュー、二次検証の結論と未解決ブロッカー。
   - 次のPlan / Taskと、設計書、Task brief、reportのパス。
   - 次Taskが使用する確定済みinterfaceと設計判断。
   - worktree、branch、HEAD。
7. 次Taskが存在しない場合、親エージェントは安全条件を満たした確認で `.superpowers/sdd/next-task.md` が存在しないと判定できた場合、または非symlinkの通常ファイルを安全に削除できた場合だけ、Planの完了フローへ進む。leafが通常ファイルでない場合、祖先または解決先の検証失敗、検証後の状態変化、削除失敗はblockerとして報告し、解消するまでPlan完了を停止する。祖先が存在しないためleafの不存在が安全に確定する場合は、親ディレクトリを作成せず何もしない。
8. `.superpowers/sdd/next-task.md` にはraw diff、raw log、設計書本文、過去Taskの累積要約を記載しない。次Taskの新規スレッドには引き継ぎファイルと必要資料のパスだけを渡す。
9. 次Taskの新規スレッドは、引き継ぎ内容を `AGENTS.md`、`SubAgents.md`、対象Task、承認済み設計書、`.superpowers/sdd/progress.md`、`git log`、branch、HEAD、worktreeの状態と照合してから作業を始める。不一致は独自判断で補わず、親エージェントへ報告する。
10. 設計書に記載のない仕様変更を勝手に行わない。判断に迷う場合は設計書を正とし、設計書自体の不備が疑われる場合は明示的に指摘する。
```

- [ ] **Step 3: `/compact` が削除され、必要な引き継ぎ語句が存在することを確認する**

Run: `rg -n '/compact' AGENTS.md`

Expected: 終了コード1、出力なし。

Run: `rg -n '新しいサブエージェントスレッド|next-task\.md|raw diff|progress\.md|worktree root|canonical path|symlink追従|atomic rename|状態不変|Plan完了|blocker' AGENTS.md`

Expected: 新規スレッド、引き継ぎファイル、禁止内容、正本照合、パス境界、symlink非追従、atomic上書き、状態不変、fail-closedなPlan完了条件の各規則が表示される。

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

Run: `rg -n '新しいサブエージェントスレッド|next-task\.md|raw diff|progress\.md|worktree root|canonical path|symlink追従|atomic rename|状態不変|Plan完了|blocker' AGENTS.md`

Expected: 終了コード0。新規スレッド、引き継ぎファイル、禁止内容、正本照合、パス境界、symlink非追従、atomic上書き、状態不変、fail-closedなPlan完了条件の各規則が表示される。

Run: `git diff --check 285c6c0..5429ce5`

Expected: 終了コード0、出力なし。Task実装commit `5429ce5` までの固定範囲だけを検証する。

Run: `git status --short`

Expected: 終了コード0、出力なし（clean）。
