#!/bin/sh
# 絶対パスのリポジトリルートから、決定的（同じチェックアウトなら常に同じ）な
# Docker Compose プロジェクト名を導出して標準出力へ書き出す。
# 同一マシン上に複数チェックアウト（worktree等）があってもCompose
# プロジェクト名が衝突しないよう、パスのSHA-256ダイジェストを使う。
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: compose-project-name.sh <absolute-repository-root>" >&2
  exit 2
fi

repo_root=$1
case "$repo_root" in
  /*) ;;
  *)
    echo "repository root must be absolute" >&2
    exit 2
    ;;
esac

if [ ! -d "$repo_root" ]; then
  echo "repository root must be a directory" >&2
  exit 2
fi

# シンボリックリンクなどの表記ゆれを吸収し、同じ実体パスなら同じ名前になるようにする。
repo_root=$(CDPATH= cd -P "$repo_root" && pwd) || {
  echo "repository root could not be canonicalized" >&2
  exit 2
}

if ! command -v sha256sum > /dev/null 2>&1; then
  echo "sha256sum is required to derive the Compose project name" >&2
  exit 2
fi

# 正規化済みパスのSHA-256を取り、"kondate-<32桁hex>" の形式に切り詰める。
hash_output=$(printf '%s' "$repo_root" | sha256sum) || {
  echo "sha256sum failed to derive the Compose project name" >&2
  exit 2
}
set -- $hash_output
if [ "$#" -ne 2 ]; then
  echo "sha256sum returned an invalid result" >&2
  exit 2
fi
digest=$1
if [ "$2" != "-" ] || ! printf '%s\n' "$digest" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "sha256sum returned an invalid result" >&2
  exit 2
fi

project_name=$(printf 'kondate-%.32s' "$digest")
if ! printf '%s\n' "$project_name" | grep -Eq '^kondate-[0-9a-f]{32}$'; then
  echo "derived Compose project name is invalid" >&2
  exit 2
fi

printf '%s\n' "$project_name"
