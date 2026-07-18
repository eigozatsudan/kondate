# Codex Subagent Responsibility Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex surface ごとの能力差を考慮し、サブエージェントの役割、モデル、推論強度、permission の指定責任を独立させる。

**Architecture:** `AGENTS.md` は役割選択と capability fallback、`SubAgents.md` は Task ごとのモデル選択優先順位を正本として定める。既存の custom agent TOML は対応 surface 向けの役割プロファイルとして維持し、2026-07-17 の設計・実装Plan・引継ぎ文書を新しい責任分離へ同期する。

**Tech Stack:** Codex custom agents、permission profiles、Markdown、Git

## Global Constraints

- 正本は `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` とする。
- custom agent 種別、モデル、推論強度、permission を独立して判定する。
- custom agent 種別の選択と読み込みを確認できた場合だけ、対応する agent TOML を設定根拠として扱う。
- `task_name` の一致を custom agent の選択または読み込みの証拠として扱わない。
- custom agent 種別を選択・確認できない surface では、汎用 subagent に役割、対象範囲、編集可否を明示する。
- custom agent 種別も per-dispatch model override も選択できない場合、実効モデルを推測しない。
- per-dispatch model override はモデルだけに適用し、推論強度は独立した設定または override を確認できる場合だけ適用済みとする。
- surface で選択・確認できた実効 permission だけを技術的境界として扱う。
- 技術的 read-only を確認できない読み取り役は Implementer と同時実行せず、完了または close してから Implementer を起動する。
- Docker daemon の rw bind mount を Codex filesystem permission の技術的境界として扱わない。
- `.codex/config.toml` と `.codex/agents/*.toml` は変更しない。
- アプリケーションコード、DB、UI、依存関係を変更しない。
- Node/npm コマンドは不要であり、Vitest、pgTAP、E2E、ビルドは実行しない。

## File Structure

