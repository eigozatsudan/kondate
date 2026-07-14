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

repo_root=$(CDPATH= cd -P "$repo_root" && pwd) || {
  echo "repository root could not be canonicalized" >&2
  exit 2
}

if ! command -v sha256sum > /dev/null 2>&1; then
  echo "sha256sum is required to derive the Compose project name" >&2
  exit 2
fi

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
