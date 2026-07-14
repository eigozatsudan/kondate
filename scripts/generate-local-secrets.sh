#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
project_name=$("$script_dir/compose-project-name.sh" "$repo_root")

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"
export KONDATE_COMPOSE_PROJECT_NAME="$project_name"

exec docker compose --project-directory "$repo_root" \
  --project-name "$project_name" \
  -f "$repo_root/compose.tooling.yaml" run --rm local-secrets "$@"
