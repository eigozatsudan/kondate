#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"

signal_grace_seconds=${KONDATE_E2E_SIGNAL_GRACE_SECONDS:-5}
if ! printf '%s\n' "$signal_grace_seconds" | grep -Eq '^(0|[1-9][0-9]*)([.][0-9]+)?$'; then
  echo "KONDATE_E2E_SIGNAL_GRACE_SECONDS must be a non-negative number" >&2
  exit 2
fi

wrapper_pid=$$
child_pid=
watchdog_pid=
launch_in_progress=0
termination_status=0
active_signal=
signal_count=0
signal_pending=0
cleanup_started=0

start_watchdog() {
  if [ "$cleanup_started" -eq 1 ] || [ -n "$watchdog_pid" ]; then
    return
  fi
  (
    timer_pid=
    stop_requested=0
    stop_watchdog() {
      stop_requested=1
    }
    trap stop_watchdog HUP INT TERM
    sleep "$signal_grace_seconds" &
    timer_pid=$!
    if [ "$stop_requested" -eq 1 ]; then
      kill -s TERM "$timer_pid" 2>/dev/null || true
    fi
    while :; do
      if wait "$timer_pid"; then
        timer_status=0
        break
      else
        timer_status=$?
      fi
      if [ "$stop_requested" -eq 1 ]; then
        kill -s TERM "$timer_pid" 2>/dev/null || true
      fi
      if kill -0 "$timer_pid" 2>/dev/null; then
        continue
      fi
      break
    done
    timer_pid=
    if [ "$stop_requested" -eq 0 ] && [ "$timer_status" -eq 0 ]; then
      kill -s ALRM "$wrapper_pid" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!
}

cancel_watchdog() {
  if [ -z "$watchdog_pid" ]; then
    return
  fi
  kill -s TERM "$watchdog_pid" 2>/dev/null || true
  while kill -0 "$watchdog_pid" 2>/dev/null; do
    if wait "$watchdog_pid" 2>/dev/null; then
      break
    fi
  done
  wait "$watchdog_pid" 2>/dev/null || true
  watchdog_pid=
}

force_child_after_grace() {
  if [ "$cleanup_started" -eq 0 ] && [ -n "$child_pid" ]; then
    # wrapperが現在所有するPIDだけを参照し、watchdog側で古いPIDを保持しない。
    kill -s KILL "$child_pid" 2>/dev/null || true
  fi
}
trap force_child_after_grace ALRM

deliver_signal() {
  if [ -z "$child_pid" ]; then
    return
  fi
  if [ "$cleanup_started" -eq 1 ] || [ "$signal_count" -gt 1 ]; then
    # 通常処理の再入力とcleanup中断では、孤児を残さず必ず回収へ進める。
    kill -s KILL "$child_pid" 2>/dev/null || true
  else
    kill -s "$active_signal" "$child_pid" 2>/dev/null || true
    start_watchdog
  fi
}

record_signal() {
  signal=$1
  received_status=$2
  if [ "$termination_status" -eq 0 ]; then
    termination_status=$received_status
  fi
  if [ -z "$active_signal" ]; then
    active_signal=$signal
  fi
  signal_count=$((signal_count + 1))
  if [ -n "$child_pid" ]; then
    deliver_signal
  else
    signal_pending=1
  fi
}
trap 'record_signal HUP 129' HUP
trap 'record_signal INT 130' INT
trap 'record_signal TERM 143' TERM

run_child() {
  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi
  # fork直後にtrapが動いても、PID公開後に保留signalを配送する。
  launch_in_progress=1
  "$@" &
  child_pid=$!
  launch_in_progress=0
  if [ "$signal_pending" -eq 1 ]; then
    signal_pending=0
    deliver_signal
  fi
  while :; do
    if wait "$child_pid"; then
      child_status=0
      break
    else
      child_status=$?
    fi
    if kill -0 "$child_pid" 2>/dev/null; then
      continue
    fi
    break
  done
  child_pid=
  cancel_watchdog
  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi
  return "$child_status"
}

cleanup() {
  original_status=$1
  cleanup_started=1
  active_signal=
  signal_count=0
  signal_pending=0
  cleanup_status=0
  if run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" \
    up -d --wait --force-recreate --no-deps auth app; then
    :
  else
    cleanup_status=$?
  fi
  if [ "$original_status" -eq 0 ]; then
    if [ "$termination_status" -ne 0 ]; then
      original_status=$termination_status
    elif [ "$cleanup_status" -ne 0 ]; then
      original_status=$cleanup_status
    fi
  fi
  return "$original_status"
}

finish() {
  final_status=$1
  trap '' HUP INT TERM ALRM
  if [ "$final_status" -eq 0 ] && [ "$termination_status" -ne 0 ]; then
    final_status=$termination_status
  fi
  exit "$final_status"
}

cleanup_on_exit() {
  unexpected_status=$?
  trap - EXIT
  if cleanup "$unexpected_status"; then
    final_status=0
  else
    final_status=$?
  fi
  finish "$final_status"
}
trap cleanup_on_exit EXIT

run_e2e_commands() {
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" up -d --wait || return $?
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    up -d --wait auth || return $?
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    up -d --wait --force-recreate --no-deps kong oauth-mock app || return $?
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    run --rm --no-deps e2e "$@"
}

if run_e2e_commands "$@"; then
  e2e_status=0
else
  e2e_status=$?
fi
trap - EXIT
if cleanup "$e2e_status"; then
  final_status=0
else
  final_status=$?
fi
finish "$final_status"
