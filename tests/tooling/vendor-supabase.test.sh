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

printf 'services: # fixture services\n  db: # canonical database\n    image: supabase/postgres:17.6.1.136\n  analytics-db-helper: # decoy service\n    image: supabase/postgres:17.6.1.136\n' > "$source_repo/docker/docker-compose.yml"
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

mkdir -p "$fixture/bin"
printf '%s\n' \
  '#!/bin/sh' \
  'case "${FAIL_MV_STEP:-}:$1:$2" in' \
  '  target_backup:infra/supabase:*/backup-target|target_backup:infra/supabase:infra/.supabase-backup.*) exit 73 ;;' \
  '  version_backup:infra/supabase.version:*/backup-version|version_backup:infra/supabase.version:infra/.supabase-version-backup.*) exit 73 ;;' \
  '  new_target:*/supabase:infra/supabase|target_restore:*/supabase:infra/supabase) exit 73 ;;' \
  '  new_version:*/supabase.version:infra/supabase.version|version_restore:*/supabase.version:infra/supabase.version) exit 73 ;;' \
  '  target_restore:*/backup-target:infra/supabase) exit 74 ;;' \
  '  version_restore:*/backup-version:infra/supabase.version) exit 74 ;;' \
  'esac' \
  'exec /bin/mv "$@"' > "$fixture/bin/mv"
chmod +x "$fixture/bin/mv"
printf '%s\n' \
  '#!/bin/sh' \
  'if [ "${WAIT_FETCH:-}" != "" ] && [ "${1:-}" = "-C" ] && [ "${3:-}" = "fetch" ]; then' \
  '  : > "$WAIT_FETCH_STARTED"' \
  '  while [ ! -e "$WAIT_FETCH_RELEASE" ]; do sleep 0.05; done' \
  'fi' \
  'if [ "${SIGNAL_TO_INJECT:-}" != "" ] && [ "${1:-}" = "-C" ] && [ "${3:-}" = "fetch" ]; then' \
  '  case "$SIGNAL_TO_INJECT" in' \
  '    HUP) kill -HUP "$PPID" ;;' \
  '    INT) kill -INT "$PPID" ;;' \
  '    TERM) kill -TERM "$PPID" ;;' \
  '  esac' \
  '  exit 0' \
  'fi' \
  'exec /usr/bin/git "$@"' > "$fixture/bin/git"
chmod +x "$fixture/bin/git"
printf '%s\n' \
  '#!/bin/sh' \
  'if [ "${FAIL_CLEANUP:-}" != "" ] && [ "${1:-}" = "-rf" ]; then' \
  '  case "${2:-}" in */.supabase-refresh.*) exit 75 ;; esac' \
  'fi' \
  'case "${POST_COMMIT_SIGNAL:-}:$1:${2:-}" in' \
  '  TERM:-rf:*/.supabase-refresh.*)' \
  '    if [ -e "$2" ]; then kill -TERM "$PPID"; fi' \
  '    ;;' \
  'esac' \
  'exec /bin/rm "$@"' > "$fixture/bin/rm"
chmod +x "$fixture/bin/rm"

snapshot_vendor() {
  tar -cf - infra/supabase infra/supabase.version | sha256sum | awk '{print $1}'
}

snapshot_tree() {
  (cd "$1" && tar -cf - .) | sha256sum | awk '{print $1}'
}

snapshot_version() {
  path=$1
  printf '%s ' "$(stat -c '%a:%u:%g' "$path")"
  sha256sum "$path" | awk '{print $1}'
}

assert_failed_swap_unchanged() {
  step=$1
  echo "testing forced swap failure: $step"
  before=$(snapshot_vendor)
  if PATH="$fixture/bin:$PATH" FAIL_MV_STEP="$step" SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
    echo "forced $step failure was accepted" >&2
    exit 1
  fi
  after=$(snapshot_vendor)
  if [ "$after" != "$before" ]; then
    echo "vendor changed after forced $step failure" >&2
    exit 1
  fi
  set -- infra/.supabase-refresh.*
  if [ -e "$1" ]; then
    echo "staging remained after forced $step failure: $1" >&2
    exit 1
  fi
}

