#!/usr/bin/env bash
# 指定したヘルスチェックURL（既定はKong経由のauthヘルスエンドポイント）に
# 1秒間隔で最大60回ポーリングし、Supabaseスタックの起動完了を待つ。
set -euo pipefail
url="${1:-http://kong:8000/auth/v1/health}"
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$url" >/dev/null; then
    echo "Supabase is ready"
    exit 0
  fi
  sleep 1
done
echo "Supabase did not become ready within 60 seconds" >&2
exit 1
