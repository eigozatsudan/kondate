#!/bin/sh
# Composeスタックを停止し、ベンダー取り込み済みのSupabaseソース
# （infra/supabase）を最新に更新してから、ローカルDBをリセットする一連の
# 手順をまとめて実行する。各ステップは子プロセスとして起動し、シグナルを
# 転送しつつ終了を待つ（run_child/forward_signal）。
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
# HUP/INT/TERM受信時、実行中の子プロセスへ同じシグナルを転送してから
# 完了を待つ。子を放置したまま自身だけ終了しないようにするため。
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

# 1) 現行のCompose開発スタックを停止する。
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" down --remove-orphans
# 2) vendor-supabase.sh を --refresh 付きで実行し、infra/supabase を最新化する。
run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.tooling.yaml" run --rm --user 0:0 vendor-supabase --refresh
# 3) 更新後のスキーマ/イメージでローカルDBを作り直す。
run_child "$script_dir/reset-local-db.sh"
