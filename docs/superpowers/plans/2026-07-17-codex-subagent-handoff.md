# Codexサブエージェント設定 引継ぎ

作成日: 2026-07-17

## 現在地

- リポジトリ: `/home/dev/projects/kondate`
- 実装worktree: `/home/dev/projects/kondate/.worktrees/codex-subagent-config`
- ブランチ: `codex/subagent-config`
- この文書作成前の実装HEAD: `d9a8881`
- ベース: `main` の `64ae61e`
- `main` は `origin/main` より4コミット先。
- `codex/subagent-config` はupstream未設定で、ローカルのみ。
- 元checkoutの `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` にはユーザー所有の未コミット変更がある。
- この引継ぎ文書とバックアップ一覧は、この文書を追加するコミットに含める。再開時は実際の最新HEADを正とする。

実装済みコミット:

- `121c19b feat: Codexサブエージェント設定を追加`
- `4bdf1f2 docs: Codexサブエージェント運用を明確化`
- `9affeff fix: サブエージェント権限境界を明確化`
- `c23387e fix: 単一Implementer運用と検証範囲を明確化`
- `d9a8881 fix: Codex実行時検証とworktree排他を明確化`

## 実装内容

- `.codex/config.toml` に `features.multi_agent = true`、`agents.max_threads = 4`、`agents.max_depth = 1` を追加。
- `.codex/agents/` に `explorer`、`fast-worker`、`implementer`、`reviewer` を追加。
- `default_permissions` と `sandbox_mode` を混在させず、permission profileへ統一。
- `AGENTS.md` に役割分担、単一Implementer、Verifier役の検証と二次検証の区別、失敗時フォールバックを追加。
- 親モデルを固定せず、ImplementerとReviewerは親設定を継承する設計。

## 未完了事項

Task 3の敵対的レビューとfresh-process実行時検証は完了していない。PC再インストール準備を優先したため、第三修正後の候補検証を中断した。

完全新規レビューから、未判定の候補が5件ある:

1. workspace-capable permissionが失敗・skip経路で必ず復元される記述になっていない。
2. frozen scopeのclean要件とPlanの未コミット文書残存記述が矛盾する可能性がある。
3. read-onlyでもDocker bind mount経由の書込みを技術的には防げない可能性がある。
4. `SubAgents.md` のdispatch時model明示と、TOMLの親model継承観測が両立しない可能性がある。
5. one-parent-per-worktree確認が非原子的で、別親プロセスとの競合を防ぐ共有ロックがない。

候補はまだVALIDではない。別Verifierによる再現・反証を行い、VALIDだけを修正すること。既知の残余UNPROVENには、Docker daemon/bind mount境界とper-dispatch model指定の挙動がある。

実行時検証では、現在の親セッションと同じworktreeを使わない。現在のHEADから専用のdisposable worktreeを作り、新しいCodexプロセスで4種類のcustom agentを検証する。詳細は実装PlanのTask 3 Step 3を参照する。

## 再開用プロンプト

以下を新しいCodexセッションへそのまま渡す。

```text
/home/dev/projects/kondate の Codexサブエージェント設定作業を引き継いでください。

最初に AGENTS.md、SubAgents.md、次の2文書を読んでください。
- docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md
- docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md

ブランチ codex/subagent-config の最新コミットと、
docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md を確認してください。
作業前に git status --short --branch と git log --oneline --decorate -12 を実行し、
ユーザー所有の変更を上書きしないでください。

Task 1とTask 2は完了済みです。Task 3の敵対的レビューを再開してください。
引継ぎ文書にある未判定5候補を、過去レビューとコンテキストを共有しない別Verifierで
VALID / REJECTED / UNPROVEN に分類してください。VALIDだけを修正し、修正後は完全新規Reviewerで
新しいCritical/Importantがなくなるまでレビューを繰り返してください。

次に、現在の親セッションとは別のdisposable worktreeと新しいCodexプロセスを使い、
実装Plan Task 3 Step 3の4-agent runtime matrixを実行してください。
explorer、reviewer、fast-workerのread-only拒否、fast-workerのDocker Node経路とhost-native Git経路、
implementerのworkspace sentinel、permissionの復元を確認してください。
実行できないsurfaceや未観測項目があれば、完全検証済みとは表現せず制約として記録してください。

最後に静的設定検証、git diff --check、git statusを実行し、別Reviewerによる最終レビューを行ってください。
Node/npmコマンドはDocker経由、コマンドは連結せず1ツール呼び出しずつ実行してください。
アプリコードを変更していない限り、重いアプリ/DB/E2E検証を省略した理由を明記してください。
勝手にmainへmergeせず、完了時にコミット一覧、検証結果、残余リスク、push状況を報告してください。
```

## 再開時の注意

- 新しいPCでパスが変わった場合、文書内の絶対パスは新しいcheckoutへ読み替える。
- `.env`、SSH鍵、Codex認証情報をGitへ追加しない。
- Globalの `~/.codex/config.toml` とプロジェクトの `.codex/config.toml` の実効設定を再確認する。
- Codexのバージョンが変わった場合、permission profile、custom agent、`agents.max_threads` の公式仕様を再確認する。
- このブランチをリモートへ退避していない場合、再インストール前にpushまたは`git bundle`が必須。
