# Codex デフォルト権限設定 設計

## 目的

このリポジトリを信頼済みプロジェクトとして Codex で開いたとき、通常の作業はワークスペース権限で実行する。トップレベルから直接実行する `git push` は実行前に毎回ユーザーへ承認を求める一方、`git worktree` の全サブコマンド、`git add`、`git commit`、`docker compose run` は承認なしで実行できるようにする。

## 設定構成

- `.codex/config.toml` に `default_permissions = ":workspace"` を設定する。
- `.codex/rules/default.rules` に `git push` を `prompt` 判定する `prefix_rule` を定義する。
- `.codex/rules/default.rules` に `git worktree` を `allow` 判定する `prefix_rule` を定義する。
- `.codex/rules/default.rules` に `git add` と `git commit` を `allow` 判定する `prefix_rule` を定義する。
- `.codex/rules/default.rules` に `docker compose run` を `allow` 判定する `prefix_rule` を定義する。
- ルールの意図と制約は、日本語のコメントおよび `justification` で記録する。

プロジェクトローカルの `.codex/` 設定は、プロジェクトが信頼済みの場合にだけ読み込まれる。設定変更は Codex の再起動または新しいセッションから反映される。

## 権限と安全性

`:workspace` は、リポジトリ内の通常の読み書きとローカルコマンドを許可する。ワークスペース外への書き込みや、サンドボックスで許可されていないネットワークアクセスなどでは、`git push` 以外でも承認が発生する可能性がある。

`git push` のルールは、引数列が `git`, `push` で始まる通常の呼び出しを対象とする。`git -C <path> push` や `git --git-dir=<path> push` のように、`push` より前に Git のグローバルオプションを置く形式は対象外とする。今回の要件では標準的な `git push` 呼び出しだけを対象とし、フックによる追加のコマンド解析は導入しない。

この `prompt` 判定は、Codexがトップレベルから直接起動するコマンドに対する境界である。別途 `allow` したワークスペース内の変更可能なスクリプトは、その子プロセスが行う操作も含めて実行を許可する。子プロセスの `git push` はexecpolicyで再評価されないため、許可対象スクリプトへ `git push` を追加するとトップレベルの承認を迂回できる。

`./scripts/run-tooling-git.sh` は自動承認の対象から除外するが、この個別除外は、許可済みの変更可能な `./scripts/reset-local-db.sh` または `./scripts/run-e2e.sh` を経由する一般的な迂回可能性を解消しない。ユーザーは2026-07-16にこの残存リスクを明示的に受容し、2スクリプトの自動承認を維持する選択肢を選んだ。

`prefix_rule` はリテラルな引数列へ一致し、実行時のカレントディレクトリやリポジトリルートには結び付かない。このため、別のカレントディレクトリに同じ `./scripts/reset-local-db.sh` または `./scripts/run-e2e.sh` が存在すれば、その引数列も `allow` に一致する。また、許可済みのパス名にあるファイルをシンボリックリンクへ置き換えても引数列は変わらず、リンク先が実行される。ユーザーは2026-07-16にこの2つの残存リスクを明示的に受容し、相対パスのルールを維持する選択肢を選んだ。

`git worktree` のルールは、引数列が `git`, `worktree` で始まるすべての呼び出しを対象とする。これにより、`add -b` によるworktreeと専用ブランチの作成だけでなく、`remove`、`move`、`prune`、`repair`、`lock`、`unlock` も承認なしで実行できる。`git branch` や `git switch -c` による独立したブランチ作成は対象外とする。

`:workspace` では、リンクworktreeの `.git` ポインタが参照する共通Git管理領域もread-onlyとして保護される。サブエージェントがworktree内で変更をステージし、ローカルコミットを作成できるように、`git add` と `git commit` を承認なしで実行できる対象に加える。このルールはサブエージェントやworktreeだけには限定できず、信頼済みのこのリポジトリを扱うすべてのCodexセッションへ適用される。sandbox外でGit hooksやclean filterも実行され得るため、リポジトリとGit設定が信頼済みであることを前提とする。`git reset`、`git rebase` など、その他のGitサブコマンドは対象外とする。

`docker compose run` のルールは、引数列が `docker`, `compose`, `run` で始まるすべての呼び出しを対象とする。後続のオプション、サービス名、コンテナ内コマンドを含めて承認なしで実行できる。`docker compose up`、`down`、`exec` および従来形式の `docker-compose run` は対象外とする。Docker経由ではホスト側へ強い操作が可能なため、この例外は信頼済みのCompose構成を前提とする。

`docker compose run ... && git diff --check` のような複合コマンドは、シェルラッパー全体が保守的に権限判定され、許可済みのDockerコマンドでも承認を求められる場合がある。Dockerコマンドとホスト側コマンドは `&&` などで結合せず、それぞれ独立したツール呼び出しとして実行する。`git diff` や `bash -lc` の包括的な許可ルールは追加しない。

## 検証

`codex execpolicy check` を使い、次を確認する。

- トップレベルから直接実行する `git push` が `prompt` と判定される。
- トップレベルから直接実行する `git push origin main` が `prompt` と判定される。
- `git pull` がこのルールに一致しない。
- `git status` がこのルールに一致しない。
- `git worktree add -b feature/example .worktrees/example` が `allow` と判定される。
- `git worktree remove .worktrees/example` が `allow` と判定される。
- `git branch feature/example` が `git worktree` のルールに一致しない。
- `git add src/example.ts` が `allow` と判定される。
- `git commit -m test` が `allow` と判定される。
- `git reset --hard` が追加するルールに一致しない。
- `docker compose run --rm app npm test` が `allow` と判定される。
- `docker compose up -d` が `docker compose run` のルールに一致しない。
- `docker-compose run --rm app npm test` が `docker compose run` のルールに一致しない。
- Dockerコマンドと `git diff --check` が、結合されず独立したツール呼び出しとして記載されている。

あわせて、`.codex/config.toml` が有効な TOML として Codex に読み込まれることを確認する。

## 変更範囲

権限設定は `.codex/config.toml` と `.codex/rules/default.rules` に置き、複合コマンドを避ける運用規約は `AGENTS.md` に記載する。アプリケーション、テスト、データベース、デプロイ設定には変更を加えない。
