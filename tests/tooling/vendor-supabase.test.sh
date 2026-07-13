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
