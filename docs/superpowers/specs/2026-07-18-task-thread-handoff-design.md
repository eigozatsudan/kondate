# Task別サブエージェントスレッド引き継ぎ設計

## 背景

`AGENTS.md` は各Task完了後に `/compact` を実行するよう求めているが、`/compact` はCodexのcomposerが処理する対話UI用コマンドであり、エージェント自身が呼び出せるtoolではない。そのため、現行ルールをエージェントだけで完遂することはできない。

## 目的

親セッションをcontrollerとして維持しつつ、各Taskの実装を新しいサブエージェントスレッドへ分離する。Task間では会話履歴を渡さず、短い引き継ぎファイルだけを渡すことで、次Taskのコンテキストを小さく保つ。

## 対象範囲

- `AGENTS.md` の「実装の進め方」にある `/compact` 指示を置き換える。
- `SubAgents.md` が定めるTask brief、report、review package、progress ledger、レビュー、Verifier、single-writerの規則は変更しない。
- トップレベルのCodexセッションは新規作成しない。
- Task境界ごとに一意なwrite-once handoffを発行し、exact pathだけを次Taskへ渡す境界動作を定める。

## スレッド運用

1. 親エージェントは、設計、仕様判断、委譲範囲の決定、結果の統合、最終判断を担当する。
2. 各Taskでは、`SubAgents.md` が定める役割ごとに新しいサブエージェントスレッドを使用する。完了したTaskのImplementer、Verifier、Reviewerの各スレッドを次Taskへ再利用しない。
3. Task完了後のレビューと検証が終わるまで、次Taskのスレッドを開始しない。
4. CriticalまたはImportantの未解決指摘や検証ブロッカーがある場合は、引き継ぎを完了扱いにせず、既存の修正フローを続ける。

## 引き継ぎファイル

次Taskが存在する場合、親エージェントは `.superpowers/sdd/handoff-plan-<plan>-task-<completed>-to-task-<next>-<head7>.md` 形式の一意な短いファイルを新規作成する。各placeholderには実値を入れ、`plan`、`completed`、`next` は数字、`head7` は完了時HEADの小文字hex 7文字とする。

producerは作成前にGitの正本からworktree rootを解決し、作成先までの全祖先が実directoryかつ非symlinkであり、作成先directoryのcanonical pathがworktree内にあることをsymlink非追従方式で確認する。

作成には、symlink解決後のworkspace外操作を拒否できるworkspace-scoped file toolを使用し、検証済みdirectory handle相当へ束縛した `O_CREAT|O_EXCL` 相当の単一の排他新規作成を行う。存在確認と書込を別操作へ分離しない。surface上でworkspace境界の強制またはexclusive createを確認できない場合は作成せず、blockerとして報告して次Taskの開始を停止する。

handoffは一度だけ新規作成するwrite-onceとし、既存leafは型や内容に関係なく一切変更せずblockerとして報告する。既存ファイルを上書き、削除、再利用せず、新規作成に失敗した場合もblockerが解消するまで次Taskの開始を停止する。

親エージェントは次Taskの新規スレッドへ発行したhandoffのexact pathだけを渡す。glob、directory listing、自動探索、mtimeまたはファイル名の順序による「最新」ファイルの選択は禁止する。古いhandoffは残るが、exact pathを明示して渡されない限りauthorityとして扱わない。

次Taskの新規スレッドは、明示されたhandoffが通常ファイルかつ非symlinkであり、canonical pathがworktree内にあることを確認する。条件不成立、欠損、malformed、stale、改ざん、handoff内容と正本の不一致、読取中の状態変化はblockerとして報告する。安全な新規発行と正本との再照合に成功するまで、次Taskの作業を一切開始しない。

次Taskが存在しない場合、handoffは作成せず、既存handoffも削除せずにPlanの完了フローへ進む。

ファイルには次の情報だけを記載する。

- 完了したPlan / Taskとcommit
- 検証、一次レビュー、二次検証の結論と未解決ブロッカー
- 次のPlan / Taskと、設計書、Task brief、reportのパス
- 次Taskが実際に使用する確定済みinterfaceと設計判断
- worktree、branch、HEAD

raw diff、raw log、設計書本文、過去Taskの累積要約は記載しない。

## 次Task開始時の確認

親エージェントは次Taskの新規サブエージェントへ、handoffのexact pathと当該Taskに必要な資料のパスだけを渡す。新規スレッドはhandoff内容をそのまま事実とせず、次の正本と照合してから作業を始める。

- `AGENTS.md`
- `SubAgents.md`
- 対象Taskの本文と承認済み設計書
- `.superpowers/sdd/progress.md`
- `git log`、branch、HEAD、worktreeの状態

照合結果に不一致がある場合は、独自判断で補わず親エージェントへ報告する。

## 完了条件

- `AGENTS.md` から実行不能な `/compact` 指示が削除されている。
- 各Taskで役割ごとに新しいサブエージェントスレッドを使用することが明記されている。
- 一意なhandoff名の形式、placeholder制約、write-once、上書き・削除・再利用禁止が明記されている。
- producerがGit正本からworktree rootを解決し、全祖先の実directory・非symlinkと作成先directoryのworktree内canonical pathを非追従方式で確認することが明記されている。
- workspace-scoped file toolと検証済みdirectory handle相当へ束縛した `O_CREAT|O_EXCL` 相当の単一排他作成を必須とし、安全性を確認できないsurfaceでは作成しないことが明記されている。
- 既存leafは型や内容に関係なく変更せずblockerとし、存在確認と書込を分離しないことが明記されている。
- exact pathだけを渡し、glob、directory listing、自動探索、mtime・名前順による最新選択を禁止することが明記されている。
- 通常ファイル・非symlink・worktree内canonical pathの確認と、欠損、malformed、stale、改ざん、不一致、読取中の状態変化をblockerとしてTask開始を停止することが明記されている。
- 次Taskが存在しない場合はhandoffを作成・削除せずPlan完了へ進むことが明記されている。
- 既存の設計照合、レビュー、検証、single-writer規則と矛盾しない。
