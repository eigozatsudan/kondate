#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
repo_dir=$(CDPATH= cd "$script_dir/.." && pwd -P)

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

resolve_directory() (
  base=$1
  value=$2
  case "$value" in
    /*) path=$value ;;
    *) path=$base/$value ;;
  esac
  CDPATH= cd "$path" && pwd -P
)

mount_dir=""
if [ -f "$repo_dir/.git" ]; then
  # linked worktreeのgitfileが参照するcommon dirをコンテナにも同じ絶対パスで公開する。
  git_dir_value=$(sed -n '1s/^gitdir: //p' "$repo_dir/.git")
  if [ -z "$git_dir_value" ]; then
    echo "Invalid Git gitfile: $repo_dir/.git" >&2
    exit 1
  fi
  git_dir=$(resolve_directory "$repo_dir" "$git_dir_value")
  mount_dir=$git_dir
  if [ -f "$git_dir/commondir" ]; then
    common_dir_value=$(sed -n '1p' "$git_dir/commondir")
    mount_dir=$(resolve_directory "$git_dir" "$common_dir_value")
  fi
fi

cd "$repo_dir"
if [ -n "$mount_dir" ]; then
  exec docker compose -f compose.tooling.yaml run --rm \
    --volume "$mount_dir:$mount_dir" \
    --entrypoint git vendor-supabase "$@"
fi

exec docker compose -f compose.tooling.yaml run --rm \
  --entrypoint git vendor-supabase "$@"
