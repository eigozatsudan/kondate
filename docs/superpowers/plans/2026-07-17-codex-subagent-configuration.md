# Codex サブエージェント構成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 親モデルをグローバル設定から継承しつつ、調査・定型検証・実装・レビューを役割別カスタムエージェントへ安全に委譲できるリポジトリ設定を追加する。

**Architecture:** `.codex/config.toml` は機能フラグとスレッド上限を管理し、`.codex/agents/*.toml` は各役割のモデル・推論強度・権限プロファイル・専門指示を管理する。`AGENTS.md` は利用判断だけを簡潔に示し、Task単位の詳細フローは既存の `SubAgents.md` を正本として参照する。

**Tech Stack:** Codex CLI 0.144.5、TOML、Markdown、Git

## Global Constraints

- 親モデルはリポジトリ設定で固定せず、グローバルCodex設定から継承する。
- 権限は `default_permissions` 方式に統一し、`sandbox_mode` と `[sandbox_workspace_write]` を追加しない。
- `.codex/config.toml` の既存 `default_permissions = ":workspace"` を維持する。
- `agents.max_threads = 4` とするが、親スレッドを数えるかは未確定として扱う。
- `agents.max_depth = 1` とし、サブエージェントから孫エージェントを生成させない。
- 並列化は独立した読み取り作業に限定する。single-writerはCodex設定による役別同時数の技術的制限やロックではなく、親が維持する運用上のオーケストレーション不変条件とする。同じworktreeを操作するCodex親プロセス／セッションは1つだけとし、並行する親は別worktreeを使用する。親はImplementerのdispatch前にworktreeの排他性とactive agent threadを確認し、既存Implementerが完了またはcloseされるまで2体目をdispatchしない。どちらかを確認できない場合はImplementerをdispatchせず報告する。
- 親のlive runtime permission overrideはcustom agentの既定権限を上書きし得る。読み取り専用役を起動する前に親がread-onlyを選び、選択できないsurfaceでは編集禁止が指示上の制約だけであると報告する。
- `explorer`、`reviewer`、`fast-worker` は、live overrideで書き込み可能になっていてもリポジトリ編集を拒否する。
- Verifier役の定型検証と、Reviewerによるレビュー指摘の二次検証を別概念として扱う。
- 既存の未コミット変更 `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` を変更、ステージ、コミットしない。
- Node/npmコマンドだけをDocker経由で実行する。Codex CLI、`rg`、Git、その他のホストコマンドは指定どおりホストで実行し、複数コマンドを結合しない。
- コードコメントとコミットメッセージは日本語にする。

---

## File Structure

- Modify: `.codex/config.toml` — リポジトリ既定権限、multi-agent機能、スレッド上限を管理する。
- Create: `.codex/agents/explorer.toml` — 高速な読み取り専用調査役を定義する。
- Create: `.codex/agents/fast-worker.toml` — 読み取り専用の高速Verifier役を定義する。
- Create: `.codex/agents/implementer.toml` — 親モデルを継承する唯一の書き込み役を定義する。
- Create: `.codex/agents/reviewer.toml` — 親モデルを継承する読み取り専用レビュー役を定義する。
- Modify: `AGENTS.md` — 各カスタムエージェントの選択基準と禁止事項を示す。

---

### Task 1: Codex設定とカスタムエージェント定義

**Files:**
- Modify: `.codex/config.toml`
- Create: `.codex/agents/explorer.toml`
- Create: `.codex/agents/fast-worker.toml`
- Create: `.codex/agents/implementer.toml`
- Create: `.codex/agents/reviewer.toml`

**Interfaces:**
- Consumes: グローバル設定から継承する親モデル、組み込み権限プロファイル `:read-only` と `:workspace`。
- Produces: `explorer`、`fast-worker`、`implementer`、`reviewer` の4種類のカスタムエージェント。

- [ ] **Step 1: 既存設定と禁止キーを確認する**

Run: `sed -n '1,160p' .codex/config.toml`

Expected: `default_permissions = ":workspace"` が1行存在し、`sandbox_mode` と `[sandbox_workspace_write]` は存在しない。

Run: `rg -n '^(sandbox_mode|\[sandbox_workspace_write\])' .codex AGENTS.md SubAgents.md`

Expected: 終了コード1で一致なし。既存文書の説明文に一致した場合は、設定キーとして存在しないことを目視確認する。

- [ ] **Step 2: リポジトリのCodex設定を拡張する**

