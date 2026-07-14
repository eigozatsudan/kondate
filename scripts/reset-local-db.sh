#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"

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
  -f "$repo_root/compose.yaml" down --volumes --remove-orphans
if run_child docker container inspect supabase-db > /dev/null 2>&1; then
  echo "supabase-db remains after expected project shutdown; stop and remove the legacy/foreign Compose project before retrying" >&2
  exit 1
else
  inspect_status=$?
fi
if [ "$inspect_status" -ne 1 ]; then
  echo "failed to verify whether supabase-db still exists" >&2
  exit "$inspect_status"
fi
# 公式ComposeのPGDATAはbind mountのため、named volumeとは別に削除する。
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.tooling.yaml" run --rm --user 0:0 --entrypoint sh \
  vendor-supabase -c 'if [ -e /workspace/infra/supabase/volumes/db/data/postmaster.pid ]; then echo "PGDATA is still active; stop the owning database before retrying" >&2; exit 1; fi; rm -rf /workspace/infra/supabase/volumes/db/data'
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" up -d --wait
