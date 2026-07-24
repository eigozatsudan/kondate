#!/usr/bin/env bash
# ホスト側で CI 検証ゲートを順に実行する集約スクリプト。
# docker compose を発行するため app コンテナ内では動かせない。
# ワークフロー本体は失敗ゲートを GitHub UI に明示するためステップ列挙を保ち、
# 本スクリプトとゲート順が一致することはソーステストで固定する。
# 呼び出し側は事前に .env 生成・Compose 起動・maintenance role プロビジョンを行う。
# EXIT 時 teardown は .env と Compose を落とすが、メンテナンス秘密は印刷しない。
set -euo pipefail

teardown() {
  docker compose down --volumes >/dev/null 2>&1 || true
  rm -f .env
}
trap teardown EXIT

docker compose config --quiet
docker compose up -d --wait
./scripts/provision-maintenance-role.sh
docker compose run --rm --no-deps app node --test \
  scripts/provision-maintenance-role.test.mjs \
  scripts/preflight-production.test.mjs \
  scripts/smoke-production.test.mjs \
  scripts/verify-production-deploy.test.mjs \
  scripts/verify-browser-secrets.test.mjs
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run \
  netlify/functions/_shared/maintenance-env.test.ts \
  netlify/functions/_shared/maintenance-db.test.ts \
  netlify/functions/maintenance-cleanup.test.ts
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm app npm run test:maintenance-db:integration
docker compose --profile test run --rm db-test
docker compose run --rm app npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
export LOCAL_MOCK_MODELS="${LOCAL_MOCK_MODELS:-mock/kondate-primary:free,mock/kondate-repair:free}"
export KONDATE_ASSERT_PRIVACY_LOGS=1
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
docker compose run --rm --no-deps app sh -c 'npm run build && npm run verify:browser-secrets -- --require-dist'
docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
