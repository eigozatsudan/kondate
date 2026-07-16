#!/usr/bin/env bash
# /workspace/supabase/migrations/*.sql を、まだ適用されていないものだけ順番に
# DATABASE_URL のデータベースへ適用する。適用履歴は
# supabase_migrations.schema_migrations テーブルで管理し、1ファイルにつき
# 1トランザクションでSQL本体と履歴INSERTをまとめて実行する。
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"

# 履歴テーブルが無ければ作成する（初回実行時向け）。
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[] not null default '{}',
  name text
);
SQL

shopt -s nullglob
for file in /workspace/supabase/migrations/*.sql; do
  # ファイル名は "<version>_<name>.sql" 形式を前提にversion/nameを取り出す。
  filename="$(basename "$file")"
  version="${filename%%_*}"
  name="${filename#*_}"
  name="${name%.sql}"
  # 既に履歴テーブルにversionがあれば適用済みなのでスキップする。
  applied="$(psql "$DATABASE_URL" --tuples-only --no-align --command "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi
  # マイグレーション本体と履歴INSERTを1トランザクションにまとめ、
  # 途中失敗時に部分適用のまま残らないようにする。
  {
    echo "begin;"
    cat "$file"
    printf "\ninsert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s');\n" "$version" "$name"
    echo "commit;"
  } | psql "$DATABASE_URL" --set ON_ERROR_STOP=1
done
