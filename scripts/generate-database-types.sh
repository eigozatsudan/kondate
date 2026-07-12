#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f .env ]]; then
  echo "Run ./scripts/generate-local-secrets.sh first" >&2
  exit 1
fi
set -a
source .env
set +a
: "${LOCAL_DB_URL:?LOCAL_DB_URL is required}"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
npx supabase gen types typescript --db-url "$LOCAL_DB_URL" --schema public,private > "$tmp_file"
mv "$tmp_file" src/shared/types/database.generated.ts
trap - EXIT
echo "Generated src/shared/types/database.generated.ts"
