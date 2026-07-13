# PG17・Supabase公式Docker構成更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル開発環境を最新の公式Supabase Docker構成とPostgres 17へ一本化し、ホストへNode、npm、Git、Supabase CLI、psql、pgTAP、Playwrightを要求しない再現可能な開発・検証フローを構築する。

**Architecture:** 公式 `supabase/supabase` の `master` HEADを更新時に完全SHAへ解決し、独立したtooling用Composeサービスからトランザクション的に `infra/supabase/` へvendorする。公式DBイメージを基準に `migrate`、`db-test`、Supabase CLI設定をPG17へ揃え、Docker Compose内で静的検査、DBテスト、型生成、E2Eを実行する。

**Tech Stack:** Docker Compose、Node.js 24、POSIX shell、Git、Supabase self-hosted Docker、Postgres 17、pgTAP、Vitest、Playwright

## Global Constraints

- Postgresは `supabase/postgres:17.*` の公式完全タグへ統一する。設計時点の公式タグは `supabase/postgres:17.6.1.136`。
- 公式構成は実装時の `supabase/supabase` `master` HEADを40文字の完全SHAへ解決して固定する。設計時点のSHAは `b5ada9631df0a42cdb6e402eaf0ca18ff52aed80`。
- PG15データ、PG15互換override、PG15→17アップグレード、実行環境のロールバックはサポートしない。
- ホストで直接実行するのはDocker Engine、Docker Compose、POSIXシェルの操作だけとする。
- `.env` はコミットせず、Dockerコンテナ内の生成処理で作り直す。
- プロジェクトが新規作成・変更するコードコメントは日本語で書く。`infra/supabase/` の上流由来コメントは原文を保持する。
- コミットメッセージは日本語のConventional Commits形式にする。
- 過去の `docs/superpowers/plans/` と `docs/superpowers/specs/` にあるPG15表記は履歴として変更しない。

---

## File Structure

- Create: `compose.tooling.yaml` — `.env` とSupabase本体に依存しないシークレット生成・vendor取得サービス。
- Modify: `scripts/generate-local-secrets.sh` — ホストNodeではなくtooling用Composeを起動する入口。
- Modify: `scripts/generate-local-secrets.mjs` — 最新Supabase用シークレット、Auth URL、UID/GID、`COMPOSE_FILE` 除外を管理。
- Modify: `.env.example` — 最新Authの外部URL形式を示すプロジェクト向け見本。
- Modify: `tests/tooling/project-config.test.mjs` — tooling用Composeと生成済み環境変数の契約を検証。
- Modify: `scripts/vendor-supabase.sh` — Docker内で動くPOSIX shellのトランザクション型vendor更新処理。
- Create: `tests/tooling/vendor-supabase.test.sh` — ローカルGit fixtureで成功・除外・失敗時不変を検証。
- Replace: `infra/supabase/**` — 固定した最新公式 `docker/` スナップショット。ただしPG15移行専用4ファイルは除外。
- Modify: `infra/supabase.version` — vendor元の40文字SHA。
- Modify: `tests/tooling/compose.test.mjs` — Postgresタグ、PG17一本化、除外ファイル、Compose接続URLを検証。
- Modify: `compose.yaml` — `migrate` とDB型生成の内部接続をPG17構成へ合わせる。
- Modify: `Dockerfile.db-test` — pgTAPランナーのベースを公式PG17タグへ変更。
- Modify: `supabase/config.toml` — Supabase CLIのDB majorを17へ変更。
- Modify: `supabase/tests/database/001_extensions_and_schemas.test.sql` — 実DBがPG17であることをpgTAPで保証。
- Create: `docs/local-development.md` — Dockerだけを使う初期化・検証手順。

---

### Task 1: Docker toolingと最新ローカルシークレット生成

**Files:**
- Create: `compose.tooling.yaml`
- Create: `scripts/run-tooling-git.sh`
- Modify: `scripts/generate-local-secrets.sh`
- Modify: `scripts/generate-local-secrets.mjs`
- Modify: `.env.example`
- Modify: `tests/tooling/project-config.test.mjs`

**Interfaces:**
- Consumes: `infra/supabase/.env.example` の `KEY=value` 行、ホストから渡す `LOCAL_UID` と `LOCAL_GID`。
- Produces: `docker compose -f compose.tooling.yaml run --rm local-secrets --force`、PG17対応済み `.env`、後続Taskが使用する `vendor-supabase` サービス定義、通常checkoutとlinked worktreeに対応する `scripts/run-tooling-git.sh`。

- [ ] **Step 1: シークレット生成契約の失敗テストを書く**

`tests/tooling/project-config.test.mjs` の既存 `local secret generator emits...` テストを次の内容へ拡張する。既存の一時ディレクトリ作成とgenerator起動は残し、fixtureへ最新公式キーを追加し、子プロセスへUID/GIDを渡す。

