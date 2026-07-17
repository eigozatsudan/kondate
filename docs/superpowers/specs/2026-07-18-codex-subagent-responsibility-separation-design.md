# Codex サブエージェント制約の責任分離設計

## 目的

サブエージェントの役割、モデル、権限を別々の制約として扱い、利用中の Codex surface が公開する機能に応じて適切に適用する。指定できない項目を適用済みとみなさず、同時に、surface の制限だけを理由として安全な読み取り作業を不必要に停止しない。

## 背景

現行の `SubAgents.md` は、すべての dispatch で `model` を明示するよう要求している。一方、`.codex/agents/*.toml` は、`explorer` と `fast-worker` のモデルをファイル内で固定し、`implementer` と `reviewer` のモデルを親から継承する設計である。この二つはモデル指定の責任箇所が異なり、per-dispatch のモデル引数を公開しない surface では前者を実行できない。

また、現在利用できる dispatch API の `task_name` はスレッド識別子であり、同名の custom agent が選択・読み込みされた証拠にはならない。モデル、custom agent 種別、live runtime permission を一つの「サブエージェント指定能力」として扱うと、どの制約が適用済みで、どの制約が指示だけに留まるか判定できない。

## 設計方針

### 制約ごとの責任

| 制約 | 正本 | 適用条件 | 指定できない場合 |
| --- | --- | --- | --- |
| 役割 | `AGENTS.md` と各 agent TOML の `developer_instructions` | surface が custom agent 種別を選択できる場合は該当 agent を選ぶ | 汎用 subagent に同じ役割、対象範囲、編集可否を明示する |
| モデル | custom agent を選択した場合はその TOML。モデルを省略した agent は親設定 | surface が per-dispatch model override を公開する場合だけ、Task の判断に基づき上書きできる | 利用モデルを推測せず、親または Codex の選択に委ねる |
| 推論強度 | custom agent TOML、または親設定 | custom agent の読み込み、もしくは surface の明示指定を確認できる場合 | 実効値を推測しない |
| filesystem permission | 親の live runtime permission と custom agent の `default_permissions` | surface で選択・確認できた実効 permission だけを技術的境界として扱う | 読み取り専用役へ編集禁止を指示するが、技術的な read-only とは報告しない |
| Docker 経由の書き込み防止 | Docker payload の制限と親による Git 状態比較 | clean baseline と実行前後比較を確認できる場合 | Verifier を開始せず、未解決制約として報告する |

### custom agent の扱い

既存の `.codex/agents/explorer.toml`、`fast-worker.toml`、`implementer.toml`、`reviewer.toml` は、対応 surface で選択できる役割プロファイルとして維持する。今回の修正では、モデル、推論強度、`default_permissions` を変更しない。

custom agent 種別を選べない surface では、`task_name` が一致しただけで該当 TOML を読み込んだとみなさない。汎用 subagent に役割指示を渡し、モデル、推論強度、permission の実効値をそれぞれ独立して判定する。

### モデル選択

`SubAgents.md` の「dispatch で常に `model` を明示する」という絶対条件を廃止する。

- custom agent を選択できる場合、agent TOML のモデル設定または意図的な親継承を正とする。
- per-dispatch model override を公開する surface では、Task の難易度に応じて明示上書きしてよい。
- custom agent 種別も model override も選択できない場合、実効モデルを推測しない。必要なら、モデルを確認できなかったことと実際に使用した汎用 subagent を最終報告へ記載する。
- モデルを指定できないことだけを理由に、安全な読み取り調査や定型検証を停止しない。

### permission と報告

`explorer`、`fast-worker`、`reviewer` は、引き続き編集を拒否する読み取り専用役とする。ただし、次を区別する。

1. 実効 read-only permission を選択・確認できた場合は、Codex filesystem に対する技術的境界として扱う。
2. 選択・確認できない場合は、developer instruction による運用上の制約として扱う。
3. Docker daemon の rw bind mount は、どちらの場合も Codex filesystem permission の境界外として扱う。

同じ surface 制約をサブエージェント起動ごとに定型報告しない。最終報告で作業の信頼性判断に影響する場合に一度記載する。ただし、意図しない差分、権限復元失敗、技術的 read-only が必須の検証を実施できない状態を検出した場合は、直ちに停止して報告する。

### surface 別フォールバック

- custom agent、モデル、permission を選択・確認できる surface: 該当する役割プロファイルと live permission を使用する。
- custom agent だけ選択できる surface: agent TOML を使用し、親 live override を含む実効 permission を別途確認する。
- いずれも選択できない surface: 汎用 subagent に役割制約を渡す。モデルと permission を適用済みと主張しない。
- 技術的な read-only が検証要件である場合: 対応 surface の別セッションへ移すか、未実施として扱う。自然言語の編集禁止だけで完全検証済みにしない。

## 変更範囲

実装では次を同期する。

- `AGENTS.md`: モデル、custom agent 種別、permission を独立して判定する規定と、汎用 subagent のフォールバックを追加する。
- `SubAgents.md`: per-dispatch model の絶対指定を廃止し、custom agent TOML、親継承、surface override の優先順位を定める。
- `docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md`: capability 別フォールバックと責任分離を反映する。
- `docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md`: 実装済み設定の説明と検証条件を新しい責任分離へ同期する。
- `docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md`: model 指定の既知不整合を解決済みとして更新する。

今回の実装では `.codex/config.toml` と `.codex/agents/*.toml` を変更しない。Docker verifier の専用 read-only 実行基盤も別設計とし、今回の範囲には含めない。

## 検証

- `AGENTS.md`、`SubAgents.md`、既存設計書、Plan、引継ぎ文書で、モデル指定の優先順位が一致すること。
- `task_name` を custom agent 選択の証拠として扱う記述がないこと。
- per-dispatch model 指定が利用可能な surface に限られていること。
- 実効 permission と指示上の編集禁止が区別されていること。
- Docker daemon の rw bind mount に関する残余制約が維持されていること。
- `.codex/config.toml` と `.codex/agents/*.toml` に差分がないこと。
- `git diff --check` が成功すること。

アプリケーションコード、DB、UI、依存関係を変更しないため、Vitest、pgTAP、E2E、ビルドは対象外とする。

## 完了条件

- モデル、役割、permission の指定責任が別々に定義されている。
- 対応 surface では既存 custom agent 設定を利用できる。
- 非対応 surface では汎用 subagent へ安全にフォールバックできる。
- 指定・確認できなかった実効値を適用済みと報告しない。
- 同一の surface 制約を起動のたびに繰り返さず、必要な場合だけ最終報告へ集約する。
