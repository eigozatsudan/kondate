# Codex Subagent Responsibility Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex surface ごとの能力差を考慮し、サブエージェントの役割、モデル、推論強度、permission の指定責任を独立させる。

**Architecture:** `AGENTS.md` は役割選択と capability fallback、`SubAgents.md` は Task ごとのモデル選択優先順位を正本として定める。既存の custom agent TOML は対応 surface 向けの役割プロファイルとして維持し、2026-07-17 の設計・実装Plan・引継ぎ文書を新しい責任分離へ同期する。

**Tech Stack:** Codex custom agents、permission profiles、Markdown、Git

## Global Constraints

- 正本は `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` とする。
- custom agent 種別、モデル、推論強度、permission を独立して判定する。
- `task_name` の一致を custom agent の選択または読み込みの証拠として扱わない。
- custom agent 種別を選択できない surface では、汎用 subagent に役割、対象範囲、編集可否を明示する。
- custom agent 種別も per-dispatch model override も選択できない場合、実効モデルを推測しない。
- surface で選択・確認できた実効 permission だけを技術的境界として扱う。
- Docker daemon の rw bind mount を Codex filesystem permission の技術的境界として扱わない。
- `.codex/config.toml` と `.codex/agents/*.toml` は変更しない。
- アプリケーションコード、DB、UI、依存関係を変更しない。
- Node/npm コマンドは不要であり、Vitest、pgTAP、E2E、ビルドは実行しない。

## File Structure

- Modify: `AGENTS.md` — 全体のモデル選択規定、role、permission の capability fallback を定める。
- Modify: `SubAgents.md` — per-dispatch model の絶対指定を優先順位方式へ置き換える。
- Modify: `docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md` — 既存設計を責任分離へ同期する。
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md` — 既存実装Planの規定とruntime検証条件を同期する。
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md` — model指定の既知不整合を解決済みにする。

---

### Task 1: 現行運用規定の責任分離

**Files:**
- Modify: `AGENTS.md:22-25,63-75,137-142`
- Modify: `SubAgents.md:77-95`

**Interfaces:**
- Consumes: 承認済み設計の制約別責任表、既存の `explorer`、`fast-worker`、`implementer`、`reviewer` の役割名。
- Produces: role、model、reasoning、permission を独立判定するリポジトリ運用規定。

- [ ] **Step 1: 現行の矛盾を再現する**

Run: ``rg -n 'Always pass `model` explicitly|モデルまたはカスタムエージェント種別|利用可能なカスタムエージェントを選び' AGENTS.md SubAgents.md docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md``

Expected: `SubAgents.md` の per-dispatch model 絶対指定、`AGENTS.md` の model と custom agent 種別をまとめたフォールバック、既存設計の循環したフォールバックが一致する。これを修正前の不整合証拠として記録する。

- [ ] **Step 2: `AGENTS.md` のモデル選択規定をsurface能力に合わせる**

`コマンド実行の重要ルール` のモデル規定を次の1行へ置き換える。

```markdown
2. **モデルの選択**: custom agent種別を選択できる場合は、そのagent TOMLの明示値または意図的な親継承を正とする。per-dispatch model overrideを公開するsurfaceではTaskの難易度に応じて軽量または高性能なモデルへ切り替えてよい。どちらも選択・確認できない場合は実効モデルを推測しない。
```

`## 9. レビュー` のモデル規定を次の1行へ置き換える。

```markdown
4. レビュー時は `reviewer` 役のTOMLまたは親設定を正とし、surfaceがper-dispatch model overrideを公開する場合は、より適切な高性能モデルへの切り替えを検討する。
```

- [ ] **Step 3: `AGENTS.md` のサブエージェント節を責任分離へ置き換える**

`AGENTS.md` の `## 5. サブエージェント運用` の箇条書きを、次の内容へ置き換える。

