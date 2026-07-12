#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${LOCAL_DB_URL:-}" ]]; then
  if [[ ! -f .env ]]; then
    echo "Run ./scripts/generate-local-secrets.sh first" >&2
    exit 1
  fi
  # Compose内では、コンテナ間接続用の環境変数をローカル向け.envで上書きしない。
  set -a
  source .env
  set +a
fi
: "${LOCAL_DB_URL:?LOCAL_DB_URL is required}"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
npx supabase gen types typescript --db-url "$LOCAL_DB_URL" --schema public,private > "$tmp_file"
mv "$tmp_file" src/shared/types/database.generated.ts
trap - EXIT
echo "Generated src/shared/types/database.generated.ts"
