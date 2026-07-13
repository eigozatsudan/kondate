#!/bin/sh
set -eu

export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

exec docker compose -f compose.tooling.yaml run --rm local-secrets "$@"
