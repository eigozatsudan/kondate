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
