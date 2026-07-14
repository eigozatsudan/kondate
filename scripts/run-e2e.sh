#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"
lock_dir=$repo_root/.run-e2e.lock

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
lock_acquired=0

start_watchdog() {
  if [ -n "$watchdog_pid" ]; then
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
  if [ -n "$child_pid" ]; then
    # wrapperが現在所有するPIDだけを参照し、watchdog側で古いPIDを保持しない。
    kill -s KILL "$child_pid" 2>/dev/null || true
  fi
}
trap force_child_after_grace ALRM

deliver_signal() {
  if [ -z "$child_pid" ]; then
    return
  fi
  if [ "$signal_count" -gt 1 ]; then
    # 再入力後は復元中でも待機を打ち切り、孤児を残さず回収へ進める。
    kill -s KILL "$child_pid" 2>/dev/null || true
  elif [ "$cleanup_started" -eq 1 ]; then
    # 初回signalでは復元を中断せず、grace期限まで正常完了を待つ。
    start_watchdog
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
  if [ "$cleanup_started" -eq 1 ] && [ "$termination_status" -ne 0 ] && [ -z "$watchdog_pid" ]; then
    # cleanupの子が切り替わっても、記録済みsignalのgrace期限を各子へ適用する。
    start_watchdog
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
  kill_status=0
  removal_status=0
  restore_status=0
  if run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    kill --signal SIGKILL e2e; then
    :
  else
    kill_status=$?
  fi
  if run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    rm --force e2e; then
    :
  else
    removal_status=$?
  fi
  if run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" \
    up -d --wait --force-recreate --no-deps auth app; then
    :
  else
    restore_status=$?
  fi
  if [ "$termination_status" -ne 0 ]; then
    original_status=$termination_status
  elif [ "$original_status" -ne 0 ]; then
    :
  elif [ "$kill_status" -ne 0 ]; then
    original_status=$kill_status
  elif [ "$removal_status" -ne 0 ]; then
    original_status=$removal_status
  elif [ "$restore_status" -ne 0 ]; then
    original_status=$restore_status
  fi
  return "$original_status"
}

release_lock() {
  if [ "$lock_acquired" -eq 0 ]; then
    return 0
  fi
  if rmdir "$lock_dir"; then
    lock_acquired=0
    return 0
  else
    return $?
  fi
}

finish() {
  final_status=$1
  trap '' HUP INT TERM ALRM
  release_status=0
  if release_lock; then
    :
  else
    release_status=$?
  fi
  if [ "$final_status" -eq 0 ] && [ "$termination_status" -ne 0 ]; then
    final_status=$termination_status
  fi
  if [ "$final_status" -eq 0 ] && [ "$release_status" -ne 0 ]; then
    final_status=$release_status
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

if mkdir "$lock_dir"; then
  lock_acquired=1
else
  trap - EXIT
  echo "another E2E run is active: $lock_dir" >&2
  exit 1
fi

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
