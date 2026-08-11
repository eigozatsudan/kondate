#!/bin/sh
# E2Eテスト用Composeプロファイルを起動し、Playwrightコンテナ(e2e)を実行して、
# 成功・失敗・中断のいずれの経路でも必ずE2E専用コンテナを片付け、
# ローカルでは通常の開発スタック(auth/app)を元の状態に復元するラッパー。
# CI=true のときは GHA / ci.sh が直後に down --volumes するため restore を省略する。
#
# 多重起動防止のディレクトリロック(lock_dir)、二重の後始末を避けるための
# シグナル処理（1回目は猶予期間中に子の自然終了を待ち、2回目以降は即killする）、
# 猶予時間切れをwatchdogサブシェルからALRMで通知する仕組みを持つため、
# 全体が長く複雑になっている。読む際は「run_child = 子プロセスの起動と
# シグナル/終了待ち」「cleanup = E2Eコンテナの後始末」「finish = ロック解放と
# 最終exit」の3層構造として捉えるとよい。
#
# full の本体は mobile-chromium と desktop-chromium を同一 wrapper 内で並列起動する
# （案 B: 壁時計 ≈ max(mobile, desktop)）。setup は直前に 1 回だけ直列。
# 中間 AI 枠 reset はしない（開始時 1 回 + compose.e2e の GLOBAL_DAILY 500）。
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

# KONDATE_E2E_SKIP_RECREATE は開発反復専用（開始時 force-recreate 省略）。
# CI で有効だと auth rate-limit カウンタや古い app env のまま full が走るため、
# CI=true との同時指定はロック取得前に fail-closed で拒否する（Spec §7.7）。
if [ "${CI:-}" = "true" ] && [ "${KONDATE_E2E_SKIP_RECREATE:-}" = "1" ]; then
  echo "KONDATE_E2E_SKIP_RECREATE=1 is development-only and cannot be combined with CI=true" >&2
  exit 2
fi

project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
"$script_dir/ensure-compose-project-env.sh" "$repo_root" "$project_name"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"
lock_dir=$repo_root/.run-e2e.lock
# holder の pid を書き、kill -9 / OOM 後の stale ロックを回収する（E2E11）
lock_pid_file=$lock_dir/pid

# シグナル受信後、子プロセスの自然終了をどれだけ待つかの猶予秒数。
signal_grace_seconds=${KONDATE_E2E_SIGNAL_GRACE_SECONDS:-5}
if ! printf '%s\n' "$signal_grace_seconds" | grep -Eq '^(0|[1-9][0-9]*)([.][0-9]+)?$'; then
  echo "KONDATE_E2E_SIGNAL_GRACE_SECONDS must be a non-negative number" >&2
  exit 2
fi

wrapper_pid=$$
# 単一待ち用。並列待ち中は child_pids（空白区切り）も併用する。
child_pid=
child_pids=
watchdog_pid=
launch_in_progress=0
termination_status=0
active_signal=
signal_count=0
signal_pending=0
cleanup_started=0
lock_acquired=0

# アクティブな子 PID があるか（単一 / 並列のどちらでも）。
has_active_children() {
  [ -n "$child_pid" ] || [ -n "$child_pids" ]
}

# シグナル配送・強制 kill 用に、所有中の子へコマンドを適用する。
# 並列中は child_pids（空白区切り）、通常は child_pid 単体。
# 意図的に word-split する（PID は整数のみ）。
for_each_child_pid() {
  if [ -n "$child_pids" ]; then
    for pid in $child_pids; do
      "$@" "$pid" || true
    done
    return
  fi
  if [ -n "$child_pid" ]; then
    "$@" "$child_pid" || true
  fi
}

# 所有 PID 一覧を空にする（wait 完了後）。
clear_child_pids() {
  child_pid=
  child_pids=
}

