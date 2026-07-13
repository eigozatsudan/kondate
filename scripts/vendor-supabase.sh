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
