# PG17レビュー指摘統合修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 敵対的レビューで確認したvendor更新、ローカル検証、wrapper、E2E復元の不具合を、再現テスト付きで修正する。

**Architecture:** vendor更新は停止・更新・クリーン再起動を行う専用wrapperへ集約し、vendor本体にも排他lock、稼働中PGDATA拒否、swap状態検証、cleanup失敗伝播を持たせる。E2Eは終了trapでbase Auth/app構成へ復元し、小規模な文書・ignore・cwd依存修正は既存toolingテストで固定する。

**Tech Stack:** POSIX shell、Docker Compose、Node.js 24 `node:test`、Git fixture

## Global Constraints

- 対象worktreeは`/home/dev/projects/kondate/.worktrees/pg17-supabase-refresh`とする。
- コードコメントとコミットメッセージは日本語にする。上流vendorファイルは変更しない。
- ホストにNode、Git、Supabase CLI、Postgres clientを要求せず、検証はDocker経由で行う。
- PG15データ移行、PG15互換override、実行環境rollbackは追加しない。
- 過去のMVP plans/specsにあるPG15と`LOCAL_DB_URL`は履歴として変更しない。
- 型生成tempのSIGINT処理は既存`EXIT` trapで成立しているため変更しない。

---

### Task 1: ローカル検証・ignore・シークレットwrapperの堅牢化

**Files:**
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `docs/local-development.md`
- Modify: `scripts/generate-local-secrets.sh`
- Modify: `tests/tooling/project-config.test.mjs`
- Modify: `tests/tooling/compose.test.mjs`

**Interfaces:**
- Consumes: `compose.tooling.yaml`の`local-secrets`サービス。
- Produces: 任意cwdから動く`scripts/generate-local-secrets.sh`、禁止キーを確実に拒否する文書化済み`.env`検証、Git/Dockerから除外されたvendor一時資産。

- [ ] **Step 1: ignoreとwrapperの失敗テストを書く**

`tests/tooling/project-config.test.mjs`のignoreテストを、`.env.tmp-*`に加えて次の両行を要求するよう拡張する。

```js
for (const pattern of [
  ".env.tmp-*",
  "infra/.supabase-refresh.*",
  "infra/.supabase-refresh.lock",
]) {
  assert.ok(ignore.split(/\r?\n/u).includes(pattern));
}
```

同ファイルへ、fake `docker`で任意cwdからwrapperを起動し、次の引数を確認するテストを追加する。

```js
assert.deepEqual(args, [
  "compose",
  "--project-directory",
  root,
  "-f",
  join(root, "compose.tooling.yaml"),
  "run",
  "--rm",
  "local-secrets",
  "--force",
]);
```

- [ ] **Step 2: 文書検証の失敗テストを書く**

`tests/tooling/compose.test.mjs`の開発文書テストへ次を追加する。

```js
assert.match(guide, /sh -eu -c/u);
assert.match(guide, /if grep -q ['"]?\^COMPOSE_FILE=/u);
assert.doesNotMatch(guide, /! grep -q ['"]?\^COMPOSE_FILE=/u);
```

さらにfixtureの`.env`をmode `0644`かつ`COMPOSE_FILE=docker-compose.yml`で作り、文書と同じ検証bodyを`sh -eu -c`で実行して非0になることを確認する。禁止キー検査は必ず次の正の条件分岐を使用する。

```sh
if grep -q '^COMPOSE_FILE=' .env; then exit 1; fi
```

- [ ] **Step 3: REDを確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
```

Expected: ignore patterns、絶対Compose path、`sh -eu -c`、正の`COMPOSE_FILE`拒否が未実装のためFAIL。

- [ ] **Step 4: 最小実装を行う**

`.gitignore`と`.dockerignore`へ次を追加する。

```text
infra/.supabase-refresh.*
infra/.supabase-refresh.lock
```

`scripts/generate-local-secrets.sh`を次の構造にする。

```sh
#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

