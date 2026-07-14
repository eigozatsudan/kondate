#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/../.." && pwd)
unset COMPOSE_PROJECT_NAME KONDATE_COMPOSE_PROJECT_NAME
temporary=$(mktemp -d)
cleanup() {
  rm -rf "$temporary"
}
trap cleanup EXIT HUP INT TERM

first_root="$temporary/first/checkout"
second_root="$temporary/second/checkout"
mkdir -p "$first_root" "$second_root"
ln -s "$repo_root/infra" "$first_root/infra"
ln -s "$repo_root/infra" "$second_root/infra"

first_name=$("$repo_root/scripts/compose-project-name.sh" "$first_root")
second_name=$("$repo_root/scripts/compose-project-name.sh" "$second_root")
if [ "$first_name" = "$second_name" ]; then
  echo "same-basename checkouts resolved to the same Compose project" >&2
  exit 1
fi

for fixture in "$first_root:$first_name" "$second_root:$second_name"; do
  root=${fixture%%:*}
  name=${fixture#*:}
  config="$root/compose-config.json"
  tooling_config="$root/compose-tooling-config.json"
  COMPOSE_PROJECT_NAME=caller-project KONDATE_COMPOSE_PROJECT_NAME="$name" \
    docker compose --env-file /dev/null --project-directory "$root" --project-name "$name" \
    -f "$repo_root/compose.tooling.yaml" config --format json \
    > "$tooling_config" 2> "$root/compose-tooling-config.stderr"
  grep -F '"name": "'"$name"'"' "$tooling_config" > /dev/null

  printf 'KONDATE_COMPOSE_PROJECT_NAME=%s\n' "$name" > "$root/.env"
  chmod 600 "$root/.env"
  docker compose --project-directory "$root" -f "$repo_root/compose.yaml" \
    config --format json > "$config" 2> "$root/compose-config.stderr"
  grep -F '"name": "'"$name"'"' "$config" > /dev/null
  grep -F '"name": "'"$name"'_default"' "$config" > /dev/null
  grep -F '"name": "'"$name"'_node_modules"' "$config" > /dev/null
done

echo "Compose project identity tests passed"