```markdown
- 詳細なTask実行順序、引き継ぎ、レビュー判定は `SubAgents.md` を正とする。
- 親エージェントは設計、仕様判断、委譲範囲の決定、結果の統合、最終判断を担当する。
- custom agent種別、モデル、推論強度、permissionは独立して判定する。利用中のsurfaceでcustom agent種別を選択できる場合は役割に対応するagentを選び、`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。種別を選択できない場合は汎用subagentに同じ役割、対象範囲、編集可否を指示する。
- custom agentを選択した場合、モデルと推論強度はそのagent TOMLの明示値または意図的な親継承を正とする。per-dispatch model overrideを公開するsurfaceではTaskの難易度に応じて上書きしてよい。どちらも選択・確認できない場合は実効モデルや推論強度を推測せず、必要な場合だけ実際に使用した代替手段を最終報告へ記載する。
- 親のlive runtime permission overrideはcustom agentの既定権限を上書きし得る。`explorer`、`reviewer`、`fast-worker`の起動前にread-onlyのlive runtime permissionを選択・確認できた場合だけ、Codex filesystemに対する技術的境界として扱う。選択・確認できない場合も編集禁止を指示するが、技術的read-onlyとは扱わない。同じsurface制約を起動ごとに定型報告せず、作業の信頼性判断に影響する場合に最終報告で一度記載する。技術的read-onlyが必須の検証を実施できない場合は直ちに停止して報告する。
- 親が検証のためworkspace-capable permissionへの切替を試みる前に、希望する通常permissionを記録する。切替を試みた後は、検証の成功・失敗・skipを問わず、すべての終了経路でcleanupとして通常permissionへ明示的に復元し、実効状態を確認する。復元または確認に失敗した場合は新しい作業を開始せず、完全検証済みとせずに未解決制約として報告する。
- コードベースや設計書の読み取り調査には `explorer` 役を使用する。custom agent種別を選択できない場合は汎用subagentへ読み取り専用の調査役を指示する。live overrideで書き込み可能になっていても、リポジトリの編集を拒否させる。
- Node/npmによる定型テスト、型チェック、Lint、フォーマット検証と、指定されたCodex CLI、`rg`、Git等のホストコマンドの実行・ログ要約には `fast-worker` 役を使用する。これは `SubAgents.md` の Verifier 役であり、custom agent種別を選択できない場合は汎用subagentへ同じ役割を指示する。Docker daemonのrw bind mountはCodexのread-only filesystemに対する技術的境界外である。`fast-worker` 役は、コマンド自体または既知の通常動作がhost worktreeの作成・変更・削除を意図するDocker payloadだけを拒否する。親はclean baselineでのみDockerコマンドを開始し、実行前後のstaged diff、unstaged diff、untracked一覧を保存して比較する。ignored pathは比較対象外とし、意図しない差分が生じた場合は新しい作業を止めて報告する。
- Taskのコード変更には `implementer` 役を使用する。single-writerはCodex設定による役別同時数の技術的制限やロックではなく、親が維持する運用上のオーケストレーション不変条件である。同じworktreeを操作するCodex親プロセス／セッションは1つだけとし、並行する親は別worktreeを使用する。親はImplementerを起動する前に、同じworktreeに別の親がいないこととactive agent threadを確認し、既存Implementerが完了またはcloseされるまで2体目を起動してはいけない。worktreeの排他性またはactive状態を確認できない場合はImplementerを起動せず、その制約を報告する。
- 設計適合性、セキュリティ、敵対的入力、境界条件、回帰、テスト不足の確認には `reviewer` 役を使用する。custom agent種別を選択できない場合は汎用subagentへ読み取り専用のレビュー役を指示する。live overrideで書き込み可能になっていても、リポジトリの編集を拒否させる。
- 独立した読み取り作業だけを並列化し、サブエージェントの報告は親エージェントが根拠を確認してから採用する。
- 一次レビューと、その指摘を深掘りする二次検証には、コンテキストを共有しない別々の Reviewer エージェントを使用する。この二次検証は、Dockerコマンドを再実行する Verifier 役の検証とは別である。
```

- [ ] **Step 4: `SubAgents.md` のモデル選択を優先順位方式へ置き換える**

`SubAgents.md` の `## Model selection` 全体を、次の内容へ置き換える。

```markdown
## Model selection

- **Implementer, mechanical Tasks** (plan text supplies complete code to
  transcribe, 1–3 files, no cross-cutting judgment): cheapest available tier.
  Most Kondate plan Tasks are written this way — the Task text is nearly literal
  source.
- **Implementer, integration Tasks** (multiple files, must reconcile with
  existing Task 1–N exports, ambiguity in how a mock/fixture should look):
  standard tier.
- **Reviewer**: standard tier normally; scale up for auth/RLS/money-shaped Tasks
  (continuation handoff, quota, payment-adjacent quota, RLS policies) where a
  missed finding is expensive.
- **Verifier**: cheapest tier that can reliably run and report shell output —
  this role does not need judgment, only faithful execution and reporting.
- **Final whole-branch review** (end of a Plan, not a Task): most capable
  available model.

Apply model selection in this order:

1. If the surface can select a named custom agent, use the model and
   `model_reasoning_effort` explicitly defined by that agent TOML. An omitted
   value intentionally inherits the parent session setting.
2. If the surface exposes a per-dispatch model override, the controller may
   override the inherited or agent-file value to match the Task tier above.
3. If neither custom-agent selection nor a model override is available, do not
   infer the effective model. Use the available generic subagent with the exact
   role constraints and report the fallback only when it materially affects the
   final confidence or cost claim.

Treat custom-agent selection, model selection, reasoning effort, and permission
as independent capabilities. A matching `task_name` labels a thread; it is not
evidence that a same-named custom agent or its TOML settings were loaded.
```

