# Codex デフォルト権限設定 設計

## 目的

このリポジトリを信頼済みプロジェクトとして Codex で開いたとき、通常の作業はワークスペース権限で実行し、`git push` だけは実行前に毎回ユーザーへ承認を求める。

## 設定構成

- `.codex/config.toml` に `default_permissions = ":workspace"` を設定する。
- `.codex/rules/default.rules` に `git push` を `prompt` 判定する `prefix_rule` を定義する。
- ルールの意図と制約は、日本語のコメントおよび `justification` で記録する。

プロジェクトローカルの `.codex/` 設定は、プロジェクトが信頼済みの場合にだけ読み込まれる。設定変更は Codex の再起動または新しいセッションから反映される。

## 権限と安全性

`:workspace` は、リポジトリ内の通常の読み書きとローカルコマンドを許可する。ワークスペース外への書き込みや、サンドボックスで許可されていないネットワークアクセスなどでは、`git push` 以外でも承認が発生する可能性がある。

`git push` のルールは、引数列が `git`, `push` で始まる通常の呼び出しを対象とする。`git -C <path> push` や `git --git-dir=<path> push` のように、`push` より前に Git のグローバルオプションを置く形式は対象外とする。今回の要件では標準的な `git push` 呼び出しだけを対象とし、フックによる追加のコマンド解析は導入しない。

## 検証

`codex execpolicy check` を使い、次を確認する。

- `git push` が `prompt` と判定される。
- `git push origin main` が `prompt` と判定される。
- `git pull` がこのルールに一致しない。
- `git status` がこのルールに一致しない。

あわせて、`.codex/config.toml` が有効な TOML として Codex に読み込まれることを確認する。

## 変更範囲

追加するのは `.codex/config.toml` と `.codex/rules/default.rules` のみとする。アプリケーション、テスト、データベース、デプロイ設定には変更を加えない。
