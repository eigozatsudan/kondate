#!/bin/sh
# 公式 supabase/supabase リポジトリの docker/ ディレクトリを infra/supabase に
# ベンダリング（取り込み）する。infra/supabase が既に存在する場合は
# --refresh を渡さない限り失敗する（誤って上書きしないため）。
#
# 処理はステージング領域(staging)に一旦全て準備してから、既存の
# infra/supabase・infra/supabase.version を退避(backup)しつつ新しい内容を
# 設置(install)する。途中で失敗した場合はfinish()が退避物から元の状態への
# ロールバックを試み、それでも安全に戻せない場合はstagingを残して
# エラーメッセージで手動対応を促す（rollback_conflict/preserve_staging）。
# stat の inode/デバイス番号("%d:%i")比較や sha256 ハッシュ比較を多用しているのは、
# mv によるファイル差し替えの前後で「想定した実体のままか」を検証し、
# 並行実行や外部からの変更を検知するため。
set -eu

repository=${SUPABASE_REPOSITORY:-https://github.com/supabase/supabase.git}
ref=${SUPABASE_REF:-refs/heads/master}
target=infra/supabase
version_file=infra/supabase.version
lock_dir=infra/.supabase-refresh.lock
data_dir=$target/volumes/db/data
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

staging=
checkout=
archive=
new_target=
new_version=
backup_target=
backup_version=
quarantine_target=
quarantine_version=
lock_acquired=false
target_existed=false
version_existed=false
target_identity=
version_identity=
version_hash=
target_installed_identity=
version_installed_identity=
version_installed_hash=
target_backed_up=false
version_backed_up=false
target_installed=false
version_installed=false
operation_completed=false
preserve_staging=false
rollback_conflict=false
pending_signal_status=0

# PGDATA配下のpostmaster.pidがあればDBが稼働中とみなし中断する
# （稼働中のデータディレクトリをベンダー更新で壊さないため）。
verify_database_stopped() {
  if [ -e "$data_dir/postmaster.pid" ]; then
    echo "database appears to be running; use scripts/refresh-supabase.sh" >&2
    exit 1
  fi
  if [ -d "$data_dir" ] && { [ ! -r "$data_dir" ] || [ ! -x "$data_dir" ]; }; then
    echo "cannot verify database state; run vendor refresh as root" >&2
    exit 1
  fi
}

# 通常運用時のシグナルトラップ: そのまま該当exitコードで終了する。
restore_signal_traps() {
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# mv等の一瞬だけ中断されると困る操作の直前に使う: シグナルを即exitに
# 変換せず、pending_signal_statusに記録して後で処理する。
defer_signal_traps() {
  pending_signal_status=0
  trap 'pending_signal_status=129' HUP
  trap 'pending_signal_status=130' INT
  trap 'pending_signal_status=143' TERM
}

# パスの実体（デバイス番号+inode）が期待値と一致するかを確認する。
# mvの前後で「他プロセスに差し替えられていないか」を検出するために使う。
path_identity_matches() {
  path=$1
  expected_identity=$2
  [ -n "$expected_identity" ] || return 1
  actual_identity=$(stat -c '%d:%i' "$path" 2>/dev/null) || return 1
  [ "$actual_identity" = "$expected_identity" ]
}

# ファイルのSHA-256ハッシュ値を求める。version_state_matchesで、
# infra/supabase.version の中身が変わっていないかの検証に使う。
hash_file() {
  hash_path=$1
  hash_line=$(sha256sum "$hash_path" 2>/dev/null) || return 1
  hash_value=$(printf '%s\n' "$hash_line" | awk '{print $1}')
  printf '%s\n' "$hash_value" | grep -Eq '^[0-9a-f]{64}$' || return 1
  printf '%s\n' "$hash_value"
}

# infra/supabase.version は実体(inode)だけでなく中身も1バイトのバージョン
# 文字列なので、identity一致に加えてハッシュも一致することを確認する。
version_state_matches() {
  path=$1
  expected_identity=$2
  expected_hash=$3
  path_identity_matches "$path" "$expected_identity" || return 1
  actual_hash=$(hash_file "$path") || return 1
  [ "$actual_hash" = "$expected_hash" ]
}

# EXIT trap: operation_completedがfalseのまま終了した場合、退避しておいた
# 旧infra/supabase・infra/supabase.versionを可能な限り元の場所へ戻す。
# 各段階でidentity/ハッシュを再検証し、想定外の状態変化を検知したら
# rollback_conflictを立てstagingを残す（自動では触らず手動対応に委ねる）。
finish() {
  status=$?
  trap - EXIT
  trap '' HUP INT TERM
  if [ "$operation_completed" != true ]; then
    if [ "$target_installed" = true ]; then
      if mv -T -n "$target" "$quarantine_target" && [ ! -e "$target" ]; then
        target_installed=false
        if path_identity_matches "$quarantine_target" "$target_installed_identity"; then
          if ! rm -rf "$quarantine_target"; then
            preserve_staging=true
          fi
        else
          rollback_conflict=true
          preserve_staging=true
        fi
      else
        preserve_staging=true
      fi
    fi
    if [ "$version_installed" = true ]; then
      if mv -T -n "$version_file" "$quarantine_version" && [ ! -e "$version_file" ]; then
        version_installed=false
        if version_state_matches "$quarantine_version" "$version_installed_identity" "$version_installed_hash"; then
          if ! rm -f "$quarantine_version"; then
            preserve_staging=true
          fi
        else
          rollback_conflict=true
          preserve_staging=true
        fi
      else
        preserve_staging=true
      fi
    fi
    if [ "$target_backed_up" = true ] && [ "$target_installed" = false ]; then
      if path_identity_matches "$backup_target" "$target_identity" && [ ! -e "$target" ] &&
        mv -T -n "$backup_target" "$target"; then
        if [ ! -e "$backup_target" ]; then
          target_backed_up=false
          if ! path_identity_matches "$target" "$target_identity"; then
            rollback_conflict=true
            preserve_staging=true
          fi
        else
          preserve_staging=true
        fi
      else
        preserve_staging=true
      fi
    fi
    if [ "$version_backed_up" = true ] && [ "$version_installed" = false ]; then
      if version_state_matches "$backup_version" "$version_identity" "$version_hash" &&
        [ ! -e "$version_file" ] && mv -T -n "$backup_version" "$version_file"; then
        if [ ! -e "$backup_version" ]; then
          version_backed_up=false
          if ! version_state_matches "$version_file" "$version_identity" "$version_hash"; then
            rollback_conflict=true
            preserve_staging=true
          fi
        else
          preserve_staging=true
        fi
      else
        preserve_staging=true
      fi
    fi
    if [ "$target_backed_up" = true ] || [ "$version_backed_up" = true ]; then
      preserve_staging=true
    fi
  fi
  if [ "$preserve_staging" = true ]; then
    if [ "$target_backed_up" = true ] || [ "$version_backed_up" = true ]; then
      echo "rollback incomplete; preserved vendor backup at $staging" >&2
    elif [ "$rollback_conflict" = true ]; then
      echo "rollback verification incomplete; preserved staging at $staging" >&2
    else
      echo "rollback cleanup incomplete; preserved staging at $staging" >&2
    fi
  elif [ -n "$staging" ] && ! rm -rf "$staging"; then
    echo "vendor cleanup incomplete; preserved staging at $staging" >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  if [ "$lock_acquired" = true ]; then
    if ! rmdir "$lock_dir"; then
      echo "vendor cleanup incomplete; could not remove refresh lock: $lock_dir" >&2
      if [ "$status" -eq 0 ]; then
        status=1
      fi
    fi
  fi
  exit "$status"
}
trap finish EXIT
restore_signal_traps

verify_database_stopped
defer_signal_traps
lock_created=false
if mkdir "$lock_dir"; then
  lock_acquired=true
  lock_created=true
fi
restore_signal_traps
if [ "$pending_signal_status" -ne 0 ]; then
  exit "$pending_signal_status"
fi
if [ "$lock_created" != true ]; then
  echo "another Supabase vendor refresh is active: $lock_dir" >&2
  exit 1
fi

if [ -e "$target" ]; then
  target_existed=true
  target_identity=$(stat -c '%d:%i' "$target")
fi
if [ -e "$version_file" ]; then
  version_existed=true
  version_identity=$(stat -c '%d:%i' "$version_file")
  if ! version_hash=$(hash_file "$version_file"); then
    echo "cannot verify vendor version state: $version_file" >&2
    exit 1
  fi
fi

# ここから先はすべてstaging配下で準備し、既存のinfra/supabaseや
# infra/supabase.versionへは検証済みの最終段階でしか触れない。
staging=$(mktemp -d "$(pwd)/infra/.supabase-refresh.XXXXXX")
checkout="$staging/repository"
archive="$staging/docker.tar"
new_target="$staging/supabase"
new_version="$staging/supabase.version"
backup_target="$staging/backup-target"
backup_version="$staging/backup-version"
quarantine_target="$staging/quarantine-installed-target"
quarantine_version="$staging/quarantine-installed-version"

# shallow fetchで対象refのみ取得し、解決済みSHAを記録する
# （infra/supabase.versionに書き込み、取り込み元コミットを追跡可能にする）。
git -C "$staging" init -q repository
git -C "$checkout" remote add origin "$repository"
git -C "$checkout" fetch -q --depth 1 origin "$ref"
resolved_sha=$(git -C "$checkout" rev-parse FETCH_HEAD)
printf '%s\n' "$resolved_sha" | grep -Eq '^[0-9a-f]{40}$'

# 取り込むのはリポジトリ全体ではなく docker/ ディレクトリのみ。
git -C "$checkout" archive --format=tar --output="$archive" FETCH_HEAD:docker
mkdir -p "$new_target"
tar -xf "$archive" -C "$new_target"

# docker-compose.yml の services.db.image を抽出し、想定するPostgres 17系の
# タグと一致するか後段で検証する（意図しないメジャーバージョン混入を防ぐ）。
db_images=$(awk '
  /^services:[[:space:]]*(#.*)?$/ { in_services = 1; next }
  in_services && /^[^[:space:]]/ { in_services = 0; in_db = 0 }
  in_services && /^  db:[[:space:]]*(#.*)?$/ { in_db = 1; next }
  in_services && in_db && /^  [^[:space:]][^:]*:[[:space:]]*(#.*)?$/ { in_db = 0 }
  in_services && in_db && /^    image:[[:space:]]*/ {
    value = $0
    sub(/^    image:[[:space:]]*/, "", value)
    sub(/[[:space:]]*#.*$/, "", value)
    print value
  }
' "$new_target/docker-compose.yml")
db_image_count=$(printf '%s\n' "$db_images" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$db_image_count" != "1" ]; then
  echo "official db service must define exactly one image" >&2
  exit 1
fi
if ! printf '%s\n' "$db_images" | grep -Eq '^supabase/postgres:17\.[0-9]+(\.[0-9]+)+$'; then
  echo "official db image is not a complete Postgres 17 tag: $db_images" >&2
  exit 1
fi

# このプロジェクトではPostgres 17系のみをサポートするため、pg15/移行関連の
# 補助ファイルは取り込まず削除する。
rm -f \
  "$new_target/docker-compose.pg15.yml" \
  "$new_target/docker-compose.pg17.yml" \
  "$new_target/utils/upgrade-pg17.sh" \
  "$new_target/tests/test-pg17-upgrade.sh"
printf '%s\n' "$resolved_sha" > "$new_version"
if [ "$running_as_root" = true ]; then
  chown -R "$local_uid:$local_gid" "$new_target" "$new_version"
fi

if { [ "$target_existed" = true ] && [ ! -e "$target" ]; } ||
  { [ "$target_existed" = false ] && [ -e "$target" ]; }; then
  echo "vendor target changed during refresh: $target" >&2
  exit 1
fi
if { [ "$version_existed" = true ] && [ ! -e "$version_file" ]; } ||
  { [ "$version_existed" = false ] && [ -e "$version_file" ]; }; then
  echo "vendor version changed during refresh: $version_file" >&2
  exit 1
fi

if [ "$target_existed" = true ]; then
  trap '' HUP INT TERM
  verify_database_stopped
  mv "$target" "$backup_target"
  target_backed_up=true
  if [ "$(stat -c '%d:%i' "$backup_target")" != "$target_identity" ]; then
    echo "vendor target identity changed during refresh: $target" >&2
    exit 1
  fi
  restore_signal_traps
fi
if [ "$version_existed" = true ]; then
  trap '' HUP INT TERM
  mv "$version_file" "$backup_version"
  version_backed_up=true
  if [ "$(stat -c '%d:%i' "$backup_version")" != "$version_identity" ] ||
    ! version_state_matches "$backup_version" "$version_identity" "$version_hash"; then
    echo "vendor version identity changed during refresh: $version_file" >&2
    exit 1
  fi
  restore_signal_traps
fi
if [ -e "$target" ]; then
  echo "vendor target destination appeared during refresh: $target" >&2
  exit 1
fi
trap '' HUP INT TERM
mv "$new_target" "$target"
target_installed=true
target_installed_identity=$(stat -c '%d:%i' "$target")
restore_signal_traps
if [ -e "$version_file" ]; then
  echo "vendor version destination appeared during refresh: $version_file" >&2
  exit 1
fi
trap '' HUP INT TERM
mv "$new_version" "$version_file"
version_installed=true
version_installed_identity=$(stat -c '%d:%i' "$version_file")
if ! version_installed_hash=$(hash_file "$version_file"); then
  echo "cannot verify installed vendor version state: $version_file" >&2
  exit 1
fi
operation_completed=true

echo "Vendored supabase/supabase $resolved_sha docker/"
