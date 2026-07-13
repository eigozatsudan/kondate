#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
docker compose -f compose.yaml up -d --wait
docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e up -d --wait auth
docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e \
  up -d --wait --force-recreate --no-deps kong oauth-mock app
exec docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e \
  run --rm --no-deps e2e "$@"
