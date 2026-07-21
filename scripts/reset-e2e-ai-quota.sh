#!/bin/sh
# E2E実行前に、アプリ全体で共有されるAI日次枠(private.ai_global_daily_usage)を空にする。
#
# 生成系のE2Eは1回のスイートで20回前後の外部AI送信を消費する。この枠は
# GLOBAL_DAILY_AI_LIMIT=45 のリリース確定値で頭打ちになり、しかもJST日付
# 単位でDBに積み上がるため、同じ日に2回目以降のスイートを流すと後半の
# テストだけが global_daily_limit で落ちる（ユーザ単位の枠はテストごとに
# 新規ユーザを作るため影響しない）。ローカルのE2Eを実行順・実行回数から
# 独立させるため、共有枠だけをここで初期化する。
#
# 消すのは共有カウンタのみで、上限値そのものは変更しない。
set -eu

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
cd "$repo_root"

project_name=${KONDATE_COMPOSE_PROJECT_NAME:-$("$script_dir/compose-project-name.sh" "$repo_root")}

# DATABASE_URLはmigrateサービス側のenvにあるため、コンテナ内のshで展開する。
exec docker compose --project-directory "$repo_root" --project-name "$project_name" \
  -f "$repo_root/compose.yaml" run --rm --no-deps --entrypoint sh migrate \
  -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "truncate private.ai_global_daily_usage"'
