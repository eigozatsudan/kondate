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
- `AGENTS.md` は、どの場面でどの役割を使うかを定める。custom agent種別の選択と読み込みを確認できるsurfaceでは対応agentを使い、確認できないsurfaceでは汎用subagentへ同じ役割制約を渡す。
- `SubAgents.md` は、Task 単位の詳細な実行順序と引き継ぎ方法の正本として維持する。
- `.codex/config.toml` は、サブエージェント機能、並列数、エージェントのネスト上限、既定の権限プロファイルを定める。
- `.codex/agents/*.toml` は、対応surfaceで選択・読み込みを確認できた各custom agentのモデル、推論強度、権限、専門指示を定める。`task_name`の一致だけをcustom agentの選択・読み込みの証拠にしない。
- custom agent種別、モデル、推論強度、permissionを独立して判定する。custom agentの読み込みを確認できた場合はTOMLの明示値または意図的な親継承を各値の設定根拠とし、per-dispatch model overrideはモデルだけに適用する。推論強度は独立した設定またはoverrideを確認できる場合だけ適用済みとし、確認できない実効値を推測しない。
- 権限設定は新しい権限プロファイル方式に統一する。既存の `default_permissions = ":workspace"` を維持し、カスタムエージェントでは `default_permissions` を役割別に上書きする。旧式の `sandbox_mode` と `[sandbox_workspace_write]` は併用しない。
- 親のlive runtime permission overrideは、custom agentの `default_permissions` より後に適用されて既定値を上書きし得る。surfaceで選択・確認できた実効permissionだけを技術的境界として扱う。
- `explorer`、`reviewer`、`fast-worker` の起動前にread-onlyのlive runtime permissionを選択・確認できない場合も編集禁止を指示するが、技術的read-onlyとは扱わない。該当する読み取り役はImplementerと同時実行せず、作業の信頼性判断に影響する場合だけ最終報告で一度制約を記載する。技術的read-onlyが必須の検証は対応surfaceへ移すか未実施とする。
- Docker daemonのrw bind mountはCodexのread-only filesystemに対する技術的境界外である。filesystemがread-onlyかつapprovalがneverのfresh Codex親でも、container payloadがrepositoryへsentinelを書き込み、host側でuntracked fileとして観測された実機証拠がある。したがって、read-onlyをDockerコマンドの技術的境界とは扱わず、developer instructionによる意図的な書込みpayloadの拒否と、clean baselineを前提とする親の実行前後Git状態比較を併用する。
- workspace-capable permissionへの切替を試みる検証では、開始時の希望する通常permissionを先に記録する。切替を試みた後は、検証の成功・失敗・skipを問わず、すべての終了経路でcleanupとして通常permissionへ明示的に復元し、実効状態を確認する。復元または確認に失敗した場合は新しい作業を開始せず、完全検証済みとせずに未解決制約として報告する。

### 並列実行

- `agents.max_threads` は `4` とし、同時に開くエージェントスレッドを抑制する。この値が親スレッドを含むかは未確定のため、直接サブエージェント数を固定的に説明しない。
- 実際の同時実行数は、Codex の設定上限と実行環境が提供する枠の小さい方に従う。
- `agents.max_depth` は `1` とし、サブエージェントから孫エージェントを生成させない。
- 調査などの独立した読み取り作業は並列化してよい。
- リポジトリを書き込む Implementer は常に 1 体だけとし、並列書き込みを禁止する。これはCodex設定によるcustom agent種別ごとの技術的な同時数制限やロックではなく、親が維持する運用上のオーケストレーション不変条件である。
- 同じworktreeを操作するCodex親プロセス／セッションは1つだけとする。並行する親セッションは別worktreeを使用する。Codexはこの親プロセス間排他を役割設定で技術的に強制しない。
- 親はImplementerをdispatchする直前に、同じworktreeを操作する別の親プロセス／セッションがないこと、active Implementerがいないこと、技術的read-onlyを確認できない読み取り役がactiveでないことを確認する。既存Implementerまたは該当する読み取り役がactiveなら、完了またはcloseされるまでImplementerをdispatchしない。worktreeの排他性またはactive状態を確認できない場合はdispatchせず、未確認の制約として報告する。

## カスタムエージェント

### `explorer`

- 用途: 関連ファイル、既存実装、設計書、依存関係の調査。
- モデル: `gpt-5.6-terra`。
- 推論強度: `low`。
- 権限プロファイル: `default_permissions = ":read-only"`。
- 出力: 結論、根拠となるファイルパス、実装上の注意点。live overrideで書き込み権限が与えられていても、コード、設定、Git状態の変更を拒否する。