```js
await writeFile(
  join(cwd, "infra/supabase/.env.example"),
  [
    "COMPOSE_FILE=docker-compose.yml",
    "REALTIME_DB_ENC_KEY=supabaserealtime",
    "PG_META_CRYPTO_KEY=replace-me",
    "LOGFLARE_PUBLIC_ACCESS_TOKEN=replace-me",
    "LOGFLARE_PRIVATE_ACCESS_TOKEN=replace-me",
    "S3_PROTOCOL_ACCESS_KEY_ID=replace-me",
    "S3_PROTOCOL_ACCESS_KEY_SECRET=replace-me",
    'MAILER_URLPATHS_CONFIRMATION="/quoted/confirmation"',
    'MAILER_URLPATHS_INVITE="/quoted/invite"',
    'MAILER_URLPATHS_RECOVERY="/quoted/recovery"',
    'MAILER_URLPATHS_EMAIL_CHANGE="/quoted/email-change"',
  ].join("\n"),
);

const script = resolve("scripts/generate-local-secrets.mjs");
await new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [script, "--force"], {
    cwd,
    env: { ...process.env, LOCAL_UID: "1234", LOCAL_GID: "5678" },
    stdio: "ignore",
  });
  child.once("error", rejectRun);
  child.once("exit", (code) =>
    code === 0 ? resolveRun() : rejectRun(new Error(`generator exited with ${String(code)}`)),
  );
});

const generated = await readFile(join(cwd, ".env"), "utf8");
assert.doesNotMatch(generated, /^COMPOSE_FILE=/mu);
assert.match(generated, /^LOCAL_UID=1234$/mu);
assert.match(generated, /^LOCAL_GID=5678$/mu);
assert.match(generated, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000\/auth\/v1$/mu);
assert.match(generated, /^REALTIME_DB_ENC_KEY=[a-f0-9]{16}$/mu);
assert.match(generated, /^PG_META_CRYPTO_KEY=[A-Za-z0-9_-]{32}$/mu);
assert.match(generated, /^LOGFLARE_PUBLIC_ACCESS_TOKEN=[A-Za-z0-9_-]{32}$/mu);
assert.match(generated, /^LOGFLARE_PRIVATE_ACCESS_TOKEN=[A-Za-z0-9_-]{32}$/mu);
assert.match(generated, /^S3_PROTOCOL_ACCESS_KEY_ID=[a-f0-9]{32}$/mu);
assert.match(generated, /^S3_PROTOCOL_ACCESS_KEY_SECRET=[a-f0-9]{64}$/mu);
```

同ファイルへtooling用Composeとshell入口の静的契約テストを追加する。

```js
test("runs local-only tooling inside pinned containers", async () => {
  const [compose, wrapper, gitWrapper] = await Promise.all([
    readFile("compose.tooling.yaml", "utf8"),
    readFile("scripts/generate-local-secrets.sh", "utf8"),
    readFile("scripts/run-tooling-git.sh", "utf8"),
  ]);
  assert.match(compose, /image: node:24-bookworm-slim/u);
  assert.match(compose, /image: alpine\/git:v2\.54\.0/u);
  assert.match(compose, /user: "\$\{LOCAL_UID:-1000\}:\$\{LOCAL_GID:-1000\}"/u);
  assert.match(compose, /entrypoint: \["node", "scripts\/generate-local-secrets\.mjs"\]/u);
  assert.match(compose, /entrypoint: \["\/workspace\/scripts\/vendor-supabase\.sh"\]/u);
  assert.equal(
    (compose.match(/LOCAL_UID: "\$\{LOCAL_UID:-1000\}"/gu) ?? []).length,
    2,
  );
  assert.equal(
    (compose.match(/LOCAL_GID: "\$\{LOCAL_GID:-1000\}"/gu) ?? []).length,
    2,
  );
  assert.match(wrapper, /docker compose -f compose\.tooling\.yaml run --rm local-secrets/u);
  assert.match(gitWrapper, /--entrypoint git/u);
  assert.match(gitWrapper, /vendor-supabase/u);
});
```

同ファイルのfixtureテストで、通常checkoutでは追加mountがなく、linked worktreeではgitfileと`commondir`から解決したGit common dirが同じ絶対パスへ`--volume`で追加されることを検証する。Dockerへ渡すGit引数の境界とDockerの終了statusも保持する。

`MAILER_URLPATHS_*` の引用符付きfixtureは新しい分岐を作るためではなく、公式 `.env.example` の引用符付き入力をプロジェクトが要求する引用符なしの正規形へ変換する既存回帰契約を維持するために残す。

