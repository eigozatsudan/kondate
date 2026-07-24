# Kondate MVP release checklist

Immutable command and check template for the release candidate.
Gate results live in the protected CI/release system; real Google OAuth results live only in the external strict JSON artifact.

**Do not put** a guessed or self-referential commit SHA, execution result, user value, database URL, credential, secret, project ref, production/staging origin, Netlify metadata body, or raw log in this file or any other tracked path.

## Required tool versions

| Tool | Constraint |
| --- | --- |
| Node.js | `>=24 <25` (`package.json` `engines`) |
| npm | Bundled with the Node 24 image used by Compose `app` |
| Docker Compose | Host CLI that can run `compose.yaml` and profiles |
| PostgreSQL (local) | Via Compose `supabase-db` (do not install a second engine for gates) |
| Netlify CLI | Pinned `netlify-cli@26.2.0` in `package.json` (offline build only) |

Confirm versions on the release runner before Step A; record them only in the **external** protected release record (not in git).

## Acceptance rule (22/22 and 8/8)

- `docs/testing/acceptance-matrix.md` must have **exactly 22** populated MVP rows and **exactly 8** populated guided-planner rows.
- Every row has an owning automated test (file + exact title) and a layer.
- Real Google OAuth success is **not** satisfied by local mock alone: see external evidence policy below and `docs/testing/google-oauth-staging.md`.

## Deployment and runbook links

| Document | Role |
| --- | --- |
| [docs/deployment/supabase.md](../deployment/supabase.md) | Managed Supabase project, migrations, maintenance role |
| [docs/deployment/netlify.md](../deployment/netlify.md) | Netlify site, Functions, scheduled maintenance, env |
| [docs/runbooks/openrouter.md](../runbooks/openrouter.md) | Free-model-only OpenRouter ops |
| [docs/runbooks/account-deletion.md](../runbooks/account-deletion.md) | Account deletion operator path |

## Candidate SHA rule

The tested candidate is obtained only with:

```bash
export CANDIDATE_SHA="$(git rev-parse HEAD)"
```

Every subsequent gate must re-check:

```bash
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test -z "$(git status --porcelain)"
```

After the sole release-gate documentation commit, do **not** modify or commit checklist, matrix, evidence, generated types, or any other tracked file until a **new** candidate is intentionally cut (then discard stale external artifacts/tags and repeat).

## Maintenance contract (must pass inside Step A)

Covered by pgTAP `supabase/tests/database/maintenance_cleanup.test.sql`, unit tests under `netlify/functions/_shared/maintenance-*.test.ts` / `maintenance-cleanup.test.ts`, and `npm run test:maintenance-db:integration`:

1. **Four cleanup categories only** (fixed order): stale reservations → terminal generation ledgers → shopping mutations → auth continuations. Exactly four camelCase counts on success; regeneration snapshots leave only by cascade with terminal requests (not a fifth category).
2. **LOGIN role**: provisioned via `./scripts/provision-maintenance-role.sh`; default `statement_timeout` is `20s`; connection limit and least-privilege membership as in the script and migration.
3. **Executor**: `NOLOGIN` role executes only `run_kondate_maintenance(timestamptz, integer)`; helpers and `private` schema are not granted for maintenance use by browser/service roles.
4. **Retention**: generation terminal rows and shopping mutations use exact **30-day** boundaries (`< p_before`; exact boundary retained).
5. **Integration**: SQLSTATE `57014` cancel near 20s rolls back; exclusive lock on a later category rolls back earlier work; no leaked maintenance connection in `pg_stat_activity` after the client ends.

## External evidence location policy

| Artifact | Location | Contents policy |
| --- | --- | --- |
| Google OAuth staging success | **Outside** the repository only | Strict JSON fields in `docs/testing/google-oauth-staging.md`; 24-hour expiry; no tokens, codes, emails, screenshots, raw logs |
| Protected release record | Protected CI/release system only | `candidateSha`, production deploy ID, UTC date, Node/npm/Compose versions, command exit statuses/counts, 22/22 and 8/8, **reference** to the verified external Google artifact — never secrets, origins as free text in git, metadata bodies, or raw logs |
| Production / staging origins and deploy IDs | Obtained from Netlify API metadata on the protected runner | Never typed or copied from examples into git or operator chat as authority |

Verify Google evidence:

```bash
export NETLIFY_AUTH_TOKEN=...   # release-runner only; never a site/build var
export GOOGLE_OAUTH_RELEASE_EVIDENCE=/absolute/path/outside/repo/evidence.json
node scripts/verify-release-evidence.mjs "$GOOGLE_OAUTH_RELEASE_EVIDENCE"
```

Expect stdout: `google_oauth_evidence: pass`.

## Authoritative production deploy checks

`PRODUCTION_DEPLOY_ID` and `PRODUCTION_ORIGIN` come **only** from Netlify metadata on the protected runner (not operator input). Run `npm run verify:production-deploy` **immediately before and after** `npm run smoke:production -- "$PRODUCTION_ORIGIN"`. Both must bind the same `CANDIDATE_SHA`, release tag, current `published_deploy`, and origin. Typing or pasting an example origin is forbidden.

