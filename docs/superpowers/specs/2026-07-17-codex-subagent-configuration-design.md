# Codex サブエージェント構成設計

## 目的

Codex の親エージェントに設計・統合・最終判断を集中させながら、調査、定型検証、実装、レビューを適切なカスタムエージェントへ委譲し、品質を落とさず実装時間とコンテキスト消費を削減する。

## 現状

- グローバル Codex 設定が親モデルと推論強度を管理している。
- リポジトリの `.codex/config.toml` はワークスペース権限だけを定義している。
- `AGENTS.md` は親、`fast-worker`、`explorer` の責務と単一書き込み方針を簡潔に定めている。
- `SubAgents.md` は Implementer、Reviewer、Verifier の三役分離、Task ごとの実行順序、ファイルによる引き継ぎを詳しく定めている。
- 現在の実行環境は親を含む最大 4 枠を提供している。一方、Codex の `agents.max_threads` が親スレッドを数えるかは公式仕様で明示されていない。

## 設計方針

### 設定の責務

- グローバル Codex 設定は親モデルの選択を担当する。リポジトリ側では親モデルを固定しない。
- `AGENTS.md` は、どの場面でどのカスタムエージェントを使うかを定める。
- `SubAgents.md` は、Task 単位の詳細な実行順序と引き継ぎ方法の正本として維持する。
- `.codex/config.toml` は、サブエージェント機能、並列数、エージェントのネスト上限、既定の権限プロファイルを定める。
- `.codex/agents/*.toml` は、各カスタムエージェントのモデル、推論強度、権限、専門指示を定める。
- 権限設定は新しい権限プロファイル方式に統一する。既存の `default_permissions = ":workspace"` を維持し、カスタムエージェントでは `default_permissions` を役割別に上書きする。旧式の `sandbox_mode` と `[sandbox_workspace_write]` は併用しない。

### 並列実行

- `agents.max_threads` は `4` とし、同時に開くエージェントスレッドを抑制する。この値が親スレッドを含むかは未確定のため、直接サブエージェント数を固定的に説明しない。
- 実際の同時実行数は、Codex の設定上限と実行環境が提供する枠の小さい方に従う。
- `agents.max_depth` は `1` とし、サブエージェントから孫エージェントを生成させない。
- 調査などの独立した読み取り作業は並列化してよい。
- リポジトリを書き込む Implementer は常に 1 体だけとし、並列書き込みを禁止する。

## カスタムエージェント

### `explorer`

- 用途: 関連ファイル、既存実装、設計書、依存関係の調査。
- モデル: `gpt-5.6-terra`。
- 推論強度: `low`。
- 権限プロファイル: `default_permissions = ":read-only"`。
- 出力: 結論、根拠となるファイルパス、実装上の注意点。コードや設定は変更しない。

### `fast-worker`

- 用途: Docker 経由の定型テスト、型チェック、Lint、フォーマット検証、ログの要約。`SubAgents.md` の Verifier 役として使用する。
- モデル: `gpt-5.6-terra`。
- 推論強度: `low`。
- 権限プロファイル: `default_permissions = ":workspace"`。Docker や検証ツールが作業領域を利用できるようにするためであり、リポジトリファイルの編集は開発者指示で禁止する。
- 出力: コマンドごとの成功・失敗、失敗時の原因箇所、短いログ抜粋。大量の生ログは親へ返さない。

### `implementer`

- 用途: RED テスト、GREEN 実装、Task 内リファクタリング、focused 検証。唯一の書き込み担当。
- モデル: 親エージェントから継承する。
- 推論強度: 親エージェントから継承する。
- 権限プロファイル: `default_permissions = ":workspace"`。
- 制約: Task brief と対象ファイルの範囲を守り、仕様やロック済みインターフェースを独自に変更しない。

### `reviewer`

- 用途: 設計適合性、正しさ、セキュリティ、敵対的入力、境界条件、回帰、テスト不足のレビュー。
- モデル: 親エージェントから継承する。
- 推論強度: `high`。
- 権限プロファイル: `default_permissions = ":read-only"`。
- 出力: Critical、Important、Minor の重要度、根拠となるファイルと行、再現条件、推奨修正。
- 一次レビューと二次検証には、コンテキストを共有しない別々の `reviewer` インスタンスを使用する。