- [ ] **Step 5: Task 1 の整合性を検証する**

Run: ``rg -n 'Always pass `model` explicitly|モデルまたはカスタムエージェント種別' AGENTS.md SubAgents.md``

Expected: 出力なし、終了コード1。

Run: `rg -n 'task_name|per-dispatch|custom agent種別、モデル、推論強度、permission|汎用subagent|reviewer.*TOML' AGENTS.md SubAgents.md`

Expected: `task_name` を選択証拠にしない規定、per-dispatch override の条件、4制約の独立判定、汎用subagent fallbackが出力される。

Run: `git diff --check -- AGENTS.md SubAgents.md`

Expected: 出力なし、終了コード0。

Run: `git diff -- .codex/config.toml .codex/agents`

Expected: 出力なし、終了コード0。

- [ ] **Step 6: Task 1 をコミットする**

```bash
git add AGENTS.md SubAgents.md
git commit -m "fix: サブエージェント選択制約を整合"
```

Expected: `AGENTS.md` と `SubAgents.md` だけを含むコミットが作成される。

---

### Task 2: 既存設計・Plan・引継ぎ文書の同期

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md:17-28,81-103,109-139`
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md:11-21,193-237,314-334`
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md:33-47,65-76`

**Interfaces:**
- Consumes: Task 1 が定義した role、model、reasoning、permission の優先順位と capability fallback。
- Produces: 新旧の設計・実装記録を通して矛盾しない責任分離の説明と検証条件。

- [ ] **Step 1: 2026-07-17 設計書の責任とフォールバックを同期する**

`設定の責務`、`AGENTS.md の変更`、`エラーとフォールバック` を次の要件へ更新する。

```markdown
- `AGENTS.md` は、どの場面でどの役割を使うかを定める。custom agent種別を選択できるsurfaceでは対応agentを使い、選択できないsurfaceでは汎用subagentへ同じ役割制約を渡す。
- `.codex/agents/*.toml` は、対応surfaceで選択された各custom agentのモデル、推論強度、権限、専門指示を定める。`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。
- モデル、推論強度、custom agent種別、permissionを独立して判定する。custom agentを選択した場合はTOMLの明示値または意図的な親継承を正とし、per-dispatch overrideはsurfaceが公開する場合だけ使用する。どちらも選択・確認できない場合は実効値を推測しない。
- 親のlive runtime permission overrideはcustom agentの `default_permissions` より後に適用されて既定値を上書きし得る。surfaceで選択・確認できた実効permissionだけを技術的境界として扱う。
- 読み取り専用役のpermissionを選択・確認できない場合も編集禁止を指示するが、技術的read-onlyとは扱わない。同じsurface制約は起動ごとに定型報告せず、作業の信頼性判断に影響する場合に最終報告で一度記載する。技術的read-onlyが必須の検証は対応surfaceへ移すか未実施とする。
```

`エラーとフォールバック` では次を明記する。

```markdown
- `gpt-5.6-terra` が利用できないと確認された場合、暗黙の代替モデルを推測しない。per-dispatch overrideを利用できる場合は利用可能なモデルを明示し、利用できない場合は実効モデル不明として扱う。
- custom agent種別を選択できない場合、汎用subagentへ同じ役割、対象範囲、編集可否を指示する。`task_name`の一致をcustom agent読み込みの証拠にしない。
- model override、custom agent種別、live runtime permissionのうち、利用できない能力だけを個別にfallbackする。指定できない項目があることだけを理由に、安全な読み取り作業を停止しない。
- 技術的read-onlyまたはcustom agentの実効設定そのものが検証要件である場合、対応surfaceの新しいCodexプロセスで確認するまで完全検証済みとしない。
```

runtime matrix の検証項目は、custom agent種別とpermission遷移を選択・確認できるsurfaceに限定する。非対応surfaceでは汎用subagent fallbackの指示内容と、実効値を適用済みと報告しないことだけを確認し、4種類のcustom agent load証拠として扱わない。

`変更対象` では、当初の実装対象と今回の同期対象を分け、今回 `SubAgents.md`、`AGENTS.md`、2026-07-17設計書・実装Plan・引継ぎ文書を同期し、`.codex/config.toml` と `.codex/agents/*.toml` は変更しないことを明記する。

