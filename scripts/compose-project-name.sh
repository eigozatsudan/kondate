#!/bin/sh
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

checksum=$(printf '%s' "$repo_root" | cksum)
set -- $checksum
if [ "$#" -ne 2 ]; then
  echo "cksum returned an invalid result" >&2
  exit 2
fi
case "$1:$2" in
  *[!0-9:]* | :* | *:)
    echo "cksum returned an invalid result" >&2
    exit 2
    ;;
esac

project_name="kondate-$1-$2"
if ! printf '%s\n' "$project_name" | grep -Eq '^kondate-[0-9]+-[0-9]+$'; then
  echo "derived Compose project name is invalid" >&2
  exit 2
fi

printf '%s\n' "$project_name"
