# Codex デフォルト権限設定 設計

## 目的

このリポジトリを信頼済みプロジェクトとして Codex で開いたとき、通常の作業はワークスペース権限で実行する。`git push` は実行前に毎回ユーザーへ承認を求める一方、`git worktree` の全サブコマンドと `docker compose run` は承認なしで実行できるようにする。

## 設定構成

- `.codex/config.toml` に `default_permissions = ":workspace"` を設定する。
- `.codex/rules/default.rules` に `git push` を `prompt` 判定する `prefix_rule` を定義する。
- `.codex/rules/default.rules` に `git worktree` を `allow` 判定する `prefix_rule` を定義する。
- `.codex/rules/default.rules` に `docker compose run` を `allow` 判定する `prefix_rule` を定義する。
- ルールの意図と制約は、日本語のコメントおよび `justification` で記録する。

プロジェクトローカルの `.codex/` 設定は、プロジェクトが信頼済みの場合にだけ読み込まれる。設定変更は Codex の再起動または新しいセッションから反映される。

## 権限と安全性

`:workspace` は、リポジトリ内の通常の読み書きとローカルコマンドを許可する。ワークスペース外への書き込みや、サンドボックスで許可されていないネットワークアクセスなどでは、`git push` 以外でも承認が発生する可能性がある。

`git push` のルールは、引数列が `git`, `push` で始まる通常の呼び出しを対象とする。`git -C <path> push` や `git --git-dir=<path> push` のように、`push` より前に Git のグローバルオプションを置く形式は対象外とする。今回の要件では標準的な `git push` 呼び出しだけを対象とし、フックによる追加のコマンド解析は導入しない。

`git worktree` のルールは、引数列が `git`, `worktree` で始まるすべての呼び出しを対象とする。これにより、`add -b` によるworktreeと専用ブランチの作成だけでなく、`remove`、`move`、`prune`、`repair`、`lock`、`unlock` も承認なしで実行できる。`git branch` や `git switch -c` による独立したブランチ作成は対象外とする。

`docker compose run` のルールは、引数列が `docker`, `compose`, `run` で始まるすべての呼び出しを対象とする。後続のオプション、サービス名、コンテナ内コマンドを含めて承認なしで実行できる。`docker compose up`、`down`、`exec` および従来形式の `docker-compose run` は対象外とする。Docker経由ではホスト側へ強い操作が可能なため、この例外は信頼済みのCompose構成を前提とする。

## 検証

`codex execpolicy check` を使い、次を確認する。

- `git push` が `prompt` と判定される。
- `git push origin main` が `prompt` と判定される。
- `git pull` がこのルールに一致しない。
- `git status` がこのルールに一致しない。
- `git worktree add -b feature/example .worktrees/example` が `allow` と判定される。
- `git worktree remove .worktrees/example` が `allow` と判定される。
- `git branch feature/example` が `git worktree` のルールに一致しない。
- `docker compose run --rm app npm test` が `allow` と判定される。
- `docker compose up -d` が `docker compose run` のルールに一致しない。
- `docker-compose run --rm app npm test` が `docker compose run` のルールに一致しない。

あわせて、`.codex/config.toml` が有効な TOML として Codex に読み込まれることを確認する。

## 変更範囲

追加するのは `.codex/config.toml` と `.codex/rules/default.rules` のみとする。アプリケーション、テスト、データベース、デプロイ設定には変更を加えない。