- [ ] **Step 2: 2026-07-17 実装Planを能力別の条件へ同期する**

Global Constraints と Task 2 の期待内容へ次を追加し、model と custom agent種別をまとめた既存の1行を置き換える。

```markdown
- custom agent種別、モデル、推論強度、permissionを独立して判定する。`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。
- custom agent種別を選択できる場合はagent TOMLの明示値または意図的な親継承を正とする。per-dispatch model overrideはsurfaceが公開する場合だけ使用する。
- custom agent種別を選択できない場合は汎用subagentへ同じ役割制約を渡す。選択・確認できないモデル、推論強度、permissionを適用済みと報告しない。
- 読み取り専用役の実効permissionを選択・確認できない場合、編集禁止は指示上の制約として扱う。同じsurface制約は起動ごとに定型報告せず、信頼性判断に影響する場合に最終報告で一度記載する。
```

Task 3 のruntime matrixは次の条件へ更新する。

```markdown
Run: custom agent種別とlive runtime permissionを選択・確認できる新しいCodexプロセスで、4-agent runtime matrixを実行する。対応しないsurfaceではこのmatrixを代替実行せず、汎用subagent fallbackと実効値未確認の報告だけを検証する。

Expected: 対応surfaceでは4種類のcustom agent load、固有指示、実効permission、必要なpermission遷移を観測する。非対応surfaceの `task_name` や役割プロンプトはcustom agent loadの証拠にせず、完全検証済みと記録しない。
```

Task 2 の `Files` と `Interfaces` は次の内容を含むように更新する。

```markdown
- Modify: `AGENTS.md` — capability別の役割選択、モデル選択、permission境界を定める。
- Modify: `SubAgents.md` — custom agent TOML、親継承、per-dispatch overrideのモデル優先順位を定める。

**Interfaces:**
- Consumes: Task 1が定義した4種類のcustom agent TOMLと、surfaceが公開する選択能力。
- Produces: custom agent選択可能時と汎用subagent fallbackの役割規定、モデル優先順位、実効permissionと指示上の制約の区別。
```

- [ ] **Step 3: 引継ぎ文書で候補4を解決済みにする**

`未完了事項` の候補4と再開用プロンプトを、次の状態へ更新する。

```markdown
4. **解決済み**: `SubAgents.md` のdispatch時model絶対指定は、custom agent TOML、意図的な親継承、利用可能なsurface overrideの優先順位へ置き換えた。model、custom agent種別、permissionは独立してfallbackし、`task_name`をcustom agent loadの証拠にしない。設計は `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` を正とする。
```

未判定候補の件数を4件へ変更し、再開用プロンプトは候補1、2、3、5だけをVALID / REJECTED / UNPROVENへ分類するよう変更する。per-dispatch model指定を残余UNPROVENから除外し、runtime matrixは対応surfaceでのみ実施するよう明記する。

- [ ] **Step 4: 文書間の整合性を検証する**

Run: ``rg -n 'Always pass `model` explicitly|モデルまたはカスタムエージェント種別を実行環境|利用可能なカスタムエージェントを選び' AGENTS.md SubAgents.md docs/superpowers/specs docs/superpowers/plans``

Expected: 出力なし、終了コード1。

Run: `rg -n 'task_name.*証拠|custom agent種別、モデル、推論強度、permission|per-dispatch model override|汎用subagent' AGENTS.md SubAgents.md docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md`

Expected: 各文書で、4制約の独立判定、`task_name`非証拠性、surface限定override、汎用subagent fallbackが確認できる。

Run: `rg -n 'Docker daemon.*rw bind mount|clean baseline|staged diff.*unstaged diff.*untracked' AGENTS.md .codex/agents/fast-worker.toml docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md`

Expected: Docker境界と実行前後Git状態比較が削除されず、関連文書に残っている。

Run: `git diff -- .codex/config.toml .codex/agents`

Expected: 出力なし、終了コード0。

Run: `git diff --check`

Expected: 出力なし、終了コード0。

- [ ] **Step 5: Task 2 をコミットする**

```bash
git add docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md
git commit -m "docs: サブエージェント責任分離へ同期"
```

Expected: 3文書だけを含むコミットが作成される。

- [ ] **Step 6: 最終状態を確認する**

Run: `git status --short`

Expected: 出力なし、終了コード0。

Run: `git log -3 --oneline --decorate`

Expected: 設計コミットに続き、Task 1 と Task 2 の日本語 Conventional Commits が表示される。
