#!/usr/bin/env bash
# ローカル/CI 用: kondate_ops_readonly を LOGIN 化しパスワードを設定する。
# migration は NOLOGIN + GRANT のみ。本番は docs/deployment/supabase.md の手順。
# パスワードは argv に載せず、環境 / .env から読み取り stdin 経由で渡す。
set -euo pipefail
# xtrace は有効化しない（パスワードがトレースに出る）

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
project_name=$("$script_dir/compose-project-name.sh" "$repo_root")

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
      value=${value#\"}
      value=${value%\"}
      value=${value//\\\"/\"}
      value=${value//\\\\/\\}
      ;;
  esac
  printf '%s' "$value"
}

if [[ -z "${OPS_READONLY_DB_PASSWORD:-}" && -f "$repo_root/.env" ]]; then
  OPS_READONLY_DB_PASSWORD=$(read_env_value OPS_READONLY_DB_PASSWORD)
fi
if [[ -z "${POSTGRES_PASSWORD:-}" && -f "$repo_root/.env" ]]; then
  POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
fi

if [[ -z "${OPS_READONLY_DB_PASSWORD:-}" ]]; then
  echo "provision-ops-readonly-role: password_missing" >&2
  exit 1
fi

sql_password=${OPS_READONLY_DB_PASSWORD//\'/\'\'}

sql=$(cat <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_ops_readonly') then
    raise exception 'kondate_ops_readonly missing; apply migrations first';
  end if;
end
\$\$;
alter role kondate_ops_readonly with login password '${sql_password}'
  noinherit
  nocreatedb
  nocreaterole
  noreplication
  connection limit 4;
alter role kondate_ops_readonly set statement_timeout = '15s';
alter role kondate_ops_readonly set default_transaction_read_only = on;
SQL
)

export PGPASSWORD="${POSTGRES_PASSWORD:-}"

if ! printf '%s\n' "$sql" | docker compose --project-directory "$repo_root" \
  --project-name "$project_name" exec -T -e PGPASSWORD db \
  psql --no-psqlrc -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null; then
  unset OPS_READONLY_DB_PASSWORD POSTGRES_PASSWORD PGPASSWORD sql_password sql
  echo "provision-ops-readonly-role: failed" >&2
  exit 1
fi

unset OPS_READONLY_DB_PASSWORD POSTGRES_PASSWORD PGPASSWORD sql_password sql
echo "provision-ops-readonly-role: ok"