exec docker compose --project-directory "$repo_root" \
  -f "$repo_root/compose.tooling.yaml" run --rm local-secrets "$@"
```

`docs/local-development.md`の`.env`検証を`sh -eu -c`へ変更し、禁止キーを次の形で拒否する。

```sh
if grep -q '^COMPOSE_FILE=' .env; then exit 1; fi
```

- [ ] **Step 5: GREENと静的検証を確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
docker compose -f compose.yaml run --rm --no-deps app npm run format:check
git diff --check
```

Expected: 全command PASS。

- [ ] **Step 6: コミットする**

```bash
git add .gitignore .dockerignore docs/local-development.md scripts/generate-local-secrets.sh tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
git commit -m "fix: ローカル検証とツール起動を堅牢化"
```

---

### Task 2: vendor更新の排他・稼働ガード・cleanup失敗伝播

**Files:**
- Modify: `scripts/vendor-supabase.sh`
- Modify: `tests/tooling/vendor-supabase.test.sh`

**Interfaces:**
- Consumes: `SUPABASE_REPOSITORY`、`SUPABASE_REF`、`LOCAL_UID`、`LOCAL_GID`、`--refresh`。
- Produces: 単一更新だけを許す`infra/.supabase-refresh.lock`、稼働中PGDATA拒否、commit後cleanup失敗の非0終了。

- [ ] **Step 1: lockと稼働中PGDATAの失敗テストを書く**

vendor fixtureへ次を追加する。

```sh
mkdir infra/.supabase-refresh.lock
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "existing refresh lock was accepted" >&2
  exit 1
fi
rmdir infra/.supabase-refresh.lock

mkdir -p infra/supabase/volumes/db/data
: > infra/supabase/volumes/db/data/postmaster.pid
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "running database marker was accepted" >&2
  exit 1
fi
rm -f infra/supabase/volumes/db/data/postmaster.pid
```

実際の並行経路はfake `git fetch`で最初の更新を待機させ、lock作成をpollしてから2つ目を起動する。2つ目が非0で終了し、最初の更新完了後にlockが消えることを確認する。

- [ ] **Step 2: cleanup失敗の失敗テストを書く**

fake `rm`へ`FAIL_CLEANUP=1`時に`.supabase-refresh.*`の削除だけを失敗させる分岐を追加する。swap後に次を確認する。

```sh
status=0
PATH="$fixture/bin:$PATH" FAIL_CLEANUP=1 SUPABASE_REPOSITORY="$source_repo" \
  sh scripts/vendor-supabase.sh --refresh 2> "$fixture/cleanup.log" || status=$?
test "$status" -ne 0
grep -q '^vendor cleanup incomplete; preserved staging at ' "$fixture/cleanup.log"
test "$(cat infra/supabase.version)" = "$expected_sha"
```

- [ ] **Step 3: REDを確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase tests/tooling/vendor-supabase.test.sh
```

Expected: lock、`postmaster.pid`、cleanup statusのいずれかが未実装のためFAIL。

- [ ] **Step 4: vendor内部ガードを実装する**

`scripts/vendor-supabase.sh`でargument検証後、staging作成前に次を行う。

```sh
lock_dir=infra/.supabase-refresh.lock
data_dir=$target/volumes/db/data

if [ -e "$data_dir/postmaster.pid" ]; then
  echo "database appears to be running; use scripts/refresh-supabase.sh" >&2
  exit 1
fi
if [ -d "$data_dir" ] && [ ! -r "$data_dir" ]; then
  echo "cannot verify database state; run vendor refresh as root" >&2
  exit 1
fi
if ! mkdir "$lock_dir"; then
  echo "another Supabase vendor refresh is active: $lock_dir" >&2
  exit 1