`.codex/config.toml` を次の完全な内容にする。

```toml
# リポジトリ内の通常作業を許可し、境界外の操作は既存の承認フローに委ねる。
default_permissions = ":workspace"

[features]
multi_agent = true

[agents]
max_threads = 4
max_depth = 1
```

- [ ] **Step 3: `explorer` を追加する**

`.codex/agents/explorer.toml` を作成する。

```toml
name = "explorer"
description = "関連コード、設計書、依存関係を高速に調査する読み取り専用エージェント。"
model = "gpt-5.6-terra"
model_reasoning_effort = "low"
default_permissions = ":read-only"

developer_instructions = """
コードベース、設計書、テスト、依存関係の調査だけを行ってください。
親のlive runtime permission overrideによって書き込み権限が与えられていても、リポジトリ、設定、Git状態の変更を拒否してください。
結論、根拠となるファイルパスと行番号、実装時の注意点を簡潔に返してください。
推測と確認済みの事実を明確に分け、不明点を独自仕様で補わないでください。
"""
```

- [ ] **Step 4: `fast-worker` を追加する**

`.codex/agents/fast-worker.toml` を作成する。

```toml
name = "fast-worker"
description = "指定どおりの定型検証と失敗ログの要約を担当する読み取り専用の高速Verifier。"
model = "gpt-5.6-terra"
model_reasoning_effort = "low"
default_permissions = ":read-only"

developer_instructions = """
親から指定された正確な検証コマンドだけを、指定された順序で実行してください。Node/npmコマンドだけをAGENTS.mdのDocker形式で実行し、Codex CLI、rg、Git、その他のホストコマンドは指定どおりに実行してください。
Docker daemonのrw bind mountはCodexのread-only filesystemに対する技術的境界外であり、containerからrepositoryへ書き込めます。親から指定されていても、repositoryへの書き込みを行い得るDocker payloadを含むコマンドは実行を拒否し、親へ報告してください。
親のlive runtime permission overrideによって書き込み権限が与えられていても、リポジトリファイルの作成、編集、削除、整形、ステージ、コミットを拒否してください。
検証ツールが一時ファイルや実行時状態を生成する可能性はありますが、追跡対象ファイルの差分や意図しないuntracked fileを残してはいけません。
各コマンドの成功または失敗を報告し、失敗時だけ原因箇所と短いログ抜粋を返してください。
大量の生ログを親エージェントへ返さないでください。
"""
```

- [ ] **Step 5: `implementer` を追加する**

`.codex/agents/implementer.toml` を作成する。`model` と `model_reasoning_effort` は記載せず、親設定を継承させる。

```toml
name = "implementer"
description = "Task briefに従い、RED、GREEN、Task内リファクタリングを行う唯一の書き込み担当。"
default_permissions = ":workspace"

developer_instructions = """
SubAgents.mdのImplementer役として、Task briefに記載された範囲だけを実装してください。
この定義はImplementerを技術的に1体へ制限せず、同じworktreeの別のCodex親プロセス／セッションもロックしません。どのファイルも編集する前に、親から同じworktreeを操作する親が1つだけであるとの確認を受け、利用可能なagent状態とdispatch情報から自分が唯一のactive Implementerであることを確認してください。親からworktreeの排他確認がない、排他性を確認できない、または別のactive Implementerがいる場合は編集を停止し、親へ報告してください。
対象外ファイルや既存の未コミット変更には触れないでください。
REDテスト、期待どおりの失敗確認、最小GREEN実装、Task内リファクタリング、focused検証の順序を守ってください。
設計書にない仕様変更やロック済みインターフェースの再定義を行わないでください。
変更ファイル、実行した検証、未解決事項を親エージェントへ報告してください。
"""
```

- [ ] **Step 6: `reviewer` を追加する**

`.codex/agents/reviewer.toml` を作成する。モデルは親設定から継承し、推論強度だけを `high` にする。

```toml
name = "reviewer"
description = "設計適合性、正しさ、セキュリティ、敵対的入力、回帰、テスト不足を調べる読み取り専用レビュアー。"
model_reasoning_effort = "high"
default_permissions = ":read-only"

developer_instructions = """
SubAgents.mdのReviewer役として、指定されたTask brief、review package、検証報告、承認済み設計書、および親が明示したその他の参照資料を根拠にレビューしてください。
親のlive runtime permission overrideによって書き込み権限が与えられていても、リポジトリ、設定、Git状態の変更を拒否してください。
設計適合性、正しさ、セキュリティ、悪意ある入力、境界条件、想定外の利用、回帰、テスト不足を確認してください。
指摘はCritical、Important、Minorに分類し、根拠となるファイルと行、再現条件、必要な修正を示してください。
問題がない場合も、確認した観点と根拠を簡潔に示してください。
"""
```

