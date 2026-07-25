#!/bin/sh
# app / e2e 共通エントリ。Compose は root で起動し、ここで LOCAL_UID/GID へ落とす。
#
# 背景:
# - 名前付き volume の node_modules は image の node(1000) 所有で初期化される。
# - GitHub Actions の runner は uid 1001 等になり、LOCAL_UID がその値になる。
# - Vite は設定バンドルを node_modules/.vite-temp へ書くため、非 1000 だと EACCES で即死する。
# - @netlify/edge-functions-dev は Deno を extendEnv:false で起動し DENO_DIR を引き継がない。
#   passwd に無い uid ではホームが解決できず Deno が落ち、結果として app が exit 1 になる。
# 対策: root で passwd/home と .vite-temp を整え、setpriv で LOCAL_UID へ exec する。
set -eu

uid=${LOCAL_UID:-1000}
gid=${LOCAL_GID:-1000}

case "$uid" in
  "" | *[!0-9]*)
    echo "LOCAL_UID must be numeric" >&2
    exit 1
    ;;
esac
case "$gid" in
  "" | *[!0-9]*)
    echo "LOCAL_GID must be numeric" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  if ! getent group "$gid" >/dev/null 2>&1; then
    groupadd -g "$gid" kondate
  fi
  if ! getent passwd "$uid" >/dev/null 2>&1; then
    # Deno / env-paths が getpwuid でホームを解決できるよう実ユーザーを作る
    useradd -u "$uid" -g "$gid" -d /home/kondate -m -s /bin/bash kondate
  fi

  home=$(getent passwd "$uid" | cut -d: -f6)
  if [ -z "$home" ]; then
    echo "could not resolve home for uid $uid" >&2
    exit 1
  fi
  mkdir -p "$home" /tmp/vite /workspace/node_modules/.vite-temp
  chown -R "$uid:$gid" "$home" /tmp/vite /workspace/node_modules/.vite-temp

  export HOME="$home"
  export LOCAL_UID="$uid"
  export LOCAL_GID="$gid"
  exec setpriv --reuid="$uid" --regid="$gid" --init-groups -- "$@"
fi

exec "$@"