- Modify: `AGENTS.md` — 全体のモデル選択規定、role、permission の capability fallback を定める。
- Modify: `SubAgents.md` — per-dispatch model の絶対指定を優先順位方式へ置き換える。
- Modify: `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` — 正本自体へ選択・読み込み確認、model-only override、reasoning独立確認、read-only直列化を反映する。
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
2. **モデルの選択**: custom agent種別の選択と読み込みを確認できる場合は、そのagent TOMLの明示値または意図的な親継承を正とする。per-dispatch model overrideはモデルだけに適用し、推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとする。各実効値を確認できない場合は個別に未確認として扱い、推測しない。
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
- custom agent種別、モデル、推論強度、permissionは独立して判定する。利用中のsurfaceでcustom agent種別の選択と読み込みを確認できる場合は役割に対応するagentを使用し、`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。種別を選択・確認できない場合は汎用subagentに同じ役割、対象範囲、編集可否を指示する。
- custom agentの読み込みを確認できた場合、モデルと推論強度はそのagent TOMLの明示値または意図的な親継承をそれぞれの設定根拠とする。per-dispatch model overrideはモデルだけに適用し、推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとする。各実効値を確認できない場合は個別に未確認として扱い、必要な場合だけ実際に使用した代替手段を最終報告へ記載する。
- 親のlive runtime permission overrideはcustom agentの既定権限を上書きし得る。`explorer`、`reviewer`、`fast-worker`の起動前にread-onlyのlive runtime permissionを選択・確認できた場合だけ、Codex filesystemに対する技術的境界として扱う。選択・確認できない場合も編集禁止を指示するが、技術的read-onlyとは扱わない。技術的read-onlyを確認できない読み取り役はImplementerと同時実行せず、完了またはcloseしてからImplementerを起動する。同じsurface制約を起動ごとに定型報告せず、作業の信頼性判断に影響する場合に最終報告で一度記載する。技術的read-onlyが必須の検証を実施できない場合は直ちに停止して報告する。
- 親が検証のためworkspace-capable permissionへの切替を試みる前に、希望する通常permissionを記録する。切替を試みた後は、検証の成功・失敗・skipを問わず、すべての終了経路でcleanupとして通常permissionへ明示的に復元し、実効状態を確認する。復元または確認に失敗した場合は新しい作業を開始せず、完全検証済みとせずに未解決制約として報告する。
- コードベースや設計書の読み取り調査には `explorer` 役を使用する。custom agent種別を選択できない場合は汎用subagentへ読み取り専用の調査役を指示する。live overrideで書き込み可能になっていても、リポジトリの編集を拒否させる。
- Node/npmによる定型テスト、型チェック、Lint、フォーマット検証と、指定されたCodex CLI、`rg`、Git等のホストコマンドの実行・ログ要約には `fast-worker` 役を使用する。これは `SubAgents.md` の Verifier 役であり、custom agent種別を選択できない場合は汎用subagentへ同じ役割を指示する。Docker daemonのrw bind mountはCodexのread-only filesystemに対する技術的境界外である。`fast-worker` 役は、コマンド自体または既知の通常動作がhost worktreeの作成・変更・削除を意図するDocker payloadだけを拒否する。親はclean baselineでのみDockerコマンドを開始し、実行前後のstaged diff、unstaged diff、untracked一覧を保存して比較する。ignored pathは比較対象外とし、意図しない差分が生じた場合は新しい作業を止めて報告する。
- Taskのコード変更には `implementer` 役を使用する。single-writerはCodex設定による役別同時数の技術的制限やロックではなく、親が維持する運用上のオーケストレーション不変条件である。同じworktreeを操作するCodex親プロセス／セッションは1つだけとし、並行する親は別worktreeを使用する。親はImplementerを起動する前に、同じworktreeに別の親がいないこと、active Implementerがいないこと、技術的read-onlyを確認できない読み取り役がactiveでないことを確認する。既存Implementerまたは該当する読み取り役が完了またはcloseされるまでImplementerを起動してはいけない。worktreeの排他性またはactive状態を確認できない場合はImplementerを起動せず、その制約を報告する。
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

1. If the surface can select a named custom agent and confirm that it was
   loaded, use its explicit `model` and `model_reasoning_effort` as the
   configuration sources for those separate values. An omitted value
   intentionally inherits the parent session setting, but do not claim the
   effective inherited value unless it can be confirmed.
2. If the surface exposes a per-dispatch model override, the controller may
   override only the model to match the Task tier above. Treat reasoning effort
   as unchanged unless a separate setting or override can be confirmed.
3. Evaluate permission independently from both model values. A model or
   reasoning setting does not prove that the agent TOML permission took effect.
4. If neither custom-agent selection nor a model override is available, do not
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

Run: `rg -n 'task_name|選択と読み込み|per-dispatch model overrideはモデルだけ|推論強度は独立|技術的read-onlyを確認できない読み取り役|汎用subagent|reviewer.*TOML' AGENTS.md SubAgents.md`

Expected: custom agentの選択と読み込みの確認、`task_name`を選択・読み込み証拠にしない規定、モデルだけに適用するper-dispatch override、推論強度の独立確認、4制約の独立判定、汎用subagent fallback、技術的read-only未確認役とImplementerの直列化が出力される。

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
- Modify: `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md:16-87`
- Modify: `docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md:17-28,81-103,109-139`
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md:11-21,193-237,314-334`
- Modify: `docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md:33-47,65-76`

**Interfaces:**
- Consumes: Task 1 が定義した role、model、reasoning、permission の優先順位と capability fallback、および責任分離の正本design。
- Produces: 新旧の設計・実装記録を通して矛盾しない責任分離の説明と検証条件。

- [ ] **Step 1: 責任分離の正本designを5条件へ同期する**

`docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` の責任表、custom agent、モデル選択、permission、surface別フォールバック、検証を次の5条件へ統一する。

```markdown
- custom agent TOMLは種別の選択と読み込みを確認できた場合だけ設定根拠とする。
- `task_name`の一致をcustom agentの選択・読み込み証拠にしない。
- per-dispatch model overrideはモデルだけに適用する。
- 推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとする。
- 技術的read-onlyを確認できない読み取り役はImplementerと同時実行せず、完了またはcloseしてから起動する。
```

- [ ] **Step 2: 2026-07-17 設計書の責任とフォールバックを同期する**

`設定の責務`、`AGENTS.md の変更`、`エラーとフォールバック` を次の要件へ更新する。

