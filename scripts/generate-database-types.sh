#!/usr/bin/env bash
set -euo pipefail
types_url="${PG_META_TYPES_URL:-http://meta:8080/generators/typescript?included_schemas=public,private&detect_one_to_one_relationships=true}"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
# 稼働中の公式Metaサービスを使い、CLIによる入れ子のコンテナ起動を避ける。
PG_META_TYPES_URL="$types_url" node --input-type=module -e '
  const response = await fetch(process.env.PG_META_TYPES_URL);
  if (!response.ok) {
    throw new Error(`Postgres Meta type generation failed: ${response.status}`);
  }
  process.stdout.write(await response.text());
' > "$tmp_file"
mv "$tmp_file" src/shared/types/database.generated.ts
trap - EXIT
echo "Generated src/shared/types/database.generated.ts"