assert_signal_rollback() {
  signal=$1
  expected_status=$2
  echo "testing signal rollback: $signal"
  before=$(snapshot_vendor)
  status=0
  PATH="$fixture/bin:$PATH" SIGNAL_TO_INJECT="$signal" SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh || status=$?
  if [ "$status" -ne "$expected_status" ]; then
    echo "unexpected $signal exit status: $status" >&2
    exit 1
  fi
  after=$(snapshot_vendor)
  test "$after" = "$before"
  set -- infra/.supabase-refresh.*
  test ! -e "$1"
}

assert_post_commit_signal_succeeds() {
  echo "testing post-commit signal: TERM"
  status=0
  PATH="$fixture/bin:$PATH" POST_COMMIT_SIGNAL=TERM SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh || status=$?
  if [ "$status" -ne 0 ]; then
    echo "unexpected post-commit TERM exit status: $status" >&2
    exit 1
  fi
  test "$(cat infra/supabase.version)" = "$expected_sha"
  grep -q 'post-commit signal fixture' infra/supabase/README.md
  set -- infra/.supabase-refresh.*
  test ! -e "$1"
}

assert_failed_restore_preserved() {
  step=$1
  before=$(snapshot_vendor)
  tree_before=$(snapshot_tree infra/supabase)
  version_before=$(snapshot_version infra/supabase.version)
  log="$fixture/$step.log"
  if PATH="$fixture/bin:$PATH" FAIL_MV_STEP="$step" SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh 2> "$log"; then
    echo "forced $step failure was accepted" >&2
    exit 1
  fi
  preserved=$(sed -n 's/^rollback incomplete; preserved vendor backup at //p' "$log")
  test -n "$preserved"
  test -d "$preserved"
  case "$step" in
    target_restore)
      test "$(snapshot_tree "$preserved/backup-target")" = "$tree_before"
      test "$(snapshot_version infra/supabase.version)" = "$version_before"
      /bin/mv "$preserved/backup-target" infra/supabase
      ;;
    version_restore)
      test "$(snapshot_tree infra/supabase)" = "$tree_before"
      test "$(snapshot_version "$preserved/backup-version")" = "$version_before"
      /bin/mv "$preserved/backup-version" infra/supabase.version
      ;;
  esac
  rm -rf "$preserved"
  test "$(snapshot_vendor)" = "$before"
}

SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh

test "$(cat infra/supabase.version)" = "$expected_sha"
grep -q 'supabase/postgres:17.6.1.136' infra/supabase/docker-compose.yml
test ! -e infra/supabase/docker-compose.pg15.yml
test ! -e infra/supabase/docker-compose.pg17.yml
test ! -e infra/supabase/utils/upgrade-pg17.sh
test ! -e infra/supabase/tests/test-pg17-upgrade.sh

mkdir infra/.supabase-refresh.lock
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "existing refresh lock was accepted" >&2
  exit 1
fi
rmdir infra/.supabase-refresh.lock

wait_started="$fixture/fetch-started"
wait_release="$fixture/fetch-release"
PATH="$fixture/bin:$PATH" \
  WAIT_FETCH=1 \
  WAIT_FETCH_STARTED="$wait_started" \
  WAIT_FETCH_RELEASE="$wait_release" \
  SUPABASE_REPOSITORY="$source_repo" \
  sh scripts/vendor-supabase.sh --refresh > "$fixture/first-refresh.log" 2>&1 &
first_refresh_pid=$!
for _ in $(seq 1 100); do
  if [ -d infra/.supabase-refresh.lock ] && [ -e "$wait_started" ]; then
    break
  fi
  sleep 0.05
done
test -d infra/.supabase-refresh.lock
test -e "$wait_started"
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "concurrent refresh was accepted" >&2
  exit 1
fi
: > "$wait_release"
if ! wait "$first_refresh_pid"; then
  echo "first concurrent refresh failed" >&2
  exit 1
fi
test ! -e infra/.supabase-refresh.lock

mkdir -p infra/supabase/volumes/db/data
: > infra/supabase/volumes/db/data/postmaster.pid
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "running database marker was accepted" >&2
  exit 1
fi
rm -f infra/supabase/volumes/db/data/postmaster.pid

chmod 755 "$fixture" "$workspace" "$workspace/scripts" "$workspace/infra"
chmod 000 infra/supabase/volumes/db/data
if su nobody -s /bin/sh -c \
  "SUPABASE_REPOSITORY='$source_repo' sh scripts/vendor-supabase.sh --refresh"; then
  echo "unreadable database directory was accepted" >&2
  exit 1
fi
chmod 755 infra/supabase/volumes/db/data