- [ ] **Step 2: Docker内でテストを実行して失敗を確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/project-config.test.mjs
```

Expected: `compose.tooling.yaml` が存在せず、新しい環境変数契約も満たさないためFAIL。

- [ ] **Step 3: 独立したtooling用Composeを作る**

`compose.tooling.yaml` を作成する。

```yaml
services:
  local-secrets:
    image: node:24-bookworm-slim
    user: "${LOCAL_UID:-1000}:${LOCAL_GID:-1000}"
    working_dir: /workspace
    environment:
      LOCAL_UID: "${LOCAL_UID:-1000}"
      LOCAL_GID: "${LOCAL_GID:-1000}"
    volumes:
      - .:/workspace
    entrypoint: ["node", "scripts/generate-local-secrets.mjs"]

  vendor-supabase:
    image: alpine/git:v2.54.0
    user: "${LOCAL_UID:-1000}:${LOCAL_GID:-1000}"
    working_dir: /workspace
    environment:
      HOME: /tmp
      LOCAL_UID: "${LOCAL_UID:-1000}"
      LOCAL_GID: "${LOCAL_GID:-1000}"
    volumes:
      - .:/workspace
    entrypoint: ["/workspace/scripts/vendor-supabase.sh"]
```

- [ ] **Step 4: shell入口をDocker Composeラッパーへ変更する**

`scripts/generate-local-secrets.sh` を次の内容にする。

```bash
#!/bin/sh
set -eu

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