fi
lock_acquired=true
```

`finish()`はrollback後にstagingを削除し、削除失敗時は保存先を表示して、元statusが0なら1へ変更する。最後に`rmdir "$lock_dir"`を行い、lock削除失敗も非0にする。signal trapは既存の129/130/143を維持する。

backup直前に初期のtarget/version存在状態を再確認し、各install直前にはdestination不存在を確認する。想定外状態では`exit 1`して既存rollbackへ入る。

- [ ] **Step 5: GREENを確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase tests/tooling/vendor-supabase.test.sh
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -n scripts/vendor-supabase.sh
git diff --check
```

Expected: トランザクション、signal、lock、PGDATA、cleanup testが全件PASS。

- [ ] **Step 6: コミットする**

```bash
git add scripts/vendor-supabase.sh tests/tooling/vendor-supabase.test.sh
git commit -m "fix: Supabase vendor更新を排他制御"
```

---

### Task 3: 安全なvendor refresh wrapper

**Files:**
- Create: `scripts/refresh-supabase.sh`
- Modify: `tests/tooling/local-development-scripts.test.mjs`
- Modify: `tests/tooling/compose.test.mjs`
- Modify: `docs/local-development.md`

**Interfaces:**
- Consumes: `compose.yaml`、`compose.tooling.yaml`、`scripts/reset-local-db.sh`、Task 2のvendorガード。
- Produces: 停止→root vendor更新→クリーン再起動を行う`./scripts/refresh-supabase.sh`。

- [ ] **Step 1: wrapperの失敗テストを書く**

`tests/tooling/local-development-scripts.test.mjs`で`refresh-supabase.sh`と`reset-local-db.sh`をfixtureへコピーし、任意cwdからfake `docker`で実行する。次の順序を要求する。

```text
compose --project-directory <root> -f <root>/compose.yaml down --remove-orphans
compose --project-directory <root> -f <root>/compose.tooling.yaml run --rm --user 0:0 vendor-supabase --refresh
compose --project-directory <root> -f <root>/compose.yaml down --volumes --remove-orphans
compose --project-directory <root> -f <root>/compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase -c rm -rf /workspace/infra/supabase/volumes/db/data
compose --project-directory <root> -f <root>/compose.yaml up -d --wait
```

vendor commandをfake Dockerで失敗させた場合は、resetの3 commandが実行されず、vendor statusがそのまま返ることも検証する。

`tests/tooling/compose.test.mjs`の開発文書テストへ次を追加する。

```js
assert.match(guide, /\.\/scripts\/refresh-supabase\.sh/u);
```

- [ ] **Step 2: REDを確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs
```

Expected: `scripts/refresh-supabase.sh`が存在しないためFAIL。

- [ ] **Step 3: wrapperを実装する**

```sh
#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

docker compose --project-directory "$repo_root" -f "$repo_root/compose.yaml" \
  down --remove-orphans
docker compose --project-directory "$repo_root" -f "$repo_root/compose.tooling.yaml" \
  run --rm --user 0:0 vendor-supabase --refresh
exec "$script_dir/reset-local-db.sh"
```

`docs/local-development.md`のvendor更新はこのwrapperだけを案内し、中断時は同じwrapperの再実行で収束することを記載する。

- [ ] **Step 4: GREENを確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs
docker compose -f compose.yaml run --rm --no-deps app npx prettier --check scripts/refresh-supabase.sh docs/local-development.md tests/tooling/local-development-scripts.test.mjs
git diff --check
```

Expected: 全command PASS。

- [ ] **Step 5: コミットする**

```bash
git add scripts/refresh-supabase.sh tests/tooling/local-development-scripts.test.mjs tests/tooling/compose.test.mjs docs/local-development.md
git commit -m "fix: Supabase更新前にローカルDBを停止"
```

---

### Task 4: E2E後のbase stack復元

**Files:**
- Modify: `scripts/run-e2e.sh`
- Modify: `tests/tooling/local-development-scripts.test.mjs`
- Modify: `tests/tooling/compose.test.mjs`
- Modify: `docs/local-development.md`