---

## Step A — Local / CI candidate gate (expected exit 0 each command)

Run from a clean worktree at the candidate. Prefer an `EXIT` trap (as in `scripts/ci.sh`) so Compose teardown and `.env` removal also run on failure.

```bash
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test -z "$(git status --porcelain)"
./scripts/generate-local-secrets.sh
docker compose up -d --wait
./scripts/provision-maintenance-role.sh
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
docker compose --profile test run --rm db-test
docker compose run --rm app npm run test:maintenance-db:integration
docker compose run --rm app npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
export LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free
KONDATE_ASSERT_PRIVACY_LOGS=1 ./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
docker compose run --rm --no-deps -e OPENROUTER_MODELS="$LOCAL_MOCK_MODELS" app sh -c 'npm run build && npm run verify:browser-secrets'
docker compose run --rm --no-deps app sh -c 'npm exec --offline netlify -- build --offline --context deploy-preview && npm run verify:browser-secrets'
docker compose run --rm --no-deps app node --test scripts/provision-maintenance-role.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs scripts/verify-release-evidence.test.mjs
docker compose config --quiet
docker compose run --rm --no-deps app sh -c \
  'if grep -rnE "OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|GENERATION_REQUEST_HMAC_KEY|SUPABASE_MAINTENANCE_DB_URL|MAINTENANCE_DB_PASSWORD|NETLIFY_AUTH_TOKEN" dist src shared; then exit 1; fi'
docker compose down --volumes
rm -f .env
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test -z "$(git status --porcelain)"
```

### Step A expectations (summary)

| Check | Expected |
| --- | --- |
| Each command above | Exit status `0` |
| Generated types | `db:types` covers `public,private`; zero diff on `src/shared/types/database.generated.ts` |
| Maintenance | LOGIN default/SET ROLE/privilege; 30-day boundaries; four-count readback; both `57014`/lock rollback paths; no leaked connection |
| Secrets in browser output | `verify:browser-secrets` pass; container secret-name scan finds zero matches |
| Offline Netlify | `netlify build --offline --context deploy-preview` exit 0 |
| Live providers | Deterministic tests do not contact live OpenRouter or Netlify APIs |
| Worktree | Final HEAD and clean tree equal the captured candidate |

`scripts/ci.sh` is the automated host-side wrapper with the same spirit (teardown trap included). Task 9 Step A remains the authority if the script and this list diverge; keep them aligned via `tests/tooling/project-config.test.mjs`.

---

## Step B — Staging evidence, tag, production (protected runner)

Deploy **the same** `CANDIDATE_SHA` to staging without another commit. Read staging deploy ID/SHA from Netlify metadata. Complete real Google OAuth from the login screen in the original browser; write the external JSON artifact (24-hour expiry). Then:

```bash
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" node scripts/verify-release-evidence.mjs "$GOOGLE_OAUTH_RELEASE_EVIDENCE"
test -z "$(git status --porcelain)"
git tag -a "v1.0.0" "$CANDIDATE_SHA" -m "Kondate MVP"
test "$(git rev-list -n 1 v1.0.0)" = "$CANDIDATE_SHA"
# Deploy tag v1.0.0, then populate PRODUCTION_DEPLOY_ID and PRODUCTION_ORIGIN
# from authoritative Netlify metadata only.
CANDIDATE_SHA="$CANDIDATE_SHA" RELEASE_TAG="v1.0.0" \
  PRODUCTION_DEPLOY_ID="$PRODUCTION_DEPLOY_ID" PRODUCTION_ORIGIN="$PRODUCTION_ORIGIN" \
  NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" npm run verify:production-deploy
npm run smoke:production -- "$PRODUCTION_ORIGIN"
CANDIDATE_SHA="$CANDIDATE_SHA" RELEASE_TAG="v1.0.0" \
  PRODUCTION_DEPLOY_ID="$PRODUCTION_DEPLOY_ID" PRODUCTION_ORIGIN="$PRODUCTION_ORIGIN" \
  NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" npm run verify:production-deploy
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
test "$(git rev-list -n 1 v1.0.0)" = "$CANDIDATE_SHA"
test -z "$(git status --porcelain)"
```

Also required on the protected path (see plan completion gate): production preflight against one exact managed Supabase project (browser/server/maintenance aligned), live free-model verification per OpenRouter runbook, and migration apply from the unchanged tagged checkout. `PRODUCTION_ORIGIN` is immutable for the command block once read from metadata.

If any gate, staging check, production metadata check, or smoke fails: fix in a **new** commit, discard the stale artifact and tag candidate, capture the new HEAD as `CANDIDATE_SHA`, and repeat from Step A.

## Failure and redo rule

There is no post-evidence repository commit that “records” pass/fail. Evidence and gate outcomes stay external. A failed candidate is never retagged; always re-cut from a clean HEAD.
