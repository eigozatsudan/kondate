# scripts検証スクリプト自動承認 設計

## 目的

このリポジトリの最終検証で使用する `./scripts/reset-local-db.sh` と `./scripts/run-e2e.sh` を、Codexがユーザー承認を求めずに直接実行できるようにする。トップレベルから直接実行する `git push` の毎回承認と、その他のコマンドに対する現在の権限制御は維持する。

## 設定構成

`.codex/rules/default.rules` に、次の2つの実行ファイルを第一引数の選択肢として列挙する `allow` の `prefix_rule` を追加する。

- `./scripts/reset-local-db.sh`
- `./scripts/run-e2e.sh`

ルールは、リポジトリ直下から上記パスを直接実行する形式だけに一致させる。後続引数はexecpolicyのprefixルール仕様に従って許可する。

## 対象外

次の呼び出しは自動承認の対象にしない。

- `sh ./scripts/reset-local-db.sh` や `bash ./scripts/run-e2e.sh` のようなシェル経由の実行
- `scripts/run-e2e.sh` のように先頭の `./` を省略した実行
- 絶対パス、シンボリックリンク、別名を経由した実行
- `scripts/` にあるその他のシェルスクリプト
- 今後追加されるシェルスクリプト
- `scripts/generate-local-secrets.mjs` と `scripts/README.md`

新しいスクリプトを自動承認へ追加する場合は、そのスクリプトの動作と安全性を個別にレビューしたうえで、ルールの列挙と検証例を更新する。

## セキュリティ

許可対象のスクリプトはワークスペース内で変更可能であり、変更後も同じパスなら自動承認される。この設定は、リポジトリと対象スクリプトが信頼済みであることを前提とする。スクリプトの `allow` 判定は、そのスクリプトが起動する子プロセスの効果も許可する。

トップレベルから直接実行する `git push` は引き続き `prompt` と判定される。一方、許可済みスクリプトが子プロセスとして実行する `git push` はexecpolicyで再評価されず、対象スクリプトを書き換えることで承認を迂回できる。

`./scripts/run-tooling-git.sh` は許可対象に含めない。ただし、この個別除外は、変更可能な `./scripts/reset-local-db.sh` または `./scripts/run-e2e.sh` を経由する一般的な迂回可能性を解消しない。ユーザーは2026-07-16にこの残存リスクを明示的に受容し、2スクリプトの自動承認を維持する選択肢を選んだ。

`bash`、`sh`、`./scripts/` ディレクトリ全体を包括的に許可しない。任意のシェルコードや未レビューのスクリプトまで自動承認される範囲拡大を防ぐ。

対象の2スクリプトは、ローカルDBの再作成やDockerコンテナの起動・停止など、ローカル開発環境を変更する処理を含む。自動承認はこれらの処理を無害化するものではなく、承認待ちを省略するだけである。

## 検証

`codex execpolicy check` を使い、次を確認する。

- `./scripts/reset-local-db.sh` が `allow` と判定される。
- `./scripts/run-e2e.sh` が `allow` と判定される。
- 許可対象スクリプトに後続引数を付けても `allow` と判定される。
- `sh ./scripts/reset-local-db.sh` と `bash ./scripts/run-e2e.sh` が追加ルールに一致しない。
- `scripts/run-e2e.sh` と絶対パス形式が追加ルールに一致しない。
- `./scripts/run-tooling-git.sh push` と、その他の既存シェルスクリプトが追加ルールに一致しない。
- トップレベルから直接実行する既存の `git push` が引き続き `prompt` と判定される。
- 既存の `git worktree`、`git add`、`git commit`、`docker compose run` が引き続き `allow` と判定される。
- `.codex/rules/default.rules` と文書の差分が `git diff --check` を通過する。

実スクリプトはDBやDockerの状態を変更するため、execpolicyの判定検証では実行しない。実装後の通常利用時に、必要な最終テストとしてそれぞれ独立したツール呼び出しで実行する。

## 変更範囲

実装で変更するのは `.codex/rules/default.rules` と、既存のCodex権限設計・実装計画に必要な文書だけとする。アプリケーション、データベーススキーマ、デプロイ設定、対象スクリプト本体には変更を加えない。
