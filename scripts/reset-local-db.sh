#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

docker compose --project-directory "$repo_root" -f "$repo_root/compose.yaml" \
  down --volumes --remove-orphans
# 公式ComposeのPGDATAはbind mountのため、named volumeとは別に削除する。
docker compose --project-directory "$repo_root" -f "$repo_root/compose.tooling.yaml" \
  run --rm --user 0:0 --entrypoint sh vendor-supabase \
  -c 'rm -rf /workspace/infra/supabase/volumes/db/data'
docker compose --project-directory "$repo_root" -f "$repo_root/compose.yaml" up -d --wait