### `fast-worker`

- 用途: Node/npmによる定型テスト、型チェック、Lint、フォーマット検証、および指定されたCodex CLI、`rg`、Git等のホストコマンドの実行とログ要約。`SubAgents.md` の Verifier 役として使用する。
- モデル: `gpt-5.6-terra`。
- 推論強度: `low`。
- 権限プロファイル: `default_permissions = ":read-only"`。
- コマンド実行: 親から指定された正確なコマンドだけを実行する。Node/npmコマンドだけを `AGENTS.md` のDocker形式で実行し、Codex CLI、`rg`、Git、その他のホストコマンドは親から指定されたとおりホストで実行する。
- 制約: Docker daemonのrw bind mountはread-only filesystemの技術的境界外である。拒否対象は、コマンド自体または既知の通常動作がhost worktreeのファイル作成・変更・削除を意図するDocker payloadに限定する。`node -p`、`format:check`、`lint`、`typecheck`、通常テストは許可し、ファイル書込コード、`format`、スナップショット更新は拒否する。live overrideで書き込み権限が与えられていても、リポジトリファイルの作成、編集、削除、整形、ステージ、コミットを拒否し、追跡対象ファイルの差分や意図しないuntracked fileを残さない。親はclean baselineでのみDockerコマンドを開始し、実行前後のstaged diff、unstaged diff、untracked一覧を保存比較する。ignored pathは比較対象外とする。
- 出力: コマンドごとの成功・失敗、失敗時の原因箇所、短いログ抜粋。大量の生ログは親へ返さない。

### `implementer`

- 用途: RED テスト、GREEN 実装、Task 内リファクタリング、focused 検証。唯一の書き込み担当。
- モデル: 親エージェントから継承する。
- 推論強度: 親エージェントから継承する。
- 権限プロファイル: `default_permissions = ":workspace"`。
- 制約: このTOML自体はsingleton動作や同じworktreeの親プロセス間排他を技術的に強制しない。Implementerは編集前に、親から同じworktreeを操作する親が1つだけであるとの確認を受け、利用可能なagent状態とdispatch情報から自分が唯一のactive Implementerであることを確認する。親からworktreeの排他確認がない、排他性が不確実、または別のactive Implementerがいる場合は編集を停止して親へ報告する。Task brief と対象ファイルの範囲を守り、仕様やロック済みインターフェースを独自に変更しない。

### `reviewer`

- 用途: 設計適合性、正しさ、セキュリティ、敵対的入力、境界条件、回帰、テスト不足のレビュー。
- モデル: 親エージェントから継承する。
- 推論強度: `high`。
- 権限プロファイル: `default_permissions = ":read-only"`。
- 根拠: Task brief、review package、検証報告、承認済み設計書、および親が明示したその他の参照資料。
- 制約: live overrideで書き込み権限が与えられていても、リポジトリ、設定、Git状態の変更を拒否する。
- 出力: Critical、Important、Minor の重要度、根拠となるファイルと行、再現条件、推奨修正。
- 一次レビューと二次検証には、コンテキストを共有しない別々の `reviewer` インスタンスを使用する。

## `AGENTS.md` の変更

既存の「サブエージェント運用」を置き換えず、次を明確化する。

- `explorer`、`fast-worker`、`implementer`、`reviewer` と `SubAgents.md` の役割対応。
- custom agent種別、モデル、推論強度、permissionを独立して判定し、`task_name`の一致をcustom agentの選択・読み込みの証拠にしないこと。
- custom agent種別を選択・確認できないsurfaceでは、汎用subagentへ同じ役割、対象範囲、編集可否を指示すること。
- custom agentの読み込みを確認できた場合はTOMLの明示値または意図的な親継承を各値の設定根拠とし、per-dispatch model overrideはモデルだけに適用すること。推論強度とpermissionは独立して確認し、確認できない実効値を推測しないこと。
- 並列化する対象は独立した読み取り作業であること。
- Implementer は唯一の書き込み担当であること。
- single-writerはCodexの役別上限やロックではなく親が維持する運用上のオーケストレーション不変条件であること。同じworktreeのCodex親プロセス／セッションを1つに限定し、並行する親は別worktreeを使うこと。親がdispatch前にworktreeの排他性、active Implementer、技術的read-onlyを確認できないactive読み取り役を確認し、該当agentの完了またはclose前にImplementerを起動しないこと。
- 親のlive runtime permission overrideがcustom agentの既定権限を上書きし得ること。読み取り専用役の実効permissionを選択・確認できないsurfaceでは編集禁止を指示上の制約として扱い、Implementerと直列化すること。同じsurface制約は信頼性判断に影響する場合だけ最終報告で一度記載すること。
- 読み取り専用役はlive overrideで書き込み可能になっていても、リポジトリの編集を拒否すること。
- Docker daemonのrw bind mountはread-only filesystemの技術的境界外であるため、fast-workerはhost worktreeへの作成・変更・削除を意図するDocker payloadだけを拒否し、親はclean baselineでDockerコマンドを開始して前後のstaged diff、unstaged diff、untracked一覧を比較すること。ignored pathは比較対象外とすること。
- Docker形式はNode/npmコマンドだけに適用し、Codex CLI、`rg`、Git等のホストコマンドは指定どおり実行すること。
- Verifier 役の定型検証結果と Reviewer の報告を親が確認してから採用すること。
- 一次レビューと、レビュー指摘を深掘りする二次検証は別々の Reviewer エージェントで行うこと。Docker コマンドを再実行する Verifier 役の検証とは別概念であることを明記する。
- モデルを指定できないことだけを理由に安全な読み取り作業を停止せず、利用できない能力だけを個別にfallbackすること。技術的read-onlyまたはcustom agent設定そのものが検証要件である場合は、対応surfaceへ移すか未実施とすること。

