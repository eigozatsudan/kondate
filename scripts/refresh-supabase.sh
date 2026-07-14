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