```markdown
- `AGENTS.md` は、どの場面でどの役割を使うかを定める。custom agent種別の選択と読み込みを確認できるsurfaceでは対応agentを使い、選択・確認できないsurfaceでは汎用subagentへ同じ役割制約を渡す。
- `.codex/agents/*.toml` は、対応surfaceで選択と読み込みを確認できた各custom agentのモデル、推論強度、権限、専門指示を定める。`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。
- モデル、推論強度、custom agent種別、permissionを独立して判定する。custom agentの読み込みを確認できた場合はTOMLの明示値または意図的な親継承をモデルと推論強度それぞれの設定根拠とする。per-dispatch overrideはモデルだけに適用し、推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとする。各実効値を確認できない場合は個別に未確認として扱い、推測しない。
- 親のlive runtime permission overrideはcustom agentの `default_permissions` より後に適用されて既定値を上書きし得る。surfaceで選択・確認できた実効permissionだけを技術的境界として扱う。
- 読み取り専用役のpermissionを選択・確認できない場合も編集禁止を指示するが、技術的read-onlyとは扱わず、その役はImplementerと同時実行しない。完了またはcloseしてからImplementerを起動する。同じsurface制約は起動ごとに定型報告せず、作業の信頼性判断に影響する場合に最終報告で一度記載する。技術的read-onlyが必須の検証は対応surfaceへ移すか未実施とする。
```

`エラーとフォールバック` では次を明記する。

```markdown
- `gpt-5.6-terra` が利用できないと確認された場合、暗黙の代替モデルを推測しない。per-dispatch model overrideを利用できる場合は利用可能なモデルだけを明示し、推論強度は独立した設定またはoverrideを確認できない限り変更済みと扱わない。model overrideを利用できない場合は実効モデル不明として扱う。
- custom agent種別を選択・確認できない場合、汎用subagentへ同じ役割、対象範囲、編集可否を指示する。`task_name`の一致をcustom agent読み込みの証拠にしない。
- model override、推論強度、custom agent種別、live runtime permissionのうち、利用できない能力だけを個別にfallbackする。指定できない項目があることだけを理由に、安全な読み取り作業を停止しない。
- 技術的read-onlyまたはcustom agentの実効設定そのものが検証要件である場合、対応surfaceの新しいCodexプロセスで確認するまで完全検証済みとしない。
```

runtime matrix の検証項目は、custom agent種別の選択と読み込み、モデル、推論強度、permission遷移を個別に確認できるsurfaceに限定する。非対応surfaceでは汎用subagent fallbackの指示内容と、実効値を適用済みと報告しないことだけを確認し、`task_name`や役割プロンプトを4種類のcustom agent load証拠として扱わない。技術的read-onlyを確認できない読み取り役は完了またはcloseしてからImplementerを起動する。

`変更対象` では、当初の実装対象と今回の同期対象を分け、今回 `SubAgents.md`、`AGENTS.md`、2026-07-17設計書・実装Plan・引継ぎ文書を同期し、`.codex/config.toml` と `.codex/agents/*.toml` は変更しないことを明記する。

- [ ] **Step 3: 2026-07-17 実装Planを能力別の条件へ同期する**

Global Constraints と Task 2 の期待内容へ次を追加し、model と custom agent種別をまとめた既存の1行を置き換える。

```markdown
- custom agent種別、モデル、推論強度、permissionを独立して判定する。custom agent種別の選択と読み込みを確認できた場合だけagent TOMLを設定根拠とし、`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。
- custom agentの読み込みを確認できた場合はagent TOMLの明示値または意図的な親継承をモデルと推論強度それぞれの設定根拠とする。per-dispatch model overrideはモデルだけに適用し、推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとする。
- custom agent種別を選択・確認できない場合は汎用subagentへ同じ役割制約を渡す。選択・確認できないモデル、推論強度、permissionを適用済みと報告しない。
- 読み取り専用役の実効permissionを選択・確認できない場合、編集禁止は指示上の制約として扱い、その役はImplementerと同時実行せず、完了またはcloseしてからImplementerを起動する。同じsurface制約は起動ごとに定型報告せず、信頼性判断に影響する場合に最終報告で一度記載する。
```

Task 3 のruntime matrixは次の条件へ更新する。

```markdown
Run: custom agent種別の選択と読み込み、モデル、推論強度、live runtime permissionを個別に確認できる新しいCodexプロセスで、4-agent runtime matrixを実行する。読み取り専用3役のtechnical read-onlyを確認できない場合は、それらを完了またはcloseしてからImplementerを起動する。対応しないsurfaceではこのmatrixを代替実行せず、汎用subagent fallbackと実効値未確認の報告だけを検証する。

Expected: 対応surfaceでは4種類のcustom agent load、固有指示、モデル、推論強度、実効permission、必要なpermission遷移を個別に観測する。per-dispatch model overrideはモデルだけの変更として扱う。非対応surfaceの `task_name` や役割プロンプトはcustom agent loadの証拠にせず、完全検証済みと記録しない。
```

Task 2 の `Files` と `Interfaces` は次の内容を含むように更新する。

```markdown
- Modify: `AGENTS.md` — capability別の役割選択、モデル選択、permission境界を定める。
- Modify: `SubAgents.md` — custom agent TOML、親継承、per-dispatch overrideのモデル優先順位を定める。

**Interfaces:**
- Consumes: Task 1が定義した4種類のcustom agent TOMLと、surfaceが公開する選択・読み込み確認能力。
- Produces: custom agentの選択・読み込み確認と汎用subagent fallbackの役割規定、モデルと推論強度の個別確認、実効permissionと指示上の制約の区別、read-only未確認役とImplementerの直列化。
```

- [ ] **Step 4: 引継ぎ文書で候補4を解決済みにする**

`未完了事項` の候補4と再開用プロンプトを、次の状態へ更新する。

```markdown
4. **解決済み**: `SubAgents.md` のdispatch時model絶対指定は、選択と読み込みを確認できたcustom agent TOML、意図的な親継承、利用可能なsurface overrideの優先順位へ置き換えた。per-dispatch overrideはmodelだけに適用し、reasoningは独立した設定またはoverrideを確認できる場合だけ適用済みとする。model、reasoning、custom agent種別、permissionは独立してfallbackし、`task_name`をcustom agent loadの証拠にしない。技術的read-onlyを確認できない読み取り役はImplementerと直列化する。設計は `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` を正とする。
```

未判定候補の件数を4件へ変更し、再開用プロンプトは候補1、2、3、5だけをVALID / REJECTED / UNPROVENへ分類するよう変更する。per-dispatch model指定を残余UNPROVENから除外し、runtime matrixは対応surfaceでのみ実施するよう明記する。

- [ ] **Step 5: 文書間の整合性を検証する**

次の各対象へ、下記のpositive checkとobsolete negative checkを**1文書ずつ独立したコマンド**として実行する。複数文書を1回のOR検索へ渡してはいけない。

```text
AGENTS.md
SubAgents.md
docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md
docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md
docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md
docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md
```

Run for each file: `rg --pcre2 -U -l '(?s)(?=.*(?:選択と読み込み|select a named custom agent and confirm that it was\s+loaded))(?=.*task_name.*(?:証拠|not\s+evidence))(?=.*(?:per-dispatch(?: model)? override.{0,100}モデルだけ|override only the model))(?=.*(?:推論強度.{0,100}(?:独立|個別)|reasoning effort.{0,100}(?:unchanged|separate)))(?=.*(?:技術的\s*read-only|technical\s+read-only))(?=.*Implementer)' <file>`

Expected for each file: そのファイル名が1行出力され、終了コード0。5条件のどれか1つでも欠ければ終了コード1になる。

Run for each file: ``rg -n 'Always pass `model` explicitly|モデルまたはカスタムエージェント種別を実行環境|利用可能なカスタムエージェントを選び' <file>``

Expected for each file: 出力なし、終了コード1。obsolete表現が1つでも残れば、その文書のコマンドだけが終了コード0となり対象を特定できる。

Run: `rg -n 'Docker daemon.*rw bind mount|clean baseline|staged diff.*unstaged diff.*untracked' AGENTS.md .codex/agents/fast-worker.toml docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md`

Expected: Docker境界と実行前後Git状態比較が削除されず、関連文書に残っている。

Run: `git diff -- .codex/config.toml .codex/agents`

Expected: 出力なし、終了コード0。

Run: `git diff --check`

Expected: 出力なし、終了コード0。

- [ ] **Step 6: Task 2 をコミットする**

```bash
git add docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md
git commit -m "docs: サブエージェント責任分離へ同期"
```

Expected: 責任分離の正本designを含む4文書だけのコミットが作成される。

- [ ] **Step 7: 最終状態を確認する**

Run: `git status --short`

Expected: 出力なし、終了コード0。

Run: `git log -3 --oneline --decorate`

Expected: 設計コミットに続き、Task 1 と Task 2 の日本語 Conventional Commits が表示される。
