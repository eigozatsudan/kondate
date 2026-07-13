#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
exec docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e "$@"
