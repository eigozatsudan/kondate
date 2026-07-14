#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"

child_pid=
cleanup() {
  status=$?
  trap - EXIT
  trap '' HUP INT TERM
  cleanup_status=0
  docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" \
    up -d --wait --force-recreate --no-deps auth app || cleanup_status=$?
  if [ "$status" -eq 0 ] && [ "$cleanup_status" -ne 0 ]; then
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

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
  -f "$repo_root/compose.yaml" up -d --wait
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
  up -d --wait auth
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
  up -d --wait --force-recreate --no-deps kong oauth-mock app
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
  run --rm --no-deps e2e "$@"
