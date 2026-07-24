#!/usr/bin/env bash
# ホスト側で CI 検証ゲートを順に実行する集約スクリプト。
# docker compose を発行するため app コンテナ内では動かせない。
# ワークフロー本体は失敗ゲートを GitHub UI に明示するためステップ列挙を保ち、
# 本スクリプトとゲート順が一致することはソーステストで固定する。
# EXIT 時の teardown は Plan 6 Task 8 の拡張で追加する。
set -euo pipefail
docker compose config --quiet
docker compose up -d --wait
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
docker compose --profile test run --rm db-test
docker compose run --rm app npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
export LOCAL_MOCK_MODELS="${LOCAL_MOCK_MODELS:-mock/kondate-primary:free,mock/kondate-repair:free}"
export KONDATE_ASSERT_PRIVACY_LOGS=1
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
