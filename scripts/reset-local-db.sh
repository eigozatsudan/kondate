#!/bin/sh
set -eu

docker compose down --volumes --remove-orphans
# 公式ComposeのPGDATAはbind mountのため、named volumeとは別に削除する。
docker compose -f compose.tooling.yaml run --rm --user 0:0 --entrypoint sh vendor-supabase \
  -c 'rm -rf infra/supabase/volumes/db/data'
docker compose up -d --wait
