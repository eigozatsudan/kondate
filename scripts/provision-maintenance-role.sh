#!/usr/bin/env bash
# ローカル/CI 用: kondate_maintenance_login を Compose 内 psql で用意する。
# パスワードは argv に載せず、環境 / .env から読み取り stdin 経由で渡す。
# マイグレーションには LOGIN を含めない（NOLOGIN executor のみ）。
set -euo pipefail
# xtrace は有効化しない（パスワードがトレースに出る）

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
project_name=$("$script_dir/compose-project-name.sh" "$repo_root")

# .env から必要キーだけを読む（JSON クォート対応）。source は使わない。
read_env_value() {
  key=$1
  line=$(grep -E "^${key}=" "$repo_root/.env" 2>/dev/null | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    printf ''
    return
  fi
  value=${line#${key}=}
  case "$value" in
    \"*\")
      # generate-local-secrets が JSON.stringify した値
      value=${value#\"}
      value=${value%\"}
      value=${value//\\\"/\"}
      value=${value//\\\\/\\}
      ;;
  esac
  printf '%s' "$value"
}

if [[ -z "${MAINTENANCE_DB_PASSWORD:-}" && -f "$repo_root/.env" ]]; then
  MAINTENANCE_DB_PASSWORD=$(read_env_value MAINTENANCE_DB_PASSWORD)
fi
if [[ -z "${POSTGRES_PASSWORD:-}" && -f "$repo_root/.env" ]]; then
  POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
fi

if [[ -z "${MAINTENANCE_DB_PASSWORD:-}" ]]; then
  echo "provision-maintenance-role: password_missing" >&2
  exit 1
fi

# パスワードを SQL リテラルとして安全にクォート（単一引用符を二重化）
sql_password=${MAINTENANCE_DB_PASSWORD//\'/\'\'}

# パスワード本体は stdin の SQL にのみ載せ、docker/psql の argv には載せない
sql=$(cat <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_maintenance_login') then
    execute format(
      'create role kondate_maintenance_login login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2',
      '${sql_password}'
    );
  else
    execute format(
      'alter role kondate_maintenance_login with login password %L noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2',
      '${sql_password}'
    );
  end if;
end
\$\$;
grant kondate_maintenance_executor to kondate_maintenance_login;
alter role kondate_maintenance_login set statement_timeout = '20s';
SQL
)

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

# -e PGPASSWORD はホスト環境から値をコンテナへ渡す（値を argv に並べない）
if ! printf '%s\n' "$sql" | docker compose --project-directory "$repo_root" \
  --project-name "$project_name" exec -T -e PGPASSWORD db \
  psql --no-psqlrc -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null; then
  unset MAINTENANCE_DB_PASSWORD POSTGRES_PASSWORD PGPASSWORD sql_password sql
  echo "provision-maintenance-role: failed" >&2
  exit 1
fi

unset MAINTENANCE_DB_PASSWORD POSTGRES_PASSWORD PGPASSWORD sql_password sql
echo "provision-maintenance-role: ok"