exec docker compose -f compose.tooling.yaml run --rm local-secrets "$@"
```

`scripts/run-tooling-git.sh` はスクリプト位置からリポジトリルートを決定し、通常checkoutではそのまま、linked worktreeでは `.git` gitfileと`commondir`からGit common dirを解決して同じ絶対パスへread-write追加mountする。最後に `vendor-supabase` のentrypointをGitへ切り替え、受け取った引数を `"$@"` でそのまま渡して`exec`する。

- [ ] **Step 5: generatorを最新Supabaseの環境変数へ対応させる**

`scripts/generate-local-secrets.mjs` で公式値を読み込んだ直後に、ルートComposeを壊すキーを削除する。

```js
values.delete("COMPOSE_FILE");
```

`--force` を初回セットアップでも使えるよう、既存 `.env` の読み込みはファイルが存在するときだけ行う。

```js
if (force) {
  let existing = "";
  try {
    existing = await readFile(output, "utf8");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  for (const line of existing.split(/\r?\n/u)) {
    if (line.startsWith("OAUTH_MOCK_USER_PASSWORD=")) {
      values.set("OAUTH_MOCK_USER_PASSWORD", line.slice("OAUTH_MOCK_USER_PASSWORD=".length));
    }
  }
}
```

既存の `if (force)` ブロックはこの内容で置き換える。

既存のランダム値設定へ次を追加・変更する。

```js
const localUid = process.env.LOCAL_UID ?? "1000";
const localGid = process.env.LOCAL_GID ?? "1000";
if (!/^\d+$/u.test(localUid) || !/^\d+$/u.test(localGid)) {
  throw new Error("LOCAL_UID and LOCAL_GID must be numeric");
}

values.set("LOCAL_UID", localUid);
values.set("LOCAL_GID", localGid);
values.set("REALTIME_DB_ENC_KEY", randomBytes(8).toString("hex"));
values.set("PG_META_CRYPTO_KEY", randomBytes(24).toString("base64url"));
values.set("LOGFLARE_PUBLIC_ACCESS_TOKEN", randomBytes(24).toString("base64url"));
values.set("LOGFLARE_PRIVATE_ACCESS_TOKEN", randomBytes(24).toString("base64url"));
values.set("S3_PROTOCOL_ACCESS_KEY_ID", randomBytes(16).toString("hex"));
values.set("S3_PROTOCOL_ACCESS_KEY_SECRET", randomBytes(32).toString("hex"));
values.set("API_EXTERNAL_URL", "http://127.0.0.1:8000/auth/v1");
```

既存の `API_EXTERNAL_URL=http://127.0.0.1:8000` 設定は削除する。legacy `JWT_SECRET`、`ANON_KEY`、`SERVICE_ROLE_KEY` は継続し、空の非対称JWT・opaque APIキーを独自生成しない。

- [ ] **Step 6: プロジェクト向け環境変数見本を最新Auth URLへ合わせる**

`.env.example` を次の値へ変更する。

```dotenv
API_EXTERNAL_URL=http://127.0.0.1:8000/auth/v1
```

`tests/tooling/compose.test.mjs` のloopback URLテストも `/auth/v1` を期待するよう変更する。

```js
assert.match(example, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000\/auth\/v1$/mu);
```

- [ ] **Step 7: tooling Composeとgeneratorのテストを通す**

Run:

```bash
docker compose --env-file /dev/null -f compose.tooling.yaml config --quiet
LOCAL_UID=1234 LOCAL_GID=5678 docker compose --env-file /dev/null -f compose.tooling.yaml run --rm --entrypoint node local-secrets -e 'if (process.env.LOCAL_UID !== "1234" || process.env.LOCAL_GID !== "5678") process.exit(1)'
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
```

Expected: tooling Composeの構文検証成功、実コンテナ内の `LOCAL_UID=1234` と `LOCAL_GID=5678` を確認し、対象NodeテストPASS。この実行時配線テストにより、`user:` だけが補間されて `environment:` が欠落する回帰を検出する。

- [ ] **Step 8: コミットする**

```bash
./scripts/run-tooling-git.sh add compose.tooling.yaml scripts/run-tooling-git.sh scripts/generate-local-secrets.sh scripts/generate-local-secrets.mjs .env.example tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
./scripts/run-tooling-git.sh commit -m "chore: ローカルツールをDocker実行へ統一"
```

---

### Task 2: トランザクション型Supabase vendor更新

**Files:**
- Modify: `scripts/vendor-supabase.sh`
- Create: `tests/tooling/vendor-supabase.test.sh`
- Replace: `infra/supabase/**`
- Modify: `infra/supabase.version`

**Interfaces:**
- Consumes: `SUPABASE_REPOSITORY`（既定 `https://github.com/supabase/supabase.git`）、`SUPABASE_REF`（既定 `refs/heads/master`）、`--refresh`。
- Produces: PG17公式Composeを含む `infra/supabase/`、40文字SHAの `infra/supabase.version`。失敗時は両方を変更しない。

- [ ] **Step 1: vendorの成功・除外・失敗時不変テストを書く**

`tests/tooling/vendor-supabase.test.sh` を作成する。fixtureリポジトリへPG17構成をコミットして成功経路を検証し、次のコミットでPG15へ変えて更新拒否と既存状態保持を検証する。

```sh
#!/bin/sh
set -eu

root=$(pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM

source_repo="$fixture/source"
workspace="$fixture/workspace"
mkdir -p "$source_repo/docker/utils" "$source_repo/docker/tests" "$workspace/scripts" "$workspace/infra"
git -C "$source_repo" init -q -b master
git -C "$source_repo" config user.name "Kondate Test"
git -C "$source_repo" config user.email "test@kondate.local"

printf 'services:\n  db:\n    image: supabase/postgres:17.6.1.136\n' > "$source_repo/docker/docker-compose.yml"
for path in docker-compose.pg15.yml docker-compose.pg17.yml; do
  : > "$source_repo/docker/$path"
done
for path in upgrade-pg17.sh; do
  : > "$source_repo/docker/utils/$path"
done
: > "$source_repo/docker/tests/test-pg17-upgrade.sh"
git -C "$source_repo" add docker
git -C "$source_repo" commit -q -m "fixture: pg17"
expected_sha=$(git -C "$source_repo" rev-parse HEAD)

cp "$root/scripts/vendor-supabase.sh" "$workspace/scripts/vendor-supabase.sh"
cd "$workspace"
SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh

test "$(cat infra/supabase.version)" = "$expected_sha"
grep -q 'supabase/postgres:17.6.1.136' infra/supabase/docker-compose.yml
test ! -e infra/supabase/docker-compose.pg15.yml
test ! -e infra/supabase/docker-compose.pg17.yml
test ! -e infra/supabase/utils/upgrade-pg17.sh
test ! -e infra/supabase/tests/test-pg17-upgrade.sh

mkdir -p infra/supabase/volumes/db/data
printf 'runtime data\n' > infra/supabase/volumes/db/data/PG_VERSION
chown -R 105:0 infra/supabase/volumes/db/data
chmod 700 infra/supabase/volumes/db/data

printf 'refreshed fixture\n' > "$source_repo/docker/README.md"
git -C "$source_repo" add docker/README.md
git -C "$source_repo" commit -q -m "fixture: refreshed pg17"
expected_sha=$(git -C "$source_repo" rev-parse HEAD)

SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh

test "$(cat infra/supabase.version)" = "$expected_sha"
test ! -e infra/supabase/volumes/db/data/PG_VERSION
set -- infra/.supabase-backup.*
test ! -e "$1"
set -- infra/.supabase-version-backup.*
test ! -e "$1"
test "$(stat -c '%u:%g' infra/supabase.version)" = "$LOCAL_UID:$LOCAL_GID"
owners=$(find infra/supabase -exec stat -c '%u:%g' {} \; | sort -u)
test "$owners" = "$LOCAL_UID:$LOCAL_GID"

printf 'services:\n  db:\n    image: supabase/postgres:15.8.1.085\n' > "$source_repo/docker/docker-compose.yml"
git -C "$source_repo" add docker/docker-compose.yml
git -C "$source_repo" commit -q -m "fixture: pg15"

if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "PG15 fixture was accepted" >&2
  exit 1
fi

test "$(cat infra/supabase.version)" = "$expected_sha"
grep -q 'supabase/postgres:17.6.1.136' infra/supabase/docker-compose.yml
echo "vendor-supabase transactional tests passed"
```

- [ ] **Step 2: vendorコンテナでテストが失敗することを確認する**

Run:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase tests/tooling/vendor-supabase.test.sh
```

Expected: 現行スクリプトがbash依存かつトランザクション契約を持たないためFAIL。

- [ ] **Step 3: vendorスクリプトをPOSIX shell・完全SHA・事前検証へ変更する**

`scripts/vendor-supabase.sh` を次の構造で置き換える。コードコメントを追加する場合は日本語で書く。

```sh
#!/bin/sh
set -eu

repository=${SUPABASE_REPOSITORY:-https://github.com/supabase/supabase.git}
ref=${SUPABASE_REF:-refs/heads/master}
target=infra/supabase
version_file=infra/supabase.version
running_as_root=false

if [ "$(id -u)" = "0" ]; then
  running_as_root=true
  local_uid=${LOCAL_UID:-}
  local_gid=${LOCAL_GID:-}
  case "$local_uid" in
    ""|*[!0-9]*) echo "LOCAL_UID must be numeric when running as root" >&2; exit 1 ;;
  esac
  case "$local_gid" in
    ""|*[!0-9]*) echo "LOCAL_GID must be numeric when running as root" >&2; exit 1 ;;
  esac