# signal_grace_seconds経過しても子プロセスが自然終了しない場合に、
# 現在のwrapperプロセス自身へALRMを送って強制killを促すサブシェル。
start_watchdog() {
  if [ -n "$watchdog_pid" ]; then
    return
  fi
  (
    timer_pid=
    stop_requested=0
    # cancel_watchdog から TERM を受けたら sleep を即止めないと、
    # wait が割り込まれない環境では grace 秒まるごとブロックし、
    # 呼び出し側の短い timeout（2–3s）と衝突して restore 途中で落ちる。
    stop_watchdog() {
      stop_requested=1
      if [ -n "$timer_pid" ]; then
        kill -s KILL "$timer_pid" 2>/dev/null || true
      fi
    }
    trap stop_watchdog HUP INT TERM
    sleep "$signal_grace_seconds" &
    timer_pid=$!
    if [ "$stop_requested" -eq 1 ]; then
      kill -s KILL "$timer_pid" 2>/dev/null || true
    fi
    while :; do
      if wait "$timer_pid"; then
        timer_status=0
        break
      else
        timer_status=$?
      fi
      if [ "$stop_requested" -eq 1 ]; then
        kill -s KILL "$timer_pid" 2>/dev/null || true
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
  # stop_watchdog trap が sleep を即 KILL するので、ここでは TERM を送って
  # サブシェルを抜けさせ、wait で回収するだけにする。
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
  # wrapperが現在所有するPIDだけを参照し、watchdog側で古いPIDを保持しない。
  for_each_child_pid kill -s KILL
}
trap force_child_after_grace ALRM

# 受信したシグナルを現在の子プロセスへ実際に転送する。1回目は対象シグナルを
# 送って猶予期間だけ待ち、2回目以降（再度Ctrl-C等）はためらわず強制killする。
# mobile||desktop 並列中は両方へ同じシグナルを送る。
deliver_signal() {
  if ! has_active_children; then
    return
  fi
  if [ "$signal_count" -gt 1 ]; then
    # 再入力後は復元中でも待機を打ち切り、孤児を残さず回収へ進める。
    for_each_child_pid kill -s KILL
  elif [ "$cleanup_started" -eq 1 ]; then
    # 初回signalでは復元を中断せず、grace期限まで正常完了を待つ。
    start_watchdog
  else
    for_each_child_pid kill -s "$active_signal"
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
  if has_active_children; then
    deliver_signal
  else
    signal_pending=1
  fi
}
trap 'record_signal HUP 129' HUP
trap 'record_signal INT 130' INT
trap 'record_signal TERM 143' TERM

# 1 PID の終了を、シグナル割り込みで wait が壊れても回収できるまで待つ。
# 終了コードを stdout ではなく return で返す（ログ汚染を避ける）。
wait_registered_pid() {
  wait_target=$1
  wait_status=0
  while :; do
    if wait "$wait_target"; then
      wait_status=0
      break
    else
      wait_status=$?
    fi
    if kill -0 "$wait_target" 2>/dev/null; then
      continue
    fi
    break
  done
  return "$wait_status"
}

# コマンドをバックグラウンドで起動し、終了(またはシグナルによる中断)まで
# 待つ共通ヘルパー。cleanupフェーズ以外で既に中断が確定していれば
# 新規コマンドを起動せず即座に失敗を返す。
run_child() {
  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi
  # fork直後にtrapが動いても、PID公開後に保留signalを配送する。
  # 直列経路は child_pid のみ（child_pids は空のまま）で従来のシグナル契約を維持する。
  launch_in_progress=1
  "$@" &
  child_pid=$!
  child_pids=
  launch_in_progress=0
  if [ "$signal_pending" -eq 1 ]; then
    signal_pending=0
    deliver_signal
  fi
  if [ "$cleanup_started" -eq 1 ] && [ "$termination_status" -ne 0 ] && [ -z "$watchdog_pid" ]; then
    # cleanupの子が切り替わっても、記録済みsignalのgrace期限を各子へ適用する。
    start_watchdog
  fi
  wait_registered_pid "$child_pid"
  child_status=$?
  clear_child_pids
  cancel_watchdog
  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi
  return "$child_status"
}

# E2E用コンテナをkill・削除し、ローカルでは通常の開発スタック(auth/app)を
# force-recreateで復元する。CI=true では GHA / ci.sh が直後に down --volumes
# するため restore を省略し壁時計を短縮する。成否に関わらず必要なステップを
# 実行し、最初に発生した失敗のステータスを返す。
cleanup() {
  original_status=$1
  cleanup_started=1
  kill_status=0
  removal_status=0
  restore_status=0
  privacy_status=0
  # Playwright 終了後・app 再作成前に Function ログを host へ書き出す（Plan 6 Task 6）。
  # docker compose down はしないが、force-recreate 前に取らないとログが消える。
  function_log_path=${KONDATE_E2E_FUNCTION_LOG:-$repo_root/.e2e-function.log}
  if docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" logs --no-color app >"$function_log_path" 2>/dev/null; then
    :
  else
    # ログ取得失敗は空ファイルとして後段 assert に任せる
    : >"$function_log_path" || true
  fi
  if [ "${KONDATE_ASSERT_PRIVACY_LOGS:-}" = "1" ]; then
    if run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
      -f "$repo_root/compose.yaml" run --rm --no-deps \
      app node scripts/assert-privacy-logs.mjs .e2e-function.log; then
      :
    else
      privacy_status=$?
    fi
  fi
  if [ "$original_status" -ne 0 ] || [ "$termination_status" -ne 0 ]; then
    # run --rmが正常終了した場合はE2Eコンテナも既に削除済みであるため、
    # kill/rmの対象なしを失敗として扱わない。一方、失敗・中断時は残存した
    # コンテナを確実に回収するため、従来どおり強制cleanupを実行する。
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
  fi
  # ローカル: 開発継続のため通常構成へ force-recreate 復元。
  # CI: runner / ci.sh が直後に volumes ごと落とすので restore の --wait を省略。
  if [ "${CI:-}" = "true" ]; then
    :
  elif run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
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
  elif [ "$privacy_status" -ne 0 ]; then
    original_status=$privacy_status
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
  # rmdir 前に pid を消す（途中 kill されても空 dir として stale 回収できる）
  rm -f "$lock_pid_file" 2>/dev/null || true
  if rmdir "$lock_dir"; then
    lock_acquired=0
    return 0
  else
    return $?
  fi
}

# mkdir ディレクトリロックを取得する。失敗時は holder pid の死活を見て stale なら回収して再取得。
# 生存中 holder や回収不能な状態は 1 を返し、呼び出し側が fail-closed する。
try_acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    # 取得直後に自身の pid を記録（再取得競合は mkdir の原子性で排除）
    printf '%s\n' "$$" >"$lock_pid_file"
    lock_acquired=1
    return 0
  fi

  holder_pid=
  if [ -f "$lock_pid_file" ]; then
    holder_pid=$(cat "$lock_pid_file" 2>/dev/null || true)
  fi

  if [ -n "$holder_pid" ] && printf '%s\n' "$holder_pid" | grep -Eq '^[1-9][0-9]*$'; then
    if kill -0 "$holder_pid" 2>/dev/null; then
      # holder 生存 → 本物の多重起動
      return 1
    fi
    # holder 死亡 → stale ロックを回収して再取得を試みる
    echo "removing stale E2E lock (dead pid $holder_pid): $lock_dir" >&2
  else
    # pid 無し・不正・旧形式。空 dir なら回収（中身があると rmdir 失敗 → fail-closed）
    echo "removing stale E2E lock (missing or invalid pid): $lock_dir" >&2
  fi
  rm -f "$lock_pid_file" 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || true

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$lock_pid_file"
    lock_acquired=1
    return 0
  fi
  return 1
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

if try_acquire_lock; then
  :
else
  trap - EXIT
  echo "another E2E run is active: $lock_dir" >&2
  exit 1
fi

# Playwright e2e コンテナを1回起動する（引数はそのまま playwright test へ渡す）。
# 呼び出し側の環境変数 KONDATE_E2E_OUTPUT_DIR / KONDATE_E2E_HTML_REPORT を
# compose が e2e サービスへ渡す（成果物ディレクトリ分離用。CLI 引数は変えない）。
run_playwright() {
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    run --rm --no-deps e2e "$@"
}

# full 本体: mobile と desktop を同一 wrapper 内で並列起動する（案 B）。
# どちらかが先に落ちても他方は最後まで走らせ、診断用の失敗一覧を揃える。
# 終了コードは従来どおり mobile 非 0 を優先し、次に desktop を返す。
run_playwright_mobile_desktop_parallel() {
  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi

  launch_in_progress=1
  # 成果物を project ごとに分離（並列時の test-results / html report 競合を防ぐ）。
  # compose.yaml の e2e.environment がホスト env を補間してコンテナへ渡す。
  KONDATE_E2E_OUTPUT_DIR=test-results/mobile-chromium \
    KONDATE_E2E_HTML_REPORT=playwright-report/mobile-chromium \
    docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    run --rm --no-deps e2e --project=mobile-chromium "$@" &
  mobile_pid=$!

  KONDATE_E2E_OUTPUT_DIR=test-results/desktop-chromium \
    KONDATE_E2E_HTML_REPORT=playwright-report/desktop-chromium \
    docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
    run --rm --no-deps e2e --project=desktop-chromium "$@" &
  desktop_pid=$!

  child_pids="$mobile_pid $desktop_pid"
  child_pid=$mobile_pid
  launch_in_progress=0

  if [ "$signal_pending" -eq 1 ]; then
    signal_pending=0
    deliver_signal
  fi

  mobile_status=0
  desktop_status=0
  wait_registered_pid "$mobile_pid" || mobile_status=$?
  # mobile 終了後は desktop だけを所有 PID としてシグナル配送対象にする
  child_pids=$desktop_pid
  child_pid=$desktop_pid
  wait_registered_pid "$desktop_pid" || desktop_status=$?
  clear_child_pids
  cancel_watchdog

  if [ "$termination_status" -ne 0 ] && [ "$cleanup_started" -eq 0 ]; then
    return "$termination_status"
  fi
  if [ "$mobile_status" -ne 0 ]; then
    return "$mobile_status"
  fi
  if [ "$desktop_status" -ne 0 ]; then
    return "$desktop_status"
  fi
  return 0
}

# 呼び出し側が --project を既に指定しているか（単一プロジェクト実行の制御用）。
e2e_args_have_project() {
  for arg in "$@"; do
    case "$arg" in
      --project | --project=*)
        return 0
        ;;
    esac
  done
  return 1
}

