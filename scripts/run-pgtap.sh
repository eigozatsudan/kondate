#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ "$#" -eq 0 ]]; then
  set -- /workspace/supabase/tests/database/*.test.sql
else
  requested=()
  for file in "$@"; do
    requested+=("/workspace/${file#/workspace/}")
  done
  set -- "${requested[@]}"
fi
pg_prove --failures --dbname "$DATABASE_URL" "$@"
