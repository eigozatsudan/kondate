#!/bin/sh
# アプリ全体で共有されるAI日次枠(private.ai_global_daily_usage)を空にする。
#
# 生成系のE2Eは mobile+desktop で外部AI送信を累積する。製品ローカル既定の
# GLOBAL_DAILY_AI_LIMIT=20 では頭打ちになり、しかも JST 日付単位で DB に積み上がる。
# そのため同じ日の 2 回目以降のスイートや、1 suite 内の生成密集で global_daily_limit
# 落ちが起き得る（ユーザ単位枠はテストごと新規ユーザで独立）。
#
# 呼び出し契約（案 B 以降）:
# - run-e2e.sh が **suite 開始時に 1 回だけ** 本スクリプトを呼ぶ。
# - mobile||desktop は同一 wrapper 内で並列のため **project 境界の中間 reset はしない**。
# - E2E 上限は compose.e2e.yaml の GLOBAL_DAILY_AI_LIMIT=500（製品 max）。製品
#   compose の 20 / preflight は触らない。
# - 消すのは共有カウンタのみで、上限値そのものは変更しない。
# - test / fixture からの per-test truncate は禁止（e2e-ai-quota-parallel tooling）。
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=${KONDATE_COMPOSE_PROJECT_NAME:-$("$script_dir/compose-project-name.sh" "$repo_root")}

# DATABASE_URLはmigrateサービス側のenvにあるため、コンテナ内のshで展開する。
exec docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" run --rm --no-deps --entrypoint sh migrate \
  -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "truncate private.ai_global_daily_usage"'
