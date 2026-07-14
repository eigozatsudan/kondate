#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/../.." && pwd)
unset COMPOSE_PROJECT_NAME KONDATE_COMPOSE_PROJECT_NAME
temporary=$(mktemp -d)
collision_first=/tmp/kondate-review-yfz0s9w6lom1
collision_second=/tmp/kondate-review-rnqm2dyk6ltt
collision_first_created=0
collision_second_created=0
cleanup() {
  rm -rf "$temporary"
  if [ "$collision_first_created" -eq 1 ]; then
    rm -rf "$collision_first"
  fi
  if [ "$collision_second_created" -eq 1 ]; then
    rm -rf "$collision_second"
  fi
}
trap cleanup EXIT HUP INT TERM

if [ -e "$collision_first" ] || [ -e "$collision_second" ]; then
  echo "collision fixture paths already exist" >&2
  exit 1
fi
mkdir "$collision_first"
collision_first_created=1
mkdir "$collision_second"
collision_second_created=1

collision_first_name=$("$repo_root/scripts/compose-project-name.sh" "$collision_first")
collision_second_name=$("$repo_root/scripts/compose-project-name.sh" "$collision_second")
if [ "$collision_first_name" = "$collision_second_name" ]; then
  echo "known cksum collision resolved to the same Compose project" >&2
  exit 1
fi
if [ "$collision_first_name" != "$("$repo_root/scripts/compose-project-name.sh" "$collision_first")" ]; then
  echo "same checkout did not resolve to a stable Compose project" >&2
  exit 1
fi
for name in "$collision_first_name" "$collision_second_name"; do
  if ! printf '%s\n' "$name" | grep -Eq '^kondate-[0-9a-f]{32}$'; then
    echo "Compose project name does not satisfy the lowercase SHA-256 identity format" >&2
    exit 1
  fi
done

if PATH=/nonexistent "$repo_root/scripts/compose-project-name.sh" "$collision_first" \
  > "$temporary/missing-sha.stdout" 2> "$temporary/missing-sha.stderr"; then
  echo "Compose project identity succeeded without sha256sum" >&2
  exit 1
fi
grep -F 'sha256sum is required' "$temporary/missing-sha.stderr" > /dev/null

mkdir "$temporary/bin"
printf '%s\n' '#!/bin/sh' "printf '%s\\n' 'not-a-sha256  -'" > "$temporary/bin/sha256sum"
chmod +x "$temporary/bin/sha256sum"
if PATH="$temporary/bin:/usr/bin:/bin" \
  "$repo_root/scripts/compose-project-name.sh" "$collision_first" \
  > "$temporary/malformed-sha.stdout" 2> "$temporary/malformed-sha.stderr"; then
  echo "Compose project identity accepted malformed sha256sum output" >&2
  exit 1
fi
grep -F 'sha256sum returned an invalid result' "$temporary/malformed-sha.stderr" > /dev/null

printf '%s\n' '#!/bin/sh' 'exit 37' > "$temporary/bin/sha256sum"
if PATH="$temporary/bin:/usr/bin:/bin" \
  "$repo_root/scripts/compose-project-name.sh" "$collision_first" \
  > "$temporary/failed-sha.stdout" 2> "$temporary/failed-sha.stderr"; then
  echo "Compose project identity ignored a sha256sum failure" >&2
  exit 1
fi
grep -F 'sha256sum failed to derive' "$temporary/failed-sha.stderr" > /dev/null

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

ln -s "$first_root" "$temporary/first-alias"
alias_name=$("$repo_root/scripts/compose-project-name.sh" "$temporary/first-alias")
if [ "$alias_name" != "$first_name" ]; then
  echo "canonical aliases resolved to different Compose projects" >&2
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
