#!/bin/sh
# E2Eテスト用Composeプロファイルを起動し、Playwrightコンテナ(e2e)を実行して、
# 成功・失敗・中断のいずれの経路でも必ずE2E専用コンテナを片付け、
# 通常の開発スタック(auth/app)を元の状態に復元するラッパー。
#
# 多重起動防止のディレクトリロック(lock_dir)、二重の後始末を避けるための
# シグナル処理（1回目は猶予期間中に子の自然終了を待ち、2回目以降は即killする）、
# 猶予時間切れをwatchdogサブシェルからALRMで通知する仕組みを持つため、
# 全体が長く複雑になっている。読む際は「run_child = 子プロセスの起動と
# シグナル/終了待ち」「cleanup = E2Eコンテナの後始末」「finish = ロック解放と
# 最終exit」の3層構造として捉えるとよい。
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"
lock_dir=$repo_root/.run-e2e.lock

# シグナル受信後、子プロセスの自然終了をどれだけ待つかの猶予秒数。
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

# signal_grace_seconds経過しても子プロセスが自然終了しない場合に、
# 現在のwrapperプロセス自身へALRMを送って強制killを促すサブシェル。
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

# 子プロセスが猶予内に終了した場合、不要になったwatchdogを止めて回収する。
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

# watchdogからのALRM受信時に呼ばれる: 猶予切れなので現在の子を強制killする。
force_child_after_grace() {
  if [ -n "$child_pid" ]; then
    # wrapperが現在所有するPIDだけを参照し、watchdog側で古いPIDを保持しない。
    kill -s KILL "$child_pid" 2>/dev/null || true
  fi
}
trap force_child_after_grace ALRM

# 受信したシグナルを現在の子プロセスへ実際に転送する。1回目は対象シグナルを
# 送って猶予期間だけ待ち、2回目以降（再度Ctrl-C等）はためらわず強制killする。
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

# HUP/INT/TERMのtrapから呼ばれる。最初に受けたシグナル種別と終了コードを
# 記録し、子プロセスが起動済みなら即座に配送、未起動ならフラグだけ立てて
# run_child起動直後に配送させる。
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

# コマンドをバックグラウンドで起動し、終了(またはシグナルによる中断)まで
# 待つ共通ヘルパー。cleanupフェーズ以外で既に中断が確定していれば
# 新規コマンドを起動せず即座に失敗を返す。
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

# E2E用コンテナをkill・削除し、通常の開発スタック(auth/app)を
# force-recreateで復元する。成否に関わらず全ステップを実行し、
# 最初に発生した失敗のステータスを返す。
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

# 多重起動防止用のロックディレクトリを解放する（自身が取得した場合のみ）。
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

# ロック解放後の最終的なexitコードを決定して終了する。シグナルによる
# 中断やロック解放失敗があれば、それを最終ステータスに反映する。
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

# EXIT trap: run_e2e_commandsの通常経路をバイパスして早期returnした場合の
# 保険として、未実施ならcleanupとfinishを実行する。
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

# 通常の開発スタックを起動したうえで、E2E専用プロファイルのauthを追加起動し、
# kong/oauth-mock/appをE2E向け設定で強制再作成してから、実際のPlaywright
# テストランナー(e2e)を実行する。
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
