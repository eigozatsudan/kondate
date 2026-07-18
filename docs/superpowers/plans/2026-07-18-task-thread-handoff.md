# Task別サブエージェントスレッド引き継ぎ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実行不能な `/compact` 指示を、Taskごとの新規サブエージェントスレッドと短いファイル引き継ぎへ置き換える。

**Architecture:** 親セッションはcontrollerとして維持し、各TaskではImplementer、Verifier、Reviewerの役割ごとに新しいサブエージェントスレッドを使用する。Task間の状態はGit管理外の一意なwrite-once handoffに必要最小限だけ記録し、親が渡すexact pathと正本の照合後に次Taskの作業を始める。

**Tech Stack:** Markdown、Codex multi-agent、Git

## Global Constraints

- `AGENTS.md` の「実装の進め方」にある `/compact` 指示を置き換える。
- `SubAgents.md` が定めるTask brief、report、review package、progress ledger、レビュー、Verifier、single-writerの規則は変更しない。
- トップレベルのCodexセッションは新規作成しない。
- raw diff、raw log、設計書本文、過去Taskの累積要約は引き継ぎファイルへ記載しない。
- handoff運用では同一worktreeを単一のCodex親だけが操作する。同一ユーザー権限の別プロセスによる検査・作成・読取中の並行symlink、rename、内容差替えは脅威モデル外とする。
- 次Taskが存在する場合、`.superpowers/sdd/handoff-plan-<plan>-task-<completed>-to-task-<next>-<head7>.md` を実値入りの一意名で一度だけ新規作成するwrite-onceとし、既存ファイルを上書き・削除・再利用しない。
- producerはGit正本からworktree rootを解決し、全祖先の実directory・非symlink、作成先directoryのworktree内canonical path、同名leafの不存在を確認してから、通常のCodex surfaceが提供するworkspace-scoped file creationで一意fileを新規作成する。
- single-writerかつ非並行の脅威モデルによりcheck/create間の別プロセス競合を対象外とし、directory handle、descriptor helper、`O_CREAT|O_EXCL` 相当の追加capabilityを必須としない。
- 既存leafは型や内容に関係なく一切変更せずblockerとし、解消するまで次Taskの開始を停止する。
- 親は次スレッドへhandoffのexact pathだけを渡し、glob、directory listing、自動探索、mtime・名前順による最新選択を禁止する。古いhandoffは残るが自動的にauthorityとして扱わない。
- consumerは同じ非並行の脅威モデルの下でexact pathを静的検査してからそのfileだけを読む。静的なsymlink、非通常file、worktree外canonical path、欠損、malformed、stale、改ざん、正本との不一致、予期しない状態変化はblockerとし、安全な新規発行と再照合成功までTask作業を一切開始しない。
- 次Taskが存在しない場合はhandoffを作成せず、既存handoffも削除せずにPlan完了へ進む。

---

### Task 1: AGENTS.mdのTask境界運用を更新

**Files:**
- Modify: `AGENTS.md:53`
- Reference: `SubAgents.md`
- Reference: `docs/superpowers/specs/2026-07-18-task-thread-handoff-design.md`