## `AGENTS.md` の変更

既存の「サブエージェント運用」を置き換えず、次を明確化する。

- `explorer`、`fast-worker`、`implementer`、`reviewer` と `SubAgents.md` の役割対応。
- 並列化する対象は独立した読み取り作業であること。
- Implementer は唯一の書き込み担当であること。
- Verifier 役の定型検証結果と Reviewer の報告を親が確認してから採用すること。
- 一次レビューと、レビュー指摘を深掘りする二次検証は別々の Reviewer エージェントで行うこと。Docker コマンドを再実行する Verifier 役の検証とは別概念であることを明記する。
- モデルやエージェント種別を実行環境の API で直接指定できない場合は、利用可能なカスタムエージェントを選び、指定できなかった事実を報告すること。

詳細手順は重複記載せず、`SubAgents.md` を参照する。

## エラーとフォールバック

- `gpt-5.6-terra` が利用できない場合、Codex が暗黙に別モデルへ切り替えたと仮定しない。親へ利用不可を報告し、利用可能な高速モデルまたは親モデルを選ぶ。
- `[features].multi_agent` を明示的に有効化する。サブエージェントを生成できない場合は、実効設定と利用中のCodexバージョンを確認する。
- カスタムエージェントが読み込まれない場合、Codex を再起動して設定を再読込する。
- サブエージェントの結果が不完全、矛盾、または根拠不足の場合、親が再調査するか別エージェントで検証する。
- Reviewer または Verifier に Critical／Important の指摘がある場合、次の Task へ進まず、同じ Implementer 役で修正して再検証する。

## 検証

この変更は Codex の指示・設定だけを変更し、アプリケーションの実行コード、DB、UIには影響しない。次を独立して確認する。

1. 本実装前の最小検証として、既存の `default_permissions` に `sandbox_mode` を重ねた場合の実機挙動を確認する。Codex 0.144.5 の `--strict-config` はこの併用を構文エラーにせず旧式設定を優先したため、厳格読込だけを安全性の根拠にしない。
2. `.codex/config.toml` の既存 `default_permissions = ":workspace"` を維持し、リポジトリ設定と全カスタムエージェント定義に `sandbox_mode` および `[sandbox_workspace_write]` が存在しないことを確認する。
3. Codex の厳格設定読込で `.codex/config.toml` とカスタムエージェント定義が受理されること。
4. `codex doctor` で、親と各カスタムエージェントに意図した実効権限プロファイルが適用されることを確認する。CLI がエージェント単位の実効設定を表示できない場合は、各ファイルを個別の設定レイヤーとして読み込む最小検証を行う。
5. 追加した TOML を構文解析できること。
6. `[features].multi_agent = true` が実効設定で有効であることを確認する。
7. `agents.max_threads` が親を数えるかは文書化済み仕様または実機で確認できた場合だけ断定し、確認できない場合は未確定事項として維持する。
8. `AGENTS.md`、`SubAgents.md`、各 TOML の役割と権限が矛盾しないこと。
9. `git diff --check` が成功すること。

アプリケーションコードを変更しないため、Vitest、DB リセット、pgTAP、E2E、ビルドはこの設定変更の検証対象外とする。

## 変更対象

- `AGENTS.md`
- `.codex/config.toml`
- `.codex/agents/explorer.toml`
- `.codex/agents/fast-worker.toml`
- `.codex/agents/implementer.toml`
- `.codex/agents/reviewer.toml`

既存のグローバル Codex 設定、`SubAgents.md`、アプリケーションコード、設計済みのMVP仕様、未コミットのPlan文書は変更しない。

`.codex/config.toml` の既存 `default_permissions = ":workspace"` は維持する。同ファイルには `[features].multi_agent = true` と `[agents]` の上限設定だけを追記し、旧式のサンドボックス設定へ移行しない。
