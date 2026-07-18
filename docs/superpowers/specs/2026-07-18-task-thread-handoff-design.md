# Task別サブエージェントスレッド引き継ぎ設計

## 背景

`AGENTS.md` は各Task完了後に `/compact` を実行するよう求めているが、`/compact` はCodexのcomposerが処理する対話UI用コマンドであり、エージェント自身が呼び出せるtoolではない。そのため、現行ルールをエージェントだけで完遂することはできない。

## 目的

親セッションをcontrollerとして維持しつつ、各Taskの実装を新しいサブエージェントスレッドへ分離する。Task間では会話履歴を渡さず、短い引き継ぎファイルだけを渡すことで、次Taskのコンテキストを小さく保つ。

## 対象範囲

- `AGENTS.md` の「実装の進め方」にある `/compact` 指示を置き換える。
- `SubAgents.md` が定めるTask brief、report、review package、progress ledger、レビュー、Verifier、single-writerの規則は変更しない。
- トップレベルのCodexセッションは新規作成しない。

## スレッド運用

1. 親エージェントは、設計、仕様判断、委譲範囲の決定、結果の統合、最終判断を担当する。
2. 各Taskでは、`SubAgents.md` が定める役割ごとに新しいサブエージェントスレッドを使用する。完了したTaskのImplementer、Verifier、Reviewerの各スレッドを次Taskへ再利用しない。
3. Task完了後のレビューと検証が終わるまで、次Taskのスレッドを開始しない。
4. CriticalまたはImportantの未解決指摘や検証ブロッカーがある場合は、引き継ぎを完了扱いにせず、既存の修正フローを続ける。

## 引き継ぎファイル

次Taskが存在する場合、親エージェントは引き継ぎの正本として `.superpowers/sdd/next-task.md` をTask境界ごとに上書きする。このパスはGit管理外であり、履歴を累積させない。次Taskが存在しない場合は作成せず、Planの完了フローへ進む。

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
- 既存の設計照合、レビュー、検証、single-writer規則と矛盾しない。
