#!/bin/sh
# ホストのgitをコンテナ内では使わず、vendor-supabaseツーリングイメージに
# 積まれたgitをComposeコンテナ経由で実行する薄いラッパー。カレントの
# リポジトリがlinked worktreeの場合、gitfileが指すcommon dirを
# コンテナ内にも同じ絶対パスでマウントし、worktree特有のgit操作
# （commondirを参照するもの等）が動くようにする。
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd -P)
project_name=$("$script_dir/compose-project-name.sh" "$repo_root")
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

# base相対 or 絶対の値を、実在パスとして正規化(realpath化)して返す。
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
if [ -f "$repo_root/.git" ]; then
  # linked worktreeのgitfileが参照するcommon dirをコンテナにも同じ絶対パスで公開する。
  git_dir_value=$(sed -n '1s/^gitdir: //p' "$repo_root/.git")
  if [ -z "$git_dir_value" ]; then
    echo "Invalid Git gitfile: $repo_root/.git" >&2
    exit 1
  fi
  git_dir=$(resolve_directory "$repo_root" "$git_dir_value")
  mount_dir=$git_dir
  if [ -f "$git_dir/commondir" ]; then
    common_dir_value=$(sed -n '1p' "$git_dir/commondir")
    mount_dir=$(resolve_directory "$git_dir" "$common_dir_value")
  fi
fi

cd "$repo_root"
if [ -n "$mount_dir" ]; then
  exec docker compose --project-directory "$repo_root" --project-name "$project_name" \
    -f "$repo_root/compose.tooling.yaml" run --rm \
    --volume "$mount_dir:$mount_dir" \
    --entrypoint git vendor-supabase "$@"
fi

exec docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.tooling.yaml" run --rm \
  --entrypoint git vendor-supabase "$@"