- [ ] **Step 7: 構文と実効設定を検証する**

Run: `codex --strict-config doctor --summary`

Expected: `Configuration` の `config` が `loaded`。ネットワーク到達性や既存state DBなど、設定以外のDoctor失敗はこのTaskの失敗条件にしない。

Run: `codex features list`

Expected: `multi_agent` が `true`。

Run: `rg -n '^(sandbox_mode|\[sandbox_workspace_write\])' .codex`

Expected: 終了コード1で一致なし。

Run: `git diff --check -- .codex/config.toml .codex/agents`

Expected: 出力なし、終了コード0。

- [ ] **Step 8: Task 1をコミットする**

Run: `git status --short`

Expected: このTaskの `.codex` 変更に加え、既存の未コミットPlan文書だけが表示される。

Run: `git add .codex/config.toml .codex/agents/explorer.toml .codex/agents/fast-worker.toml .codex/agents/implementer.toml .codex/agents/reviewer.toml`

Run: `git commit -m "feat: Codexサブエージェント設定を追加"`

Expected: `.codex` の5ファイルだけを含むコミットが作成される。

---

### Task 2: AGENTS.mdの運用ルール明確化

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1が定義した `explorer`、`fast-worker`、`implementer`、`reviewer`。
- Produces: カスタムエージェントの選択、単一書き込み、Verifier役と二次検証の区別に関するリポジトリ指示。

- [ ] **Step 1: 既存のサブエージェント節を確認する**

Run: `sed -n '50,90p' AGENTS.md`

Expected: `## 5. サブエージェント運用` が存在し、既存の親、`fast-worker`、`explorer`、単一書き込み方針が確認できる。

- [ ] **Step 2: サブエージェント運用節を明確化する**

`AGENTS.md` の `## 5. サブエージェント運用` から次の区切り線までを、以下で置き換える。

```markdown
## 5. サブエージェント運用

- 詳細なTask実行順序、引き継ぎ、レビュー判定は `SubAgents.md` を正とする。
- 親エージェントは設計、仕様判断、委譲範囲の決定、結果の統合、最終判断を担当する。
- 親のlive runtime permission overrideはカスタムエージェントの既定権限を上書きし得る。`explorer`、`reviewer`、`fast-worker` を起動する前に、親はlive runtime permissionとしてread-onlyを選択する。利用中のsurfaceで選択できない場合、その役割の編集禁止は技術的な権限境界ではなく指示上の制約に留まることを報告する。
- 親が検証のためworkspace-capable permissionへの切替を試みる前に、希望する通常permissionを記録する。切替を試みた後は、検証の成功・失敗・skipを問わず、すべての終了経路でcleanupとして通常permissionへ明示的に復元し、実効状態を確認する。復元または確認に失敗した場合は新しい作業を開始せず、完全検証済みとせずに未解決制約として報告する。
- コードベースや設計書の読み取り調査には、読み取り専用の `explorer` を使用する。live overrideで書き込み可能になっていても、リポジトリの編集を拒否させる。
- Node/npmによる定型テスト、型チェック、Lint、フォーマット検証と、指定されたCodex CLI、`rg`、Git等のホストコマンドの実行・ログ要約には、読み取り専用の `fast-worker` を使用する。これは `SubAgents.md` の Verifier 役であり、live overrideで書き込み可能になっていてもリポジトリファイルの編集を拒否させる。Docker daemonのrw bind mountはread-only filesystemの技術的境界外であるため、親はread-onlyをDockerに対する技術的境界として扱わず、Dockerコマンドの実行前後に `git status --short` を確認する。意図しない差分が生じた場合は新しい作業を止めて報告する。
- Taskのコード変更には `implementer` を使用する。single-writerはCodex設定による役別同時数の技術的制限やロックではなく、親が維持する運用上のオーケストレーション不変条件である。同じworktreeを操作するCodex親プロセス／セッションは1つだけとし、並行する親は別worktreeを使用する。親はImplementerを起動する前に、同じworktreeに別の親がいないこととactive agent threadを確認し、既存Implementerが完了またはcloseされるまで2体目を起動してはいけない。worktreeの排他性またはactive状態を確認できない場合はImplementerを起動せず、その制約を報告する。
- 設計適合性、セキュリティ、敵対的入力、境界条件、回帰、テスト不足の確認には、読み取り専用の `reviewer` を使用する。live overrideで書き込み可能になっていても、リポジトリの編集を拒否させる。
- 独立した読み取り作業だけを並列化し、サブエージェントの報告は親エージェントが根拠を確認してから採用する。
- 一次レビューと、その指摘を深掘りする二次検証には、コンテキストを共有しない別々の Reviewer エージェントを使用する。この二次検証は、Dockerコマンドを再実行する Verifier 役の検証とは別である。
- モデルまたはカスタムエージェント種別を実行環境で指定できない場合は、暗黙に指定できたと仮定せず、その制約と実際に使用した代替手段を報告する。

---
```