詳細手順は重複記載せず、`SubAgents.md` を参照する。

## エラーとフォールバック

- `gpt-5.6-terra` が利用できないと確認された場合、暗黙の代替モデルを推測しない。per-dispatch model overrideを利用できる場合は利用可能なモデルを明示し、利用できない場合は実効モデル不明として扱う。
- `[features].multi_agent` を明示的に有効化する。サブエージェントを生成できない場合は、実効設定と利用中のCodexバージョンを確認する。
- custom agent種別を選択・確認できない場合、汎用subagentへ同じ役割、対象範囲、編集可否を指示する。`task_name`の一致をcustom agent読み込みの証拠にしない。
- model override、推論強度、custom agent種別、live runtime permissionのうち、利用できない能力だけを個別にfallbackする。指定できない項目があることだけを理由に、安全な読み取り作業を停止しない。
- 技術的read-onlyまたはcustom agentの実効設定そのものが検証要件である場合、対応surfaceの新しいCodexプロセスで確認するまで完全検証済みとしない。
- Docker daemonのrw bind mountに対してread-only filesystemは書き込み防止を保証しない。fast-workerによる意図的な書込みpayloadの拒否と、親によるclean baselineおよび前後のstaged diff、unstaged diff、untracked一覧の比較は運用上の緩和策であり、技術的な強制境界ではない。ignored pathは比較対象外であり、この残余制約を完全に防止済みとは報告しない。
- サブエージェントの結果が不完全、矛盾、または根拠不足の場合、親が再調査するか別エージェントで検証する。
- Reviewer または Verifier に Critical／Important の指摘がある場合、次の Task へ進まず、同じ Implementer 役で修正して再検証する。

## 検証

この変更は Codex の指示・設定だけを変更し、アプリケーションの実行コード、DB、UIには影響しない。次を独立して確認する。