fi

if [ -e "$target" ] && [ "${1:-}" != "--refresh" ]; then
  echo "$target already exists; pass --refresh to replace generated vendor content" >&2
  exit 1
fi

staging=$(mktemp -d "$(pwd)/infra/.supabase-refresh.XXXXXX")
checkout="$staging/repository"
archive="$staging/docker.tar"
new_target="$staging/supabase"
new_version="$staging/supabase.version"
backup_target="infra/.supabase-backup.$$"
backup_version="infra/.supabase-version-backup.$$"
swap_started=false
swap_completed=false
had_target=false
had_version=false

finish() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$swap_started" = true ] && [ "$swap_completed" != true ]; then
    rm -rf "$target" || :
    rm -f "$version_file" || :
    if [ "$had_target" = true ] && [ -e "$backup_target" ]; then
      mv "$backup_target" "$target"
    fi
    if [ "$had_version" = true ] && [ -e "$backup_version" ]; then
      mv "$backup_version" "$version_file"
    fi
  fi
  rm -rf "$staging" "$backup_target" || :
  rm -f "$backup_version" || :
  exit "$status"
}
trap finish EXIT HUP INT TERM

git -C "$staging" init -q repository
git -C "$checkout" remote add origin "$repository"
git -C "$checkout" fetch -q --depth 1 origin "$ref"
resolved_sha=$(git -C "$checkout" rev-parse FETCH_HEAD)
printf '%s\n' "$resolved_sha" | grep -Eq '^[0-9a-f]{40}$'

git -C "$checkout" archive --format=tar --output="$archive" FETCH_HEAD:docker
mkdir -p "$new_target"
tar -xf "$archive" -C "$new_target"

db_images=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(supabase\/postgres:[^[:space:]]*\).*$/\1/p' "$new_target/docker-compose.yml")
test "$(printf '%s\n' "$db_images" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
case "$db_images" in
  supabase/postgres:17.*) ;;
  *) echo "official db image is not Postgres 17: $db_images" >&2; exit 1 ;;
esac

rm -f \
  "$new_target/docker-compose.pg15.yml" \
  "$new_target/docker-compose.pg17.yml" \
  "$new_target/utils/upgrade-pg17.sh" \
  "$new_target/tests/test-pg17-upgrade.sh"
printf '%s\n' "$resolved_sha" > "$new_version"
if [ "$running_as_root" = true ]; then
  chown -R "$local_uid:$local_gid" "$new_target" "$new_version"
fi

swap_started=true
if [ -e "$target" ]; then
  had_target=true
  mv "$target" "$backup_target"
fi
if [ -e "$version_file" ]; then
  had_version=true
  mv "$version_file" "$backup_version"
fi
mv "$new_target" "$target"
mv "$new_version" "$version_file"
swap_completed=true
if ! rm -rf "$backup_target"; then
  echo "warning: could not remove old vendor backup: $backup_target" >&2
fi
if ! rm -f "$backup_version"; then
  echo "warning: could not remove old version backup: $backup_version" >&2
fi

echo "Vendored supabase/supabase $resolved_sha docker/"
```

- [ ] **Step 4: ローカルfixtureテストを通す**

Run:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase tests/tooling/vendor-supabase.test.sh
```

Expected: `vendor-supabase transactional tests passed`、exit 0。