status=0
PATH="$fixture/bin:$PATH" FAIL_CLEANUP=1 SUPABASE_REPOSITORY="$source_repo" \
  sh scripts/vendor-supabase.sh --refresh 2> "$fixture/cleanup.log" || status=$?
test "$status" -ne 0
grep -q '^vendor cleanup incomplete; preserved staging at ' "$fixture/cleanup.log"
test "$(cat infra/supabase.version)" = "$expected_sha"
preserved_cleanup=$(sed -n 's/^vendor cleanup incomplete; preserved staging at //p' "$fixture/cleanup.log" | tail -n 1)
test -n "$preserved_cleanup"
/bin/rm -rf "$preserved_cleanup"

printf 'post-commit signal fixture\n' > "$source_repo/docker/README.md"
git -C "$source_repo" add docker/README.md
git -C "$source_repo" commit -q -m "fixture: post-commit signal"
expected_sha=$(git -C "$source_repo" rev-parse HEAD)
assert_post_commit_signal_succeeds

for step in target_backup version_backup new_target new_version; do
  assert_failed_swap_unchanged "$step"
done
assert_signal_rollback HUP 129
assert_signal_rollback INT 130
assert_signal_rollback TERM 143
for step in target_restore version_restore; do
  assert_failed_restore_preserved "$step"
done

mkdir -p infra/supabase/volumes/db/data
printf 'runtime data\n' > infra/supabase/volumes/db/data/PG_VERSION
chown -R 105:0 infra/supabase/volumes/db/data
chmod 700 infra/supabase/volumes/db/data
mkdir -p infra/.supabase-backup.1
printf 'preserve old target backup\n' > infra/.supabase-backup.1/marker
printf 'preserve old version backup\n' > infra/.supabase-version-backup.1

printf 'refreshed fixture\n' > "$source_repo/docker/README.md"
git -C "$source_repo" add docker/README.md
git -C "$source_repo" commit -q -m "fixture: refreshed pg17"
expected_sha=$(git -C "$source_repo" rev-parse HEAD)

SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh

test "$(cat infra/supabase.version)" = "$expected_sha"
test ! -e infra/supabase/volumes/db/data/PG_VERSION
grep -q 'preserve old target backup' infra/.supabase-backup.1/marker
grep -q 'preserve old version backup' infra/.supabase-version-backup.1
set -- infra/.supabase-refresh.*
test ! -e "$1"
version_owner=$(stat -c '%u:%g' infra/supabase.version)
if [ "$version_owner" != "$LOCAL_UID:$LOCAL_GID" ]; then
  echo "unexpected version owner: $version_owner" >&2
  exit 1
fi
owners=$(find infra/supabase -exec stat -c '%u:%g' {} \; | sort -u)
if [ "$owners" != "$LOCAL_UID:$LOCAL_GID" ]; then
  echo "unexpected vendor owners: $owners" >&2
  exit 1
fi

printf 'services:\n  db:\n    image: supabase/postgres:15.8.1.085\n  pg17-decoy:\n    image: supabase/postgres:17.6.1.136\n' > "$source_repo/docker/docker-compose.yml"
git -C "$source_repo" add docker/docker-compose.yml
git -C "$source_repo" commit -q -m "fixture: pg15"

before=$(snapshot_vendor)
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "PG15 fixture was accepted" >&2
  exit 1
fi

after=$(snapshot_vendor)
test "$after" = "$before"

printf 'services:\n  db:\n    command: postgres\n' > "$source_repo/docker/docker-compose.yml"
git -C "$source_repo" add docker/docker-compose.yml
git -C "$source_repo" commit -q -m "fixture: missing db image"
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "missing db image fixture was accepted" >&2
  exit 1
fi
test "$(snapshot_vendor)" = "$before"

printf 'services:\n  db:\n    image: supabase/postgres:17.6.1.136\n    image: supabase/postgres:17.7.0.001\n' > "$source_repo/docker/docker-compose.yml"
git -C "$source_repo" add docker/docker-compose.yml
git -C "$source_repo" commit -q -m "fixture: duplicate db image"
if SUPABASE_REPOSITORY="$source_repo" sh scripts/vendor-supabase.sh --refresh; then
  echo "duplicate db image fixture was accepted" >&2
  exit 1
fi
test "$(snapshot_vendor)" = "$before"
echo "vendor-supabase transactional tests passed"