1. 本実装前の最小検証として、既存の `default_permissions` に `sandbox_mode` を重ねた場合の実機挙動を確認する。Codex 0.144.5 の `--strict-config` はこの併用を構文エラーにせず旧式設定を優先したため、厳格読込だけを安全性の根拠にしない。
2. `.codex/config.toml` の既存 `default_permissions = ":workspace"` を維持し、リポジトリ設定と全カスタムエージェント定義に `sandbox_mode` および `[sandbox_workspace_write]` が存在しないことを確認する。
3. `codex --strict-config doctor --summary` で `Configuration` の `config` が `loaded` であることを確認する。これはbase configの読込証拠であり、各custom agentの読込やspawn後の実効権限の証拠とは扱わない。設定以外のDoctorエラーはこの変更の失敗条件にしない。
4. custom agent種別とlive runtime permissionを選択・確認できる新しいCodexプロセスで、検証開始時の希望する通常permissionを記録してからread-onlyを選択し、実効状態を確認する。確認後にだけ `explorer`、`reviewer`、`fast-worker` をspawnし、各custom agentのload、固有の役割指示、リポジトリ書き込み拒否を観測する。非対応surfaceではこのruntime matrixを代替実行せず、汎用subagent fallbackと実効値を適用済みと報告しないことだけを確認する。fast-workerにはrepositoryを書き込むDocker payloadの実行を依頼し、コマンド実行前に拒否することを確認する。read-onlyでDocker書き込みが防止されることの証拠とは扱わず、既知のsentinel実機証拠を再現する場合は承認されたdisposable worktreeだけを使用してcleanupする。
5. 親はDocker検証をclean baselineでのみ開始する。実行前にstaged diff、unstaged diff、untracked一覧をそれぞれ保存してから、`fast-worker` に、リポジトリルートをcwdとして正確なコマンド `docker compose run --rm --no-deps app node -p 'JSON.stringify({execPath:process.execPath,cwd:process.cwd(),version:process.version})'` を実行させる。実行後に同じ3種類を再取得し、前後差分がないことを必須とする。untracked一覧はignored pathを除外する。続いてhost-nativeの `git rev-parse --show-toplevel` を独立して実行させる。両方の終了コード0を必須とし、正確なコマンド、Docker経由／host-nativeの実行経路、呼出しcwd、標準出力の要約を記録する。追跡対象ファイルの差分や意図しないuntracked fileを残さない。
6. 対応surfaceで読み取り専用3役が完了した後、親のlive runtime permissionをworkspace-capable modeへ明示的に切り替え、実効状態を確認する。続いて、同じworktreeを操作するCodex親プロセス／セッションが1つだけであること、active Implementerがいないこと、技術的read-onlyを確認できない読み取り役がactiveでないことを確認する。いずれかを確認できなければImplementerをspawnしない。確認できた場合だけ `implementer` を1体spawnし、親modelとreasoningの継承を個別に確認し、`:workspace`の実効値を承認されたdisposable worktree上のsentinel書き込みなど安全な方法で観測する。
7. workspace-capable permissionへの切替を試みた後は、Implementer検証の成功・失敗・skipを問わず、すべての終了経路でcleanupとして検証開始時に記録した希望する通常permissionへ明示的に戻し、実効状態を確認する。開始時、read-only選択、workspace-capable選択、通常permission復元の各遷移と確認結果を記録する。復元または確認に失敗した場合は新しい作業を開始しない。対応surfaceで4種類のうち1種類でも未観測、いずれかの実効値を選択・確認できない、worktreeの排他性を確認できない、または通常permissionの復元を確認できない場合は完全検証済みとせず、未解決制約として記録する。非対応surfaceの `task_name` や役割プロンプトはcustom agent loadの証拠にしない。
8. 追加した TOML を構文解析できること。
9. `[features].multi_agent = true` が実効設定で有効であることを確認する。
10. `agents.max_threads` が親を数えるかは文書化済み仕様または実機で確認できた場合だけ断定し、確認できない場合は未確定事項として維持する。
11. `AGENTS.md`、`SubAgents.md`、各 TOML の役割と権限が矛盾しないこと。特に4制約の独立判定、汎用subagent fallback、`task_name`の非証拠性、model/reasoningの個別確認、read-only未確認役とImplementerの直列化、Docker daemon／rw bind mount境界、前後status確認をfocused `rg` で確認する。
12. `rg -n '^(sandbox_mode|\[sandbox_workspace_write\])' .codex` が一致なしであること。
13. `git diff --check` が成功すること。
14. 検証用sentinelをcleanupした後、実装worktreeはclean、disposable runtime worktreeはcleanであることをそれぞれ確認する。元checkoutでは、検証開始時にユーザー所有の未コミットPlanが存在する場合に限り、その差分を変更せず残し、検証による新しい差分を残さない。

アプリケーションコードを変更しないため、Vitest、DB リセット、pgTAP、E2E、ビルドはこの設定変更の検証対象外とする。

## 変更対象

### 当初の実装対象

- `AGENTS.md`
- `.codex/config.toml`
- `.codex/agents/explorer.toml`
- `.codex/agents/fast-worker.toml`
- `.codex/agents/implementer.toml`
- `.codex/agents/reviewer.toml`

当初の実装では、既存のグローバル Codex 設定、`SubAgents.md`、アプリケーションコード、設計済みのMVP仕様、無関係なユーザー所有Plan差分を変更対象外とした。

`.codex/config.toml` の既存 `default_permissions = ":workspace"` は維持する。同ファイルには `[features].multi_agent = true` と `[agents]` の上限設定だけを追記し、旧式のサンドボックス設定へ移行しない。

### 2026-07-18 責任分離の同期対象

- `AGENTS.md`
- `SubAgents.md`
- `docs/superpowers/specs/2026-07-17-codex-subagent-configuration-design.md`
- `docs/superpowers/plans/2026-07-17-codex-subagent-configuration.md`
- `docs/superpowers/plans/2026-07-17-codex-subagent-handoff.md`

この同期では `.codex/config.toml` と `.codex/agents/*.toml` を変更しない。責任分離の正本は `docs/superpowers/specs/2026-07-18-codex-subagent-responsibility-separation-design.md` とする。