- [ ] **Step 5: 最新公式masterのPG17デフォルトを読み取り専用で再確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -c 'set -eu; tmp=$(mktemp -d); trap "rm -rf $tmp" EXIT; git -C "$tmp" init -q; git -C "$tmp" remote add origin https://github.com/supabase/supabase.git; git -C "$tmp" fetch -q --depth 1 origin refs/heads/master; sha=$(git -C "$tmp" rev-parse FETCH_HEAD); image=$(git -C "$tmp" show FETCH_HEAD:docker/docker-compose.yml | sed -n "s/^[[:space:]]*image:[[:space:]]*\(supabase\/postgres:[^[:space:]]*\).*$/\1/p"); printf "%s %s\n" "$sha" "$image"; printf "%s\n" "$sha" | grep -Eq "^[0-9a-f]{40}$"; case "$image" in supabase/postgres:17.*) ;; *) exit 1 ;; esac'
```

Expected: 40文字SHAと単一の `supabase/postgres:17.*` を表示してexit 0。計画レビュー時点では `b5ada9631df0a42cdb6e402eaf0ca18ff52aed80 supabase/postgres:17.6.1.136` を再確認済み。このpreflightは `/tmp` だけを使用し、workspaceを変更しない。

- [ ] **Step 6: 最新公式masterをDocker内からvendorする**

Run:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose -f compose.tooling.yaml run --rm --user 0:0 vendor-supabase --refresh
```

実更新は異UID・mode 700のruntime dataを含む旧backupも削除できるようrootで実行する。スクリプトはswap前に新しいvendor treeとversion fileを数値検証済みの `LOCAL_UID` / `LOCAL_GID` へ再帰chownするため、成果物はroot所有にならない。

Expected:

- `infra/supabase.version` は40文字SHA。実装時点でmasterが動いていなければ `b5ada9631df0a42cdb6e402eaf0ca18ff52aed80`。
- `infra/supabase/docker-compose.yml` のDBは `supabase/postgres:17.6.1.136`。上流が進んでいる場合は、その固定SHAに記載された新しい17系完全タグ。
- 除外対象4ファイルは存在しない。

- [ ] **Step 7: vendor結果と差分の健全性を確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -c 'test "$(wc -c < infra/supabase.version)" -eq 41 && grep -Eq "^[0-9a-f]{40}$" infra/supabase.version && test ! -e infra/supabase/docker-compose.pg15.yml && test ! -e infra/supabase/docker-compose.pg17.yml && test ! -e infra/supabase/utils/upgrade-pg17.sh && test ! -e infra/supabase/tests/test-pg17-upgrade.sh'
```

Expected: exit 0。

- [ ] **Step 8: コミットする**

```bash
./scripts/run-tooling-git.sh add scripts/vendor-supabase.sh tests/tooling/vendor-supabase.test.sh infra/supabase infra/supabase.version
./scripts/run-tooling-git.sh commit -m "chore: Supabase公式Docker構成を最新化"
```

---

### Task 3: Postgres 17の全経路統一とドリフト検出

**Files:**
- Modify: `tests/tooling/compose.test.mjs`
- Modify: `compose.yaml`
- Modify: `Dockerfile.db-test`
- Modify: `supabase/config.toml`
- Modify: `supabase/tests/database/001_extensions_and_schemas.test.sql`

**Interfaces:**
- Consumes: Task 2でvendorした公式 `db` イメージタグ。
- Produces: 同一タグの `db`・`migrate`・`db-test`、内部DB URL `postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres`、PG17を強制する静的テストとpgTAP。

- [ ] **Step 1: Postgresタグと除外資産の静的失敗テストを書く**

`tests/tooling/compose.test.mjs` のimportへ `access` を追加する。

```js
import { access, readFile } from "node:fs/promises";
```

次のテストを追加する。

```js
test("uses one Postgres 17 image across database tooling", async () => {
  const [upstream, compose, dbTest, config, version] = await Promise.all([
    readFile("infra/supabase/docker-compose.yml", "utf8"),
    readFile("compose.yaml", "utf8"),
    readFile("Dockerfile.db-test", "utf8"),
    readFile("supabase/config.toml", "utf8"),
    readFile("infra/supabase.version", "utf8"),
  ]);

  const upstreamImage = upstream.match(/^\s{4}image: (supabase\/postgres:[^\s]+)$/mu)?.[1];
  const migrateBlock = compose.match(/^  migrate:\n([\s\S]*?)(?=^  [\w-]+:|^volumes:)/mu)?.[1];
  const migrateImage = migrateBlock?.match(/^\s{4}image: (supabase\/postgres:[^\s]+)$/mu)?.[1];
  const testImage = dbTest.match(/^FROM (supabase\/postgres:[^\s]+)$/mu)?.[1];

  assert.ok(upstreamImage, "official db image is missing");
  assert.equal(migrateImage, upstreamImage);
  assert.equal(testImage, upstreamImage);
  assert.match(upstreamImage, /^supabase\/postgres:17\./u);
  assert.match(config, /^major_version = 17$/mu);
  assert.match(version.trim(), /^[0-9a-f]{40}$/u);
});

test("removes Postgres 15 compatibility and upgrade assets", async () => {
  for (const path of [
    "infra/supabase/docker-compose.pg15.yml",
    "infra/supabase/docker-compose.pg17.yml",
    "infra/supabase/utils/upgrade-pg17.sh",
    "infra/supabase/tests/test-pg17-upgrade.sh",
  ]) {
    await assert.rejects(access(path));
  }
});

