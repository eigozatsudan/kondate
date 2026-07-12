#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"

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
  filename="$(basename "$file")"
  version="${filename%%_*}"
  name="${filename#*_}"
  name="${name%.sql}"
  applied="$(psql "$DATABASE_URL" --tuples-only --no-align --command "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi
  {
    echo "begin;"
    cat "$file"
    printf "\ninsert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s');\n" "$version" "$name"
    echo "commit;"
  } | psql "$DATABASE_URL" --set ON_ERROR_STOP=1
done