# 呼び出し側が --grep / -g を既に指定しているか（smoke 時の二重付与防止用）。
e2e_args_have_grep() {
  for arg in "$@"; do
    case "$arg" in
      --grep | --grep=* | -g)
        return 0
        ;;
    esac
  done
  return 1
}

# --project が setup のみか（デバッグ用の単独実行。二重 setup を避ける）。
# --project=setup / --project setup の両方を扱い、他 project が混在すれば false。
e2e_args_only_setup_project() {
  saw_project=0
  pending_value=0
  for arg in "$@"; do
    if [ "$pending_value" -eq 1 ]; then
      pending_value=0
      saw_project=1
      if [ "$arg" != "setup" ]; then
        return 1
      fi
      continue
    fi
    case "$arg" in
      --project=setup)
        saw_project=1
        ;;
      --project=*)
        return 1
        ;;
      --project)
        pending_value=1
        ;;
    esac
  done
  if [ "$pending_value" -eq 1 ]; then
    # --project の値が欠落している場合は「setup のみ」とみなさない
    return 1
  fi
  if [ "$saw_project" -eq 1 ]; then
    return 0
  fi
  return 1
}

# 通常の開発スタックを起動したうえで、E2E専用プロファイルのauthを追加起動し、
# openrouter-mock/kong/oauth-mock/appをE2E向け設定で強制再作成してから、
# 実際のPlaywrightテストランナー(e2e)を実行する。
# KONDATE_E2E_SKIP_RECREATE=1 のときは force-recreate を飛ばす（開発反復のみ）。
run_e2e_commands() {
  # 慣習的な `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts` の先頭 `--` は
  # docker compose / playwright に渡すとフィルタが効かないことがあるため捨てる。
  # Playwright 自身のオプション終端としては使わない（パスは位置引数で渡す）。
  if [ "${1-}" = "--" ]; then
    shift
  fi
  run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.yaml" up -d --wait || return $?
  if [ "${KONDATE_E2E_SKIP_RECREATE:-}" = "1" ]; then
    # 開発反復用: 既存コンテナを E2E override で up するだけ（rate-limit や
    # 古い env が残るリスクあり。CI では同時指定を入口で拒否済み）。
    run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
      -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
      up -d --wait auth || return $?
  else
    # auth は rate-limit カウンタをプロセス内に持つため、E2E 開始時に強制再作成する。
    # compose.e2e.yaml のメール送信上限も合わせて効かせる。
    run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
      -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
      up -d --wait --force-recreate auth || return $?
  fi
  # アプリ全体で共有するAI日次枠はJST日付単位でDBに積み上がる。
  # E2E は compose.e2e で GLOBAL_DAILY_AI_LIMIT=500（製品 compose は 20 のまま）。
  # 同一日の再実行と mobile+desktop 二段の累積に備え、共有枠だけを初期化する
  # （上限値そのものは変更しない。ユーザ単位枠はテストごと新規ユーザで独立）。
  run_child "$script_dir/reset-e2e-ai-quota.sh" || return $?
  if [ "${KONDATE_E2E_SKIP_RECREATE:-}" = "1" ]; then
    run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
      -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
      up -d --wait --no-deps openrouter-mock kong oauth-mock app || return $?
  else
    run_child docker compose --project-directory "$repo_root" --project-name "$project_name" \
      -f "$repo_root/compose.yaml" -f "$repo_root/compose.e2e.yaml" --profile e2e \
      up -d --wait --force-recreate --no-deps openrouter-mock kong oauth-mock app || return $?
  fi

  # KONDATE_E2E_SUITE=full|smoke（未設定は full）。smoke は mobile 1 段のみで
  # @smoke タグに絞り、project 境界の quota reset と desktop 段を踏まない。
  suite=${KONDATE_E2E_SUITE:-full}
  case "$suite" in
    full | smoke) ;;
    *)
      echo "KONDATE_E2E_SUITE must be full or smoke" >&2
      return 2
      ;;
  esac

  # Spec §6.3: Playwright dependencies は使わず、shell が setup を 1 回だけ走らせる。
  # --project=setup のみのデバッグ実行では二重起動しない。
  if e2e_args_only_setup_project "$@"; then
    run_playwright "$@" || return $?
    return 0
  fi

  if [ "$suite" = "smoke" ]; then
    # smoke に reused storageState 利用者が居ない間は setup を省略する
    # （現状 @smoke は billing-plus を含まない。reused を smoke に載せたら setup を戻す）。
    # 1 段のみ。desktop 段・project 境界 reset なし（開始時 reset は済）。
    if ! e2e_args_have_project "$@"; then
      set -- --project=mobile-chromium "$@"
    fi
    if ! e2e_args_have_grep "$@"; then
      set -- "$@" --grep=@smoke
    fi
    run_playwright "$@" || return $?
    return 0
  fi

  # full: storageState（reusedCompletedPage）のため setup を 1 回走らせてから本体へ。
  run_playwright --project=setup || return $?

  # full: 呼び出し側が --project を指定していれば setup 後にそのまま1回実行する。
  # 未指定では mobile || desktop を並列起動する（案 B）。
  # AI 共有枠は開始時 reset + compose.e2e GLOBAL_DAILY=500 のみ（中間 reset なし）。
  # auth メール枠は compose.e2e の上限引き上げと開始時 force-recreate で賄う。
  if e2e_args_have_project "$@"; then
    run_playwright "$@" || return $?
  else
    run_playwright_mobile_desktop_parallel "$@" || return $?
  fi
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
