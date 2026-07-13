#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
base=(docker compose -f compose.yaml)
compose=(docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e)

"${base[@]}" up -d --wait
"${compose[@]}" up -d --wait auth
"${compose[@]}" up -d --wait --force-recreate --no-deps kong oauth-mock app
exec "${compose[@]}" run --rm --no-deps e2e "$@"
