#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"
export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

child_pid=
forward_signal() {
  signal=$1
  status=$2
  trap '' HUP INT TERM
  if [ -n "$child_pid" ]; then
    kill -s "$signal" "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap 'forward_signal HUP 129' HUP
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM

run_child() {
  "$@" &
  child_pid=$!
  if wait "$child_pid"; then
    status=0
  else
    status=$?
  fi
  child_pid=
  return "$status"
}

run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" down --remove-orphans
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.tooling.yaml" run --rm --user 0:0 vendor-supabase --refresh
run_child "$script_dir/reset-local-db.sh"
