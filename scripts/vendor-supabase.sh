#!/usr/bin/env bash
set -euo pipefail

readonly TAG="v1.26.05"
readonly EXPECTED_SHORT_COMMIT="23b55d6"
readonly TARGET="infra/supabase"
readonly VERSION_FILE="infra/supabase.version"

if [[ -e "$TARGET" && "${1:-}" != "--refresh" ]]; then
  echo "$TARGET already exists; pass --refresh to replace generated vendor content" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$tmp_dir" init --quiet
git -C "$tmp_dir" remote add origin https://github.com/supabase/supabase.git
git -C "$tmp_dir" fetch --quiet --depth 1 origin "refs/tags/$TAG"
actual_short="$(git -C "$tmp_dir" rev-parse --short=7 FETCH_HEAD)"
if [[ "$actual_short" != "$EXPECTED_SHORT_COMMIT" ]]; then
  echo "unexpected Supabase commit: $actual_short" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"
git -C "$tmp_dir" archive --format=tar FETCH_HEAD:docker | tar -xf - -C "$TARGET"
git -C "$tmp_dir" rev-parse FETCH_HEAD > "$VERSION_FILE"

echo "Vendored supabase/supabase $TAG ($actual_short) docker/"