- [ ] **Step 3: 文書と設定の整合性を検証する**

Run: `rg -n 'explorer|fast-worker|implementer|reviewer|Verifier|二次検証' AGENTS.md SubAgents.md .codex/agents`

Expected: 4種類のカスタムエージェントが定義・参照され、Verifier役と二次検証が別概念として記述される。

Run: `rg -n '^(sandbox_mode|\[sandbox_workspace_write\])' .codex`

Expected: 終了コード1で一致なし。

Run: `codex --strict-config doctor --summary`

Expected: `Configuration` の `config` が `loaded`。これはbase configの読込だけを証明し、custom agentのspawn後の実効権限は証明しない。

Run: `git diff --check -- AGENTS.md .codex/config.toml .codex/agents`

Expected: 出力なし、終了コード0。

- [ ] **Step 4: Task 2をコミットする**

Run: `git status --short`

Expected: `AGENTS.md` と、既存の未コミットPlan文書だけが表示される。

Run: `git add AGENTS.md`

Run: `git commit -m "docs: Codexサブエージェント運用を明確化"`

Expected: `AGENTS.md` だけを含むコミットが作成される。

---

### Task 3: 独立レビューと最終検証

**Files:**
- Verify: `AGENTS.md`
- Verify: `SubAgents.md`
- Verify: `.codex/config.toml`
- Verify: `.codex/agents/explorer.toml`
- Verify: `.codex/agents/fast-worker.toml`
- Verify: `.codex/agents/implementer.toml`
- Verify: `.codex/agents/reviewer.toml`

**Interfaces:**
- Consumes: Task 1とTask 2のコミット、および承認済み設計書。
- Produces: 設計適合性、権限の安全性、設定読込、差分清潔性に関する最終証拠。

- [ ] **Step 1: 一次レビューを別Reviewerへ委譲する**

一次Reviewerへ、承認済み設計書、Task 1・2のコミット範囲、対象ファイルを渡す。次を必須観点とする。

```text
設計適合性、default_permissionsと旧sandbox設定の混在、権限の過不足、
単一書き込み保証、Verifier役と二次検証の混同、モデル継承、
未コミットPlan文書への混入、TOMLのCodex設定スキーマ適合性を確認してください。
```

Expected: Critical／Important／Minorに分類された報告。CriticalまたはImportantがあれば同じImplementer役へまとめて修正を戻す。

- [ ] **Step 2: 一次指摘を別Reviewerで二次検証する**

一次Reviewerとコンテキストを共有しない別Reviewerへ、一次報告と同じ設計書・差分を渡す。

```text
一次指摘を独立に再現・検証してください。各指摘について妥当、誤検知、重要度変更を判定し、
一次レビューが見落としたCritical／Importantがないかも確認してください。
リポジトリは編集しないでください。
```

Expected: 各指摘の検証結果。妥当なCritical／Importantが残る場合は同じImplementer役で修正し、Step 1から再実行する。

- [ ] **Step 3: 最終設定検証をVerifierへ委譲する**

Run: `codex --strict-config doctor --summary`

Expected: `Configuration` の `config` が `loaded`。

Run: `codex features list`

Expected: `multi_agent` が `true`。

Run: `rg -n '^(sandbox_mode|\[sandbox_workspace_write\])' .codex`

Expected: 終了コード1で一致なし。

Run: `git diff --check`

Expected: 出力なし、終了コード0。

