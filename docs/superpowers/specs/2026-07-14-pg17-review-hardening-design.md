# PG17レビュー指摘統合修正 設計書

## 目的

PG17・Supabase公式Docker構成更新に対する複数の敵対的レビュー結果を再検証し、成立したローカル開発・vendor更新・E2E実行上の不具合を修正する。誤検知または既存の明示要件と衝突する指摘は変更へ含めない。

## 修正対象

次の問題を修正する。

1. `docs/local-development.md` の `.env` 検証が`;`連結の最後の終了statusしか返さない。
2. vendor更新のstaging directoryと排他lockがGitおよびDocker build contextから除外されていない。
3. 非root vendor更新で旧treeのcleanupに失敗しても成功終了する。
4. `scripts/generate-local-secrets.sh` が呼び出し元のcurrent working directoryに依存する。
5. E2E実行後にAuthのテスト用rate limitとappのE2E commandが通常stackへ残留する。
6. 稼働中のPostgresを停止せずvendor更新すると、bind mountされたPGDATAを削除し得る。
7. vendor更新を並行実行すると、vendor treeとversion fileの対応が壊れ得る。

次の指摘は修正しない。

- 型生成tempファイルのCtrl-C残留: Bashの`EXIT` trapはSIGINTで実行され、再現fixtureでもtempファイルは残らなかった。SIGKILLはtrapで処理できない。
- 過去のMVP Plan 1に残るPG15と`LOCAL_DB_URL`: 現在のPG17更新計画と設計が、過去のplans/specsを履歴として変更しないよう明示している。

## 採用アーキテクチャ

### 安全なvendor更新入口

既存の命名規則に合わせて`scripts/refresh-supabase.sh`を追加する。このwrapperはスクリプト位置からリポジトリルートを解決し、次の順序で処理する。

1. base Compose stackを`down --remove-orphans`で停止する。vendor更新失敗時に既存PGDATAを復旧可能にするため、この時点ではvolumeとbind-mounted PGDATAを削除しない。
2. tooling Composeの`vendor-supabase`をrootで実行する。既存treeのPGDATAは停止済みのため、安全に旧treeとともに削除できる。
3. vendor更新成功後に`scripts/reset-local-db.sh`を実行し、named volumeとbind-mounted PGDATAをクリーンなPG17環境として再作成する。

vendor更新が失敗した場合はstackを停止状態のまま残し、既存vendor treeとPGDATAはトランザクションrollbackで保持する。自動再起動は行わず、失敗原因を修正して明示的に再実行できるようにする。

### vendor内部ガード

`scripts/vendor-supabase.sh`はwrapperを迂回した実行にも次の防御を持つ。

- `infra/.supabase-refresh.lock`を原子的な`mkdir`で獲得し、既存lockがあれば更新を開始せず失敗する。
- lockは通常終了と処理済みsignalで削除する。SIGKILL後のstale lockは安全側に失敗し、利用者が状態を確認して手動削除する。
- 既存PGDATAに`postmaster.pid`があれば、稼働中Postgresの可能性があるため更新を拒否し、`scripts/refresh-supabase.sh`の利用を案内する。
- install直前にtargetとversionの状態が当該プロセスの想定どおりか確認する。排他lockに加え、想定外の外部変更を検出したらrollbackする。
- swapのcommit後にstaging cleanupが失敗した場合、成果物はrollbackせず、保存先を表示して非0で終了する。tree更新自体は完了していても、旧treeが残った状態を成功とは扱わない。

lockとstagingは`.gitignore`と`.dockerignore`の両方へ追加し、失敗時に意図的に保存されたbackupやstale lockがコミット・build contextへ混入しないようにする。

### E2E終了後の復元

`scripts/run-e2e.sh`は`exec`を使わず、E2Eの終了statusを保存する。`EXIT`、`HUP`、`INT`、`TERM`で共通cleanupを実行し、base `compose.yaml`だけを使って`auth`と`app`を`--force-recreate --no-deps`で復元する。

cleanup後は元のE2E statusを返す。E2Eが成功しても復元に失敗した場合は非0にする。signal時はcleanup後に標準的な終了status（HUP 129、INT 130、TERM 143）を返す。KongとOAuth mockはE2E overrideで設定が変わらないため、再作成済みの状態をそのまま使用する。

別Compose projectによる完全分離は採用しない。公式vendor構成の固定`container_name`とプロジェクトの固定loopback portsが既存stackと衝突し、変更範囲が大きいためである。

### 小規模な堅牢化

- `.env`検証は`sh -eu -c`で実行し、途中の失敗を即時に非0へする。
- `scripts/generate-local-secrets.sh`は`$0`からリポジトリルートを解決し、`--project-directory`と絶対Compose pathを指定する。
- 型生成tempのsignal処理と過去Plan 1は変更しない。

## テスト方針

既存のNodeおよびshell fixtureテストへ、各不具合を再現する失敗テストを先に追加する。

- 不正なpermissionまたは`COMPOSE_FILE`を持つ`.env`に対し、文書化された検証が失敗する。
- `.supabase-refresh.*`と`.supabase-refresh.lock`がGitおよびDocker contextから除外される。
- 2つのvendor更新を並行開始すると片方だけがlockを獲得する。
- committed swap後のcleanup失敗は非0になり、更新済みtreeと保存stagingを確認できる。
- `postmaster.pid`がある直接refreshはswap前に拒否される。
- 任意のcurrent working directoryからシークレットwrapperを実行しても、正しいproject directoryとCompose pathがDockerへ渡る。
- E2E成功、通常失敗、INT、TERMの各経路でbase `auth`と`app`の復元commandが実行され、期待するstatusが返る。

focusedテストが通った後、toolingテスト全体、vendor shellテスト、Compose config、Vitest、build、lint、typecheck、format checkをDocker内で実行する。実DBとE2E全体はstackを再作成するため、実行前に現在の共有stack状態を確認する。

## 完了条件

- 文書化されたSupabase更新経路が稼働中PGDATAを削除しない。
- 直接または並行vendor更新が危険なswapを開始しない。
- cleanup不全が成功として報告されない。
- E2E後の通常stackがbase Auth/app設定へ戻る。
- ローカルwrapperが呼び出し元directoryに依存しない。
- 一時・復旧用vendor資産がGitとDocker contextへ混入しない。
- 再現テストと既存検証が成功し、worktreeに意図しない生成物が残らない。