**Interfaces:**
- Consumes: `SubAgents.md` の役割分離、レビュー、検証、progress ledger、single-writer規則
- Produces: Taskごとのfresh subagent threadと一意なwrite-once handoffを使うリポジトリ共通運用

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
4. 次Taskが存在する場合、親エージェントは `.superpowers/sdd/handoff-plan-<plan>-task-<completed>-to-task-<next>-<head7>.md` 形式の一意な短いファイルを新規作成する。各placeholderには実値を入れ、`plan`、`completed`、`next` は数字、`head7` は完了時HEADの小文字hex 7文字とする。
5. handoff運用では同一worktreeを単一のCodex親だけが操作する。同一ユーザー権限の別プロセスが検査・作成・読取中にsymlink、rename、内容差替えを並行実行する状況は脅威モデル外とする。このsingle-writer前提を満たせない場合はhandoffを作成・読取せずblockerとして次Taskの開始を停止する。
6. producerは作成前にGitの正本からworktree rootを解決し、作成先までの全祖先が実directoryかつ非symlink、作成先directoryのcanonical pathがworktree内、同名leafが不存在であることを確認する。その後、通常のCodex surfaceが提供するworkspace-scoped file creationで一意なhandoffを新規作成する。
7. handoffは一度だけ新規作成するwrite-onceとし、既存leafは型や内容に関係なく一切変更せずblockerとして報告する。静的検査はfail-closedとし、既存ファイルを上書き、削除、再利用せず、新規作成に失敗した場合や予期しない状態変化を検出した場合もblockerが解消するまで次Taskの開始を停止する。
8. handoffには次の情報だけを記録する:
   - 完了したPlan / Taskとcommit。
   - 検証、一次レビュー、二次検証の結論と未解決ブロッカー。
   - 次のPlan / Taskと、設計書、Task brief、reportのパス。
   - 次Taskが使用する確定済みinterfaceと設計判断。
   - worktree、branch、HEAD。
9. handoffにはraw diff、raw log、設計書本文、過去Taskの累積要約を記載しない。
10. 親エージェントは次Taskの新規スレッドへ発行したhandoffのexact pathだけを渡す。glob、directory listing、自動探索、mtimeまたはファイル名の順序による「最新」ファイルの選択は禁止する。古いhandoffは残るが、exact pathを明示して渡されない限りauthorityとして扱わない。
11. 次Taskの新規スレッドは、同じ非並行の脅威モデルの下で、明示されたexact pathが通常ファイルかつ非symlinkであり、canonical pathがworktree内にあることを静的に確認してからそのfileだけを読む。条件不成立、欠損、malformed、stale、改ざん、handoff内容と `AGENTS.md`、`SubAgents.md`、対象Task、承認済み設計書、`.superpowers/sdd/progress.md`、`git log`、branch、HEAD、worktreeの状態との不一致、予期しない状態変化はblockerとして報告する。安全な新規発行と正本との再照合に成功するまで、次Taskの作業を一切開始しない。
12. 次Taskが存在しない場合、handoffは作成せず、既存handoffも削除せずにPlanの完了フローへ進む。
13. 設計書に記載のない仕様変更を勝手に行わない。判断に迷う場合は設計書を正とし、設計書自体の不備が疑われる場合は明示的に指摘する。
```

- [ ] **Step 3: `/compact` が削除され、必要な引き継ぎ語句が存在することを確認する**

Run: `rg -n '/compact' AGENTS.md`

Expected: 終了コード1、出力なし。

Run: `rg -n 'handoff-plan|脅威モデル外|single-writer|静的|workspace-scoped file creation|producer|canonical path|blocker|Taskの作業を一切開始しない' AGENTS.md`

Expected: 一意名、非並行の信頼境界、producerの静的検査と通常surfaceでの作成、既存leafのblocker、consumerの静的fail-closed検査が表示される。

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

Run: `rg -n 'handoff-plan|脅威モデル外|single-writer|静的|workspace-scoped file creation|producer|canonical path|blocker|Taskの作業を一切開始しない' AGENTS.md`

Expected: 終了コード0。一意名、非並行の信頼境界、producerの静的検査と通常surfaceでの作成、既存leafのblocker、consumerの静的fail-closed検査が表示される。

Run: `rg -n 'directory handle|descriptor helper|O_CREAT\|O_EXCL|exclusive create' AGENTS.md`

Expected: 終了コード1、出力なし。通常Codex surfaceに存在しない追加capabilityの必須要件が除去されている。

Run: `git diff --check 285c6c0..5429ce5`

Expected: 終了コード0、出力なし。Task実装commit `5429ce5` までの固定範囲だけを検証する。

Run: `git status --short`

Expected: 終了コード0、出力なし（clean）。
