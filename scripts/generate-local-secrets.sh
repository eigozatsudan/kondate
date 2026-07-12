#!/usr/bin/env bash
set -euo pipefail
exec node scripts/generate-local-secrets.mjs "$@"
