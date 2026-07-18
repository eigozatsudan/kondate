# Task別サブエージェントスレッド引き継ぎ設計

## 背景

`AGENTS.md` は各Task完了後に `/compact` を実行するよう求めているが、`/compact` はCodexのcomposerが処理する対話UI用コマンドであり、エージェント自身が呼び出せるtoolではない。そのため、現行ルールをエージェントだけで完遂することはできない。

## 目的

親セッションをcontrollerとして維持しつつ、各Taskの実装を新しいサブエージェントスレッドへ分離する。Task間では会話履歴を渡さず、短い引き継ぎファイルだけを渡すことで、次Taskのコンテキストを小さく保つ。

## 対象範囲

- `AGENTS.md` の「実装の進め方」にある `/compact` 指示を置き換える。
- `SubAgents.md` が定めるTask brief、report、review package、progress ledger、レビュー、Verifier、single-writerの規則は変更しない。
- トップレベルのCodexセッションは新規作成しない。
- 次Taskが存在しない場合に、古い `.superpowers/sdd/next-task.md` を安全に失効させる境界動作を定める。

## スレッド運用

1. 親エージェントは、設計、仕様判断、委譲範囲の決定、結果の統合、最終判断を担当する。
2. 各Taskでは、`SubAgents.md` が定める役割ごとに新しいサブエージェントスレッドを使用する。完了したTaskのImplementer、Verifier、Reviewerの各スレッドを次Taskへ再利用しない。
3. Task完了後のレビューと検証が終わるまで、次Taskのスレッドを開始しない。
4. CriticalまたはImportantの未解決指摘や検証ブロッカーがある場合は、引き継ぎを完了扱いにせず、既存の修正フローを続ける。

## 引き継ぎファイル

親エージェントは `.superpowers/sdd/next-task.md` の存在確認、上書き、削除より前に、Gitの正本からworktree rootを解決する。exact pathの祖先 `.superpowers` と `.superpowers/sdd` が実ディレクトリかつ非symlinkであり、対象のcanonical pathがworktree root内にあることを確認する。次Taskが存在し、存在しない親ディレクトリを作成する場合は、各階層を作成した直後に同じ条件を確認する。

存在確認と操作ではleafと全祖先をsymlink追従しない方式で扱う。変更操作の直前に、canonical path、祖先、leaf、および検証後の状態不変を再確認する。安全条件または状態不変を確認できない場合は一切変更せず、blockerとして報告する。

次Taskが存在する場合、親エージェントは検証済みの `.superpowers/sdd` 内に一時ファイルを作成し、検証済みleafへatomic renameして引き継ぎの正本を上書きする。同じ安全条件は新規作成と既存ファイルの置換の両方に適用する。このパスはGit管理外であり、履歴を累積させない。

次Taskが存在しない場合、親エージェントは安全条件を満たした確認で `.superpowers/sdd/next-task.md` が存在しないと判定できた場合、または非symlinkの通常ファイルを安全に削除できた場合だけ、Planの完了フローへ進む。leafが通常ファイルでない場合、祖先または解決先の検証失敗、検証後の状態変化、削除失敗はblockerとして報告し、解消するまでPlan完了を停止する。祖先が存在しないためleafの不存在が安全に確定する場合は、親ディレクトリを作成せず何もしない。

ファイルには次の情報だけを記載する。

- 完了したPlan / Taskとcommit
- 検証、一次レビュー、二次検証の結論と未解決ブロッカー
- 次のPlan / Taskと、設計書、Task brief、reportのパス
- 次Taskが実際に使用する確定済みinterfaceと設計判断
- worktree、branch、HEAD

raw diff、raw log、設計書本文、過去Taskの累積要約は記載しない。

## 次Task開始時の確認

親エージェントは次Taskの新規サブエージェントへ、引き継ぎファイルのパスと当該Taskに必要な資料のパスだけを渡す。新規スレッドは引き継ぎ内容をそのまま事実とせず、次の正本と照合してから作業を始める。

- `AGENTS.md`
- `SubAgents.md`
- 対象Taskの本文と承認済み設計書
- `.superpowers/sdd/progress.md`
- `git log`、branch、HEAD、worktreeの状態

照合結果に不一致がある場合は、独自判断で補わず親エージェントへ報告する。

## 完了条件

- `AGENTS.md` から実行不能な `/compact` 指示が削除されている。
- 各Taskで役割ごとに新しいサブエージェントスレッドを使用することが明記されている。
- `.superpowers/sdd/next-task.md` の内容、更新時期、禁止内容、照合手順が明記されている。
- worktree rootの正本解決、canonical pathのworktree内制約、祖先とleafのsymlink非追従検証、操作直前の状態不変再確認が明記されている。
- 次Taskが存在する場合に検証済み `.superpowers/sdd` 内の一時ファイルからatomic renameで上書きすることが明記されている。
- 次Taskが存在しない場合の安全な不存在または削除成功だけをPlan完了条件とし、leaf・祖先・解決先・状態変化・削除失敗のblocker解消まで完了を停止することが明記されている。
- 既存の設計照合、レビュー、検証、single-writer規則と矛盾しない。