**Interfaces:**
- Consumes: `compose.yaml`、`compose.e2e.yaml`、E2E引数`"$@"`。
- Produces: 同じcheckoutの並行実行を拒否し、成功・失敗・HUP・INT・TERM後にE2E one-offを即時停止・削除してbase `auth app`を復元し、元statusを保持するE2E wrapper。

- [ ] **Step 1: cleanupの失敗テストを書く**

既存fake Docker fixtureを、E2E runの終了statusまたはsignalを注入できるように拡張する。成功、status 23、HUP、INT、TERMの全caseで最後に次が1回だけ記録されることを要求する。

```text
compose -f compose.yaml up -d --wait --force-recreate --no-deps auth app
```

期待statusは順に0、23、129、130、143とする。復元commandだけが失敗するcaseでは、E2E成功時に復元statusを返すことも確認する。

- [ ] **Step 2: REDを確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs
```

Expected: 現在の`exec`実装に復元commandがないためFAIL。

- [ ] **Step 3: signal-safe cleanupを実装する**

`scripts/run-e2e.sh`へ次の構造を追加する。

```sh
cleanup() {
  status=$?
  trap - EXIT
  trap '' HUP INT TERM
  cleanup_status=0
  docker compose -f compose.yaml \
    up -d --wait --force-recreate --no-deps auth app || cleanup_status=$?
  if [ "$status" -eq 0 ] && [ "$cleanup_status" -ne 0 ]; then
    status=$cleanup_status
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
```

最後のE2E runは`exec`せず、通常commandとして実行する。既存の引数境界`"$@"`は維持する。

- [ ] **Step 4: GREENと文書契約を確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs tests/tooling/compose.test.mjs
docker compose -f compose.yaml run --rm --no-deps app npm run format:check
git diff --check
```

Expected: 全status、signal、cleanup、既存引数転送testがPASS。

- [ ] **Step 5: コミットする**

```bash
git add scripts/run-e2e.sh tests/tooling/local-development-scripts.test.mjs tests/tooling/compose.test.mjs docs/local-development.md
git commit -m "fix: E2E後に通常構成を復元"
```

- [ ] **Step 6: 即時cleanupと排他lockの失敗テストを書く**

`tests/tooling/local-development-scripts.test.mjs`の期待commandを、base + E2E files、project identity、`e2e` profileを共通にした次の3 phaseへ更新する。

```text
docker compose --project-directory "$repo_root" --project-name "$project_name" -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e kill e2e
docker compose --project-directory "$repo_root" --project-name "$project_name" -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e rm --force e2e
docker compose --project-directory "$repo_root" --project-name "$project_name" -f "$repo_root/compose.yaml" up -d --wait --force-recreate --no-deps auth app
```

fake daemon childはTERMを無視させ、`kill e2e`でSIGKILLされ、続く`rm --force e2e`がremoved markerを作ることを要求する。kill、rm、restoreの各失敗でも後続phaseをすべて記録し、statusがsignal、元E2E、kill、rm、restoreの順になることを確認する。

同じcheckoutで異なる`TMPDIR`を使い、1本目をE2E中に待機させ、2本目がDocker invocationを追加せず失敗するfixtureを追加する。1本目をTERMで完了させた後は3本目が成功すること、stale lockはDocker前に拒否されること、成功・通常失敗・signalでlockが消えることを確認する。lock directoryへファイルを置いて`rmdir`を失敗させ、元statusが0の場合は非0になることも確認する。

`.gitignore`と`.dockerignore`の両方で`.run-e2e.lock`を要求し、運用文書とstatic runner契約もrepository root固定pathを要求する。

- [ ] **Step 7: 追加REDを確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test --test-name-pattern "kills.*one-off|cleanup phase fails|serializes|stale lock|release failure" tests/tooling/local-development-scripts.test.mjs
```

Expected: `kill e2e`未実行、`rm --stop`使用、lock未実装のため各caseがFAIL。

- [ ] **Step 8: 即時3 phase cleanupとlock lifecycleを実装する**

最初のCompose操作前に次のlockを獲得し、lock未取得時はcleanupを実行しない。

```sh
lock_dir=$repo_root/.run-e2e.lock
lock_acquired=0
if mkdir "$lock_dir"; then
  lock_acquired=1
else
  echo "another E2E run is active: $lock_dir" >&2
  exit 1
fi
```

cleanupは個別statusを保持し、失敗後も3 phaseを順次実行する。

```sh
docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
  kill e2e
docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
  rm --force e2e
docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" \
  up -d --wait --force-recreate --no-deps auth app
```

`finish`でlockを`rmdir`し、元statusが0のときだけrelease failureを最終statusにする。SIGKILL後の既存lockは削除せず、次回起動を安全側に拒否する。

- [ ] **Step 9: 追加GREENと全回帰を確認する**

Run:

```bash
docker compose -f compose.yaml run --rm --no-deps app node --test tests/tooling/local-development-scripts.test.mjs tests/tooling/compose.test.mjs
docker compose -f compose.yaml run --rm --no-deps app npm run typecheck
docker compose -f compose.yaml run --rm --no-deps app npm run lint
docker compose -f compose.yaml run --rm --no-deps app npm run format:check
bash -n scripts/run-e2e.sh
git diff --check
```

Expected: tooling test全件PASS、lint error 0、その他commandもexit 0。

- [ ] **Step 10: 追加修正をコミットする**

```bash
git add .gitignore .dockerignore scripts/run-e2e.sh docs/local-development.md tests/tooling/local-development-scripts.test.mjs tests/tooling/compose.test.mjs tests/tooling/project-config.test.mjs
git commit -m "fix: E2E lockをcheckout内へ固定"
```

---

### Task 5: 統合検証と敵対的再レビュー

**Files:**
- Modify: `.superpowers/sdd/progress.md`（git-ignored）

**Interfaces:**
- Consumes: Tasks 1–4の全成果物。
- Produces: 検証結果、read-only敵対的レビュー、マージ可否判定。

- [ ] **Step 1: focused tooling検証を実行する**

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs tests/tooling/local-development-scripts.test.mjs
docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase tests/tooling/vendor-supabase.test.sh
docker compose -f compose.tooling.yaml config --quiet
docker compose -f compose.yaml config --quiet
```

- [ ] **Step 2: アプリ静的・単体検証を実行する**

```bash
docker compose -f compose.yaml run --rm --no-deps app npx vitest run
docker compose -f compose.yaml run --rm --no-deps app npm run build
docker compose -f compose.yaml run --rm --no-deps app npm run lint
docker compose -f compose.yaml run --rm --no-deps app npm run typecheck
docker compose -f compose.yaml run --rm --no-deps app npm run format:check
```

- [ ] **Step 3: Gitとshellを検証する**

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -n scripts/generate-local-secrets.sh scripts/vendor-supabase.sh scripts/refresh-supabase.sh scripts/reset-local-db.sh scripts/run-e2e.sh
git diff --check
git status --short
```

- [ ] **Step 4: 独立verifierと敵対的reviewerを実行する**

Tasks 1–4のbaseからHEADまでのreview packageを作り、SubAgents.mdの三役分離に従ってverifierとread-only reviewerをdispatchする。Critical/Importantがあれば同一fix担当へまとめ、検証とレビューを再実行する。

- [ ] **Step 5: progress ledgerを更新する**

`.superpowers/sdd/progress.md`へTasks 1–4のcommit、検証結果、レビュー結果を1行ずつ追記する。実DBまたはE2E全体を共有stack保護のため未実施にした場合は`implemented`として理由を記録する。