test("uses the internal database address for containerized type generation", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  const app = compose.match(/^  app:\n([\s\S]*?)(?=^  [\w-]+:|^volumes:)/mu)?.[1];
  assert.ok(app, "app service is missing");
  assert.match(
    app,
    /LOCAL_DB_URL: postgresql:\/\/postgres:\$\{POSTGRES_PASSWORD\}@db:5432\/postgres/u,
  );
});
```

- [ ] **Step 2: DBテストへPG17 assertionを追加する**

`supabase/tests/database/001_extensions_and_schemas.test.sql` のplanを7へ増やし、先頭のschema assertionより前へ追加する。

```sql
select plan(7);

select ok(
  current_setting('server_version_num')::integer between 170000 and 179999,
  'database runs PostgreSQL 17'
);
```

- [ ] **Step 3: 現在のプロジェクト固有設定に対して失敗を確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/compose.test.mjs
docker compose run --rm db-test
```

Expected: 静的テストは `migrate`、`db-test`、`major_version`、内部DB URLの不一致でFAIL。DBテストは切り替え前のPG15に対するversion assertionでFAIL。

- [ ] **Step 4: 公式完全タグをmigrateとdb-testへ反映する**

Task 2の `infra/supabase/docker-compose.yml` から完全タグを読み、設計時点の値なら次のように変更する。

`compose.yaml`:

```yaml
  migrate:
    image: supabase/postgres:17.6.1.136
```

`Dockerfile.db-test`:

```dockerfile
FROM supabase/postgres:17.6.1.136

RUN apt-get update \
  && apt-get install -y --no-install-recommends libtap-parser-sourcehandler-pgtap-perl \
  && rm -rf /var/lib/apt/lists/*
```

上流タグが設計時点から進んでいる場合は、両方へTask 2の公式完全タグを同じ値で記載する。

- [ ] **Step 5: Supabase CLI設定と内部DB URLをPG17へ合わせる**

`supabase/config.toml`:

```toml
[db]
port = 54322
major_version = 17
```

`compose.yaml` の `app.environment` へ追加する。

```yaml
      LOCAL_DB_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
```

- [ ] **Step 6: Compose解決と静的テストを通す**

Run:

```bash
docker compose config --quiet
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/compose.test.mjs tests/tooling/project-config.test.mjs
docker compose build db-test
```

Expected: ComposeとNodeテストPASS、PG17ベースの `db-test` イメージbuild成功。`apt-get` またはpgTAP Perl runnerの導入に失敗した場合は、実装を進めず `superpowers:systematic-debugging` でPG17イメージのOS・パッケージマネージャを確認する。

- [ ] **Step 7: コミットする**

```bash
./scripts/run-tooling-git.sh add tests/tooling/compose.test.mjs compose.yaml Dockerfile.db-test supabase/config.toml supabase/tests/database/001_extensions_and_schemas.test.sql
./scripts/run-tooling-git.sh commit -m "chore: データベース環境をPostgres 17へ統一"
```

---

### Task 4: PG17クリーン初期化と統合検証

**Files:**
- Create: `docs/local-development.md`
- Verify: `.env`（Git管理外）
- Verify: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Task 1のシークレット生成、Task 2の最新公式サービス、Task 3のPG17構成。
- Produces: クリーンなPG17ローカルスタック、成功するpgTAP、コンテナ内型生成、開発者向け再現手順。

- [ ] **Step 1: Dockerだけを使う開発手順を書く**

`docs/local-development.md` を作成する。

````markdown
# ローカル開発環境

## 前提

ホストにはDocker Engine、Docker Compose、POSIXシェルが必要です。Node、npm、Git、Supabase CLI、Postgresクライアント、Playwrightはコンテナ内で実行します。

## 初回セットアップまたはSupabase構成更新後

ローカルDBとローカル専用認証情報を破棄して再作成します。

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \\
  docker compose -f compose.tooling.yaml run --rm local-secrets --force
docker compose down --volumes
docker compose up -d --wait
```

Postgres 17を確認します。

```bash
docker compose exec db psql -U postgres -tAc "show server_version"
```

## 通常の検証

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint node local-secrets --test tests/tooling/*.test.mjs
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm db-test
docker compose run --rm app npm run db:types
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

## Supabase公式Docker構成の更新

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \\
  docker compose -f compose.tooling.yaml run --rm --user 0:0 vendor-supabase --refresh
```

実更新だけrootへoverrideして異UIDのruntime dataを含む旧backupを削除し、新vendor成果物はスクリプト内で `LOCAL_UID` / `LOCAL_GID` へ戻します。

更新後はPostgresタグの整合性テストを実行し、ローカル環境を再作成してください。PG15データの移行とロールバックはサポートしません。
````

- [ ] **Step 2: 最新公式環境変数から `.env` を再生成する**

