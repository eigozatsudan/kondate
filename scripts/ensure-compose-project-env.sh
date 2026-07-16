#!/bin/sh
# リポジトリの .env に KONDATE_COMPOSE_PROJECT_NAME を記録・検証する。
# 未記入なら追記し、既に記入済みなら compose-project-name.sh が導出した
# 値と一致するか確認する。これにより .env を他のチェックアウトからコピーして
# きた場合など、Composeプロジェクトの取り違えを検出できる。
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: ensure-compose-project-env.sh <repository-root> <project-name>" >&2
  exit 2
fi

repo_root=$1
project_name=$2
case "$repo_root" in
  /*) ;;
  *)
    echo "repository root must be absolute" >&2
    exit 2
    ;;
esac
if ! printf '%s\n' "$project_name" | grep -Eq '^kondate-[0-9a-f]{32}$'; then
  echo "Compose project name is invalid" >&2
  exit 2
fi

env_file="$repo_root/.env"
if [ ! -f "$env_file" ]; then
  echo ".env does not exist; run ./scripts/generate-local-secrets.sh first" >&2
  exit 2
fi

entry_count=$(grep -c '^KONDATE_COMPOSE_PROJECT_NAME=' "$env_file" || true)
if [ "$entry_count" -gt 1 ]; then
  echo ".env contains duplicate Compose project identities" >&2
  exit 2
fi
if [ "$entry_count" -eq 1 ]; then
  # 既に記録済みなら、今回導出した値と一致するかだけ確認して終了する。
  existing=$(sed -n 's/^KONDATE_COMPOSE_PROJECT_NAME=//p' "$env_file")
  if [ "$existing" != "$project_name" ]; then
    echo ".env belongs to a different checkout; regenerate local secrets before continuing" >&2
    exit 2
  fi
  exit 0
fi

# 未記入の場合のみ、一時ファイル経由でアトミックに追記する
# （書き込み途中でのプロセス中断による .env 破損を防ぐ）。
temporary=$(mktemp "$repo_root/.env.tmp-XXXXXX")
cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT
trap 'cleanup; exit 129' HUP
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
chmod 600 "$temporary"
cat "$env_file" > "$temporary"
printf '\nKONDATE_COMPOSE_PROJECT_NAME=%s\n' "$project_name" >> "$temporary"
mv "$temporary" "$env_file"
trap - EXIT HUP INT TERM