Run: 新しいCodexプロセスを起動する。検証開始時の希望する通常permissionを記録し、親のlive runtime permissionとしてread-onlyを選択して実効状態を確認してから、`explorer`、`reviewer`、`fast-worker` をspawnする。3役すべてについてcustom agent名、固有の役割指示、リポジトリ書き込み拒否を観測する。`fast-worker` にはrepositoryを書き込むDocker payloadの実行を依頼し、コマンドを実行せず拒否することを確認する。read-onlyはDocker daemonのrw bind mountに対する技術的境界ではなく、既知のsentinel実機証拠を再現する場合は承認されたdisposable worktreeだけを使用してcleanupする。可能なら書き込み可能なlive overrideでもdeveloper instructionに従って編集を拒否することを別途確認する。

Run: 親がDockerコマンドの実行前に `git status --short` を記録する。

Run: `fast-worker` に、リポジトリルートをcwdとして `docker compose run --rm --no-deps app node -p 'JSON.stringify({execPath:process.execPath,cwd:process.cwd(),version:process.version})'` を実行させる。

Expected: 終了コード0。正確なコマンド、host Docker CLIからComposeの`app` serviceを経由してcontainer内Nodeへ至る実行経路、呼出しcwd、出力された`execPath`・container cwd・Node versionを記録する。

Run: 親がDockerコマンドの実行後に `git status --short` を再実行し、実行前の記録と比較する。

Expected: 前後のGit状態に差がなく、追跡対象ファイルの差分や意図しないuntracked fileがない。差がある場合は新しい作業を止めて報告する。

Run: 同じ `fast-worker` に、同じリポジトリルートをcwdとしてhost-nativeの `git rev-parse --show-toplevel` を実行させる。

Expected: 終了コード0。正確なコマンド、host-native Gitの実行経路、呼出しcwd、出力されたworktree rootを記録し、追跡対象ファイルの差分を残さない。

Run: 読み取り専用3役が完了した後、親のlive runtime permissionをworkspace-capable modeへ明示的に切り替えて実効状態を確認する。同じworktreeを操作するCodex親プロセス／セッションが1つだけであることと、active Implementerがいないことを確認する。どちらかを確認できなければImplementerをspawnしない。確認できた場合だけ `implementer` を1体spawnし、承認されたdisposable worktree上のsentinel書き込みで、親model/reasoningの継承と`:workspace`の実効値を観測する。

Run: workspace-capable permissionへの切替を試みた後は、Implementer検証の成功・失敗・skipを問わず、すべての終了経路でcleanupを実行する。検証開始時に記録した希望する通常permissionへ明示的に戻し、実効状態を確認する。開始時、read-only選択、workspace-capable選択、通常permission復元の各遷移と確認結果を記録する。復元または確認に失敗した場合は新しい作業を開始せず、完全検証済みとせずに未解決制約として報告する。

Expected: 4種類すべてについてcustom agent名と固有の役割指示がloadされ、読み取り専用3役の拒否、fast-workerによるrepository書込みDocker payloadの事前拒否、Docker経路とhost-native経路の成功、Docker実行前後のGit状態不変、Implementerの継承・`:workspace`・sentinel書き込み、全permission遷移が観測される。同じworktreeには親が1つ、Implementerは同時に1体だけである。Docker daemonのrw bind mountはread-onlyの残余制約として記録する。1種類でもloadまたは期待する実効値を観測できない、いずれかのpermissionを選択・確認できない、worktreeの排他性を確認できない、通常permissionの復元を確認できない、またはこの検証を実行できないsurfaceでは完全検証済みとせず、未解決制約として記録する。

Run: 検証用sentinelをcleanupした後、実装worktreeとdisposable runtime worktreeでそれぞれ `git status --short --branch` を実行する。元checkoutに検証開始時からユーザー所有の未コミットPlanが存在する場合は、そのstatusと差分が変わっていないことも確認する。

Expected: 実装worktreeはclean、disposable runtime worktreeはcleanである。元checkoutでは、ユーザー所有の未コミットPlanが検証開始時に存在する場合に限り、その差分だけが未変更のまま残り、検証による新しい差分はない。

- [ ] **Step 4: 検証対象外を記録して完了報告する**

アプリケーション実行コード、DB、UIを変更していないため、format、lint、typecheck、Vitest、DB reset、pgTAP、E2E、buildは実行しない。完了報告に、実行したCodex設定検証、fresh-process custom-agent spawn検証の結果または未実施制約、レビュー結果、作成したコミット、未変更のユーザー所有差分を記載する。spawn検証が未実施なら、完全検証済みと記載しない。