Run:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose -f compose.tooling.yaml run --rm local-secrets --force
```

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -c 'test -f .env; test "$(stat -c %a .env)" = 600; ! grep -q "^COMPOSE_FILE=" .env; grep -q "^API_EXTERNAL_URL=http://127.0.0.1:8000/auth/v1$" .env; grep -Eq "^LOCAL_UID=[0-9]+$" .env; grep -Eq "^LOCAL_GID=[0-9]+$" .env'
```

Expected: exit 0。`.env` はコミットしない。

- [ ] **Step 3: PG15 volumeを破棄してPG17で初期化する**

Run:

```bash
docker compose down --volumes
docker compose pull --ignore-buildable
docker compose up -d --wait --build
```

Expected: 全必須サービスが起動または正常終了し、`docker compose up` がexit 0。これは承認済みの破壊的なローカルDB再作成であり、バックアップは作らない。

- [ ] **Step 4: 実DBバージョンとサービス状態を確認する**

Run:

```bash
docker compose exec db psql -U postgres -tAc "show server_version"
docker compose ps
```

Expected: server versionは `17.` で始まり、healthcheckを持つサービスはhealthy。`migrate` はexit 0。

- [ ] **Step 5: pgTAPとDB型生成をコンテナ内で実行する**

Run:

```bash
docker compose run --rm db-test
docker compose run --rm app npm run db:types
```

Expected: pgTAP 83件がすべてPASS（既存82件＋PG17 assertion）。型生成成功。

Run:

```bash
./scripts/run-tooling-git.sh diff --exit-code -- src/shared/types/database.generated.ts
```

Expected: Postgres major更新だけでは公開schema型が変わらずexit 0。差分が出た場合はコミットせず、最新vendorのschema変更か型生成異常かを `superpowers:systematic-debugging` で切り分ける。

- [ ] **Step 6: 認証を含むE2Eを実行する**

Run:

```bash
./scripts/run-e2e.sh
```

Expected: desktop/mobile Chromiumの全E2EがPASSし、OAuthモックとメール認証フローが最新Authで動作する。

- [ ] **Step 7: ドキュメントをコミットする**

```bash
./scripts/run-tooling-git.sh add docs/local-development.md
./scripts/run-tooling-git.sh commit -m "docs: Docker開発環境の手順を追加"
```

---

### Task 5: 全検証と完了レビュー

**Files:**
- Verify: 全変更ファイル

**Interfaces:**
- Consumes: Task 1〜4のコミット済み成果物。
- Produces: PG17・最新Supabase更新が既存アプリへ回帰を起こしていないことを示す最終検証結果。

- [ ] **Step 1: tooling用ComposeとルートComposeを再検証する**

Run:

```bash
docker compose --env-file /dev/null -f compose.tooling.yaml config --quiet
docker compose config --quiet
docker compose config --images
```

Expected: 両方のconfigが成功。ルートのイメージ一覧に `supabase/postgres:15.*` がなく、公式DBとmigrateは同じ `supabase/postgres:17.*`。

- [ ] **Step 2: Node tooling、Vitest、build、lint、formatをDocker内で実行する**

Run:

```bash
docker compose run --rm --no-deps app node --test tests/tooling/*.test.mjs
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: すべてexit 0。

- [ ] **Step 3: DBとE2Eを再確認する**

Run:

```bash
docker compose run --rm db-test
./scripts/run-e2e.sh
```

Expected: pgTAPと全E2EがPASS。

- [ ] **Step 4: PG15残存参照を確認する**

Run:

```bash
docker compose -f compose.tooling.yaml run --rm --entrypoint sh vendor-supabase -c 'if grep -R -n -E "15\\.8\\.1\\.085|major_version = 15|supabase/postgres:15" compose.yaml Dockerfile.db-test supabase/config.toml scripts infra/supabase/docker-compose.yml; then exit 1; fi'
```

Expected: 実行構成、スクリプト、vendor構成に一致なし。PG15拒否を検証するfixtureテストと過去の設計・計画文書は検索対象外。

- [ ] **Step 5: 完了前レビューを実施する**

`superpowers:requesting-code-review` を使い、設計書と本計画に対する実装差分をレビューする。指摘があれば `superpowers:receiving-code-review` で検証してから修正する。

- [ ] **Step 6: 最終状態を確認する**

Run:

```bash
./scripts/run-tooling-git.sh status --short
./scripts/run-tooling-git.sh log -5 --oneline
```

Expected: `.env`、Docker volume、生成キャッシュはGit管理外。意図しない未コミット差分がなく、日本語Conventional CommitsがTask単位で並ぶ。

- [ ] **Step 7: 完了判定する**

`superpowers:verification-before-completion` を使い、このTaskで得た新しい出力を根拠に完了を報告する。Postgres 17の実バージョン、固定したSupabase SHA、pgTAP件数、Vitest、E2E、build、lint、formatの結果を最終報告へ含める。
