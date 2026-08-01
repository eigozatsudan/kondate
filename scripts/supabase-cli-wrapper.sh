#!/bin/sh
# profile deploy の supabase-cli 用薄いラッパ。
#
# 背景:
# - compose は .deploy.env を env_file で注入するため、コンテナ内には
#   SUPABASE_DB_URL が入る。
# - しかし supabase CLI 自体は env を見ず、--db-url / --linked / --local が必要。
# - ホストで --db-url "$SUPABASE_DB_URL" と書くと、ホスト未 export 時に空 URL になる
#   （docs の「Unix ソケット / 空 URL」トラブルと同じ）。
# - 明示フラグが無い db push / migration list だけ、コンテナ env から --db-url を足す。
# - 明示の --db-url / --linked / --local があるときは上書きしない。
# - db reset 等の破壊的コマンドには注入しない（誤って本番 URL へ向かわない）。
set -eu

has_db_target=0
prev=""
for arg in "$@"; do
  case "$arg" in
    --db-url | --linked | --local)
      has_db_target=1
      break
      ;;
    --db-url=*)
      has_db_target=1
      break
      ;;
  esac
  if [ "$prev" = "--db-url" ]; then
    has_db_target=1
    break
  fi
  prev=$arg
done

should_inject=0
if [ "$has_db_target" -eq 0 ]; then
  case "${1:-}:${2:-}" in
    db:push | migration:list)
      should_inject=1
      ;;
  esac
fi

if [ "$should_inject" -eq 1 ]; then
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "supabase-cli-wrapper: SUPABASE_DB_URL が未設定です。" >&2
    echo "  .deploy.env に Session pooler 等の接続 URL を書くか、" >&2
    echo "  --db-url / --linked / --local を明示してください。" >&2
    exit 1
  fi
  exec npx supabase "$@" --db-url "$SUPABASE_DB_URL"
fi

exec npx supabase "$@"
