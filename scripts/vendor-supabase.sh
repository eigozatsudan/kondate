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
backup_target="$staging/backup-target"
backup_version="$staging/backup-version"
target_backed_up=false
version_backed_up=false
target_installed=false
version_installed=false
operation_completed=false
preserve_staging=false

restore_signal_traps() {
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

finish() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$operation_completed" != true ]; then
    if [ "$target_installed" = true ]; then
      if rm -rf "$target"; then
        target_installed=false
      else
        preserve_staging=true
      fi
    fi
    if [ "$version_installed" = true ]; then
      if rm -f "$version_file"; then
        version_installed=false
      else
        preserve_staging=true
      fi
    fi
    if [ "$target_backed_up" = true ] && [ "$target_installed" = false ]; then
      if mv "$backup_target" "$target"; then
        target_backed_up=false
      else
        preserve_staging=true
      fi
    fi
    if [ "$version_backed_up" = true ] && [ "$version_installed" = false ]; then
      if mv "$backup_version" "$version_file"; then
        version_backed_up=false
      else
        preserve_staging=true
      fi
    fi
    if [ "$target_backed_up" = true ] || [ "$version_backed_up" = true ]; then
      preserve_staging=true
    fi
  fi
  if [ "$preserve_staging" = true ]; then
    echo "rollback incomplete; preserved vendor backup at $staging" >&2
  elif ! rm -rf "$staging"; then
    echo "warning: could not remove vendor staging directory: $staging" >&2
  fi
  exit "$status"
}
trap finish EXIT
restore_signal_traps

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

if [ -e "$target" ]; then
  trap '' HUP INT TERM
  mv "$target" "$backup_target"
  target_backed_up=true
  restore_signal_traps
fi
if [ -e "$version_file" ]; then
  trap '' HUP INT TERM
  mv "$version_file" "$backup_version"
  version_backed_up=true
  restore_signal_traps
fi
trap '' HUP INT TERM
mv "$new_target" "$target"
target_installed=true
restore_signal_traps
trap '' HUP INT TERM
mv "$new_version" "$version_file"
version_installed=true
operation_completed=true
if ! rm -rf "$staging"; then
  echo "warning: could not remove vendor staging directory: $staging" >&2
fi

echo "Vendored supabase/supabase $resolved_sha docker/"
