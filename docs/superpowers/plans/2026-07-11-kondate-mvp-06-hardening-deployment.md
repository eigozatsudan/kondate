# Kondate Hardening and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the MVP with irreversible account deletion, repository-wide privacy and RLS checks, mobile accessibility verification, deterministic CI, and reproducible Netlify plus managed Supabase deployment.

**Architecture:** Account deletion remains a narrowly scoped authenticated Netlify Function and uses the Supabase Auth Admin API so deleting the Auth user drives database cascades. Build-time scripts reject unsafe OpenRouter configuration before Vite runs and verify live model metadata through a bounded five-second request at deployment. Production preflight binds browser, server, direct database, and Supavisor Session endpoints to one exact managed Supabase project ref. An hourly production Netlify Scheduled Function uses `pg` and a server-only, dedicated least-privilege PostgreSQL login to invoke one bounded maintenance RPC across stale reservations, generation ledgers, shopping idempotency mutations, and auth continuations; its database-role default timeout is effective before the RPC command begins. CI starts the same root Docker Compose stack used locally, provisions that same role boundary with ephemeral local credentials, runs every test layer, regenerates both public/private types, and produces the same offline Netlify build later deployed to production. A protected production-deploy verifier reads authoritative Netlify deploy and site metadata before and after smoke so the active deploy, candidate, tag, and smoke origin remain one SHA/origin.

**Tech Stack:** Node.js 24 LTS, TypeScript strict mode, Supabase Auth Admin API/PostgreSQL/RLS, node-postgres (`pg`), Netlify Functions and configuration, Vitest, React Testing Library, axe-core, Playwright, GitHub Actions, Docker Compose.

## Global Constraints

- Implement only after Plans 1–5 **and the guided-planner/optional-household plan (Plan ID 7, `docs/superpowers/plans/2026-07-22-guided-planner-optional-household.md`)**, and preserve every route, type, migration, and ownership boundary in the roadmap and in that plan.
- Plan 7's locked results are inputs here, never renegotiated: household setup is optional (`profiles.onboarding_status` includes `skipped`), `RequireCompletedOnboarding` no longer wraps the main routes, `/welcome` plus the five-step planner wizard replace the single-screen planner, `TargetMode = "household" | "idea"` is stored on drafts/frozen submissions/menus, `generation-command.v2` is the only command/HMAC version, `private.generation_regeneration_snapshots` is the request-bound regeneration snapshot, and `.guided-planner-theme` owns the linen/terracotta tokens. Plan 6 hardens and verifies these; it adds no product behavior to either mode.
- Idea mode never gains a family-safety guarantee, a shopping-list path, or `child_friendly` regeneration in this plan. Every Plan 6 test, fixture, runbook, and smoke probe keeps the fixed rejection codes `idea_menu_not_supported` (four shopping routes) and `idea_menu_revalidation_not_supported` (direct menu revalidation).
- Both of this plan's migrations are created with `docker compose run --rm --no-deps app npx supabase migration new <logical name>` (`account_deletion`, then `maintenance_cleanup`) so their CLI timestamps sort **after** every Plan 7 migration. The names `20260711005000_account_deletion.sql`/`20260711005100_maintenance_cleanup.sql` and the shorthands "migration 050/051" in this plan mean "the account-deletion migration" and "the maintenance migration" as ordered pairs; never hand-author a filename that would apply before Plan 7's `target_mode`, `generation_command_v2`, or idea-mode migrations on a clean reset. Record each CLI-emitted path in the Task brief/report.
- Account deletion is a hard delete after an explicit Japanese confirmation phrase. It deletes the authenticated Supabase Auth user; every owned row must disappear through tested `ON DELETE CASCADE` paths.
- Plan 1 remains the final `/settings` route and `HouseholdSettingsPage` owner. Plan 6 composes only `AccountSettingsSection`/DangerZone into that page and must preserve all family CRUD tests and controls.
- Never accept a user ID from the account-deletion request and never put a name, email, access token, household condition, prompt, or raw AI response in logs or CI artifacts.
- Browser code receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, public policy URLs, and Plan 1's provider-mode switch. Local/CI use `VITE_AUTH_PROVIDER_MODE=oauth_mock` plus exact `VITE_OAUTH_MOCK_ORIGIN=http://127.0.0.1:8788`; production requires `VITE_AUTH_PROVIDER_MODE=supabase` and forbids the mock-origin variable. Production browser and server Supabase URLs are exact managed origins with the same 20-character project ref, their publishable keys are byte-identical, and the maintenance direct host or Session-pooler username suffix carries that same ref. Service-role, OpenRouter, `GENERATION_REQUEST_HMAC_KEY`, and `SUPABASE_MAINTENANCE_DB_URL` credentials exist only in server-side secret contexts. The HMAC key and maintenance URL are Functions-scoped in Netlify and are exposed transiently only to the protected release preflight process; neither is a `VITE_` variable, site-build input, browser asset, repository value, artifact, or log field.
- Release-locked generation controls are exactly 5 successes/JST day, 12 sends/user/JST day, and 4 sends/fixed 600-second window. Runtime parsing and production preflight reject any drift in 5/12/4/600.
- Every configured OpenRouter model is explicit, unique, ends in `:free`, is not `openrouter/auto`, and supports both `structured_outputs` and `response_format` according to the live Models API at deployment time. That metadata request has one five-second abort deadline and reports a closed error without response content.
- The live-model check is mandatory for a Netlify production build but not for normal tests, which use the local mock service. The local model list is exactly what `compose.yaml` already sets — `mock/kondate-primary:free,mock/kondate-repair:free`, two entries because the repair path needs its own model. Commands in this plan write it as `OPENROUTER_MODELS="$LOCAL_MOCK_MODELS"`; export `LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free` before running them, and never collapse it to a single invented ID such as `mock/kondate:free`, which the mock does not serve.
- The SPA works without horizontal scrolling at 320, 375, and 430 CSS pixels. Every visible interactive target is at least 44 by 44 CSS pixels and every asynchronous status is exposed through text and an appropriate live region. This now includes `/welcome`, each of the five wizard steps, the review screen, and the idea-mode result/history surfaces. Split ownership rather than re-implementing: Plan 7 Task 1 owns the `.guided-planner-theme` contrast tests, and Plan 7 Task 8 Step 5 owns the 320-pixel/44-pixel wizard sweep plus keyboard-only traversal and reduced-motion. Plan 6 adds what neither covers — axe/landmark/live-region over every route, the 375- and 430-pixel widths, and both modes' result and history surfaces — and never relaxes or restates a Plan 7 assertion. Where the 320-pixel wizard sweep below overlaps Plan 7's, the acceptance matrix cites Plan 7's test rather than counting a duplicate.
- CI runs formatting, lint, type checking, unit/component/adversarial tests, database tests, integration/E2E tests, the Netlify production build, Docker Compose validation, and dependency auditing. No deploy proceeds after a failed gate.
- Production smoke tests are read-only except for the unauthenticated rejection probes; they do not create users, menus, or OpenRouter calls.
- `maintenance-cleanup` uses code config `schedule: "@hourly"` with no `path`, runs only on published production deploys, and uses one fresh `pg.Client` per invocation. Its four fixed categories are stale generation reservations, terminal generation ledgers older than 30 days, `private.shopping_mutations` older than 30 days, and auth continuations past `expires_at` (default semantics match Plan 1's expire-only cleaner; expand claimed-before-expiry only with explicit pgTAP). The dedicated LOGIN has `statement_timeout='20s'` before the first SQL command; the transaction reasserts and verifies `SET LOCAL ROLE kondate_maintenance_executor` plus `SET LOCAL statement_timeout='20s'`; the driver aborts at 25 seconds; and the platform stops at 30 seconds. Every path rolls back when possible, closes the connection, and logs exactly four aggregate cleanup counts, duration, and a closed error code only.
- The release checklist/matrix commit precedes the final gate. Local, staging Google, tag, and the currently published production deployment all resolve to the same candidate SHA; the protected verifier reads Netlify deploy metadata and current site `published_deploy` metadata before and after smoke. Evidence is external and no evidence-result commit follows it.
- Follow red-green-refactor and end every task with a focused commit.

### Start gate (before Task 1)

Do not open Task 1 until all of the following hold:

1. **Delivery order:** Plans 1–5 and Plan 7 are complete per `git log` and `.superpowers/sdd/progress.md` (trust `git log` on disagreement). Plan 6 depends on that closed surface; it does not re-open product mode contracts.
2. **Cross-plan Important findings (authoritative):** Read `.superpowers/sdd/plan-reviews-2026-07-24/00-cross-plan-summary.md` (or the latest equivalent). **Every** Important in that rollup that can fail Plan 6's acceptance matrix (22 MVP + 8 guided-planner), full-journey E2E, cascade seed, or release gate must be either **closed with a commit** or **explicitly deferred in writing** with owner, residual risk, and which matrix row(s) remain at risk. Safety, privacy, authorization, data-loss, paid-model, and accessibility Importants cannot be deferred into Plan 6 as "fix when the journey fails." §2 is the full gate — do not treat the example list below as exhaustive.
3. **Illustrative high-impact themes** (non-exhaustive examples that historically hit journeys; still subject to §2): Plan 3 finalize fingerprint / failure UI, Plan 3 pantry recheck terminalization, Plan 4 deleted-member regeneration, Plan 5 shopping identity/mutation races, Plan 2 emergency empty under-six, Plan 7 regen context mode from request snapshot. Empty residual only by evidence against the full cross-plan rollup.
4. **Clean worktree for Plan 6 ownership:** no half-applied Plan 6 migrations, no uncommitted rewrite of locked Plan 7 contracts, and no concurrent Implementer on the same worktree.

Record the gate outcome (closed Importants + any approved deferrals, mapped to matrix rows) in the Task 1 brief before writing the first red test.

### How every command in this plan is executed

This repository installs no host tooling: the host has Node but no `psql`, no `rg`, and the `app` container has no Docker socket. Earlier drafts of this plan assumed a conventional checkout and are corrected here. There are exactly three execution contexts, and every command below states which one it belongs to.

1. **Container-routed (default).** All Node/npm/npx work runs inside the `app` service. Host-independent commands — `typecheck`, `lint`, `format:check`, `build`, `vitest`, `node --test`, `npm ci`, `npm install`, `npm audit`, `npm exec` — add `--no-deps`; anything that talks to a sibling service (notably `db:types`, which reads pg-meta at `http://meta:8080` and is unreachable from the host because `meta` publishes no port) omits `--no-deps` and requires `docker compose up -d --wait` first.

   ```bash
   docker compose run --rm --no-deps app npm run typecheck
   docker compose run --rm --no-deps app npx vitest run <files>
   docker compose run --rm app npm run db:types
   ```

2. **Host-issued Compose commands.** The wrappers that themselves drive Docker cannot run inside `app`: `docker compose --profile test run --rm db-test [files]` (pgTAP), `docker compose run --rm migrate`, `./scripts/run-e2e.sh`, `./scripts/reset-local-db.sh`, `docker compose config/up/down/ps`. Issue these from the host or the CI runner. Never wrap them in `npm run` inside a container.

3. **Protected release runner.** `preflight:production`, `smoke:production`, `verify:production-deploy`, and `verify-release-evidence.mjs` run only in the protected release environment with the real secret set. They are outside this repository's container model and are never run against the local mock stack.

Two consequences apply everywhere. **No command may depend on `rg`**: use `grep -rn` inside `app`, and never write a check whose tool-missing case silently produces a zero count that passes (`test "$(rg … | wc -l)" -eq 0` passes trivially when `rg` is absent — every such check in earlier drafts was a false green). **No test may assume it can shell out to `docker`**: the `e2e` service has neither the socket nor the CLI, so E2E fixtures reach Postgres directly over `network_mode: host` instead of `docker compose exec db psql`.

The aggregate `ci` entry point is therefore a host shell script, not an npm script: `npm run ci` cannot exist in a form that works both inside and outside a container. See Task 7.

---

### Task 1: Prove account-wide cascade behavior

**Files:**
- Create via CLI: migration logical name `account_deletion` (the CLI timestamp must sort after every Plan 7 migration; referred to below as the account-deletion migration / "050")
- Create: `supabase/tests/database/account_deletion.test.sql`

**Interfaces:**
- Consumes: every `public` and `private` table created by Plans 1–5 **and Plan 7** that has a `user_id` column — including `public.shopping_current_label_warnings` (Plan 5) and `private.generation_regeneration_snapshots` (Plan 7). The explicit list is 24 public relations; derive it from the migrations at implementation time rather than trusting this count, and treat any table the dynamic assertion finds but the list omits as a bug in the list.
- Consumes: Plan 2's normalized `public.menu_safety_actions` producer (also populated by Plan 3 finalization); this plan inventories and tests that table but does not recreate it.
- Produces: a deployment-time invariant that every such column has a direct cascading foreign key to `auth.users(id)` and a pgTAP regression test for that invariant.

- [ ] **Step 1: Write the failing pgTAP inventory test**

```sql
begin;
select plan(2);

select is_empty(
  $$
    with expected(table_name) as (values
      ('profiles'),('household_members'),('member_allergies'),('member_dislikes'),
      ('privacy_consents'),('pantry_items'),('generation_drafts'),('menus'),
      ('menu_target_members'),('generation_pantry_selections'),('dishes'),
      ('dish_ingredients'),('recipe_steps'),('menu_timeline_steps'),
      ('menu_member_adaptations'),('menu_safety_actions'),('menu_label_confirmations'),('menu_revalidations'),
      ('shopping_lists'),('shopping_list_sources'),('shopping_items'),
      ('shopping_item_sources'),('shopping_label_confirmations'),
      ('shopping_current_label_warnings')
    )
    select expected.table_name
    from expected
    left join information_schema.columns column_info
      on column_info.table_schema = 'public'
     and column_info.table_name = expected.table_name
     and column_info.column_name = 'user_id'
    where column_info.column_name is null
  $$,
  'every user-owned public relation has user_id'
);

select is_empty(
  $$
    select format('%I.%I', n.nspname, c.relname) as relation
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attname = 'user_id'
     and a.attnum > 0
     and not a.attisdropped
    join pg_attribute auth_id
      on auth_id.attrelid = 'auth.users'::regclass
     and auth_id.attname = 'id'
     and auth_id.attnum > 0
     and not auth_id.attisdropped
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p')
      and (not exists (
        select 1
        from pg_constraint fk
        where fk.contype = 'f'
          and fk.conrelid = c.oid
          and fk.confrelid = 'auth.users'::regclass
          and fk.confdeltype = 'c'
          and fk.conkey = array[a.attnum]::smallint[]
          and fk.confkey = array[auth_id.attnum]::smallint[]
      ) or exists (
        select 1
        from pg_constraint competing
        where competing.contype = 'f'
          and competing.conrelid = c.oid
          and competing.confrelid = 'auth.users'::regclass
          and a.attnum = any(competing.conkey)
          and not (competing.confdeltype = 'c'
            and competing.conkey = array[a.attnum]::smallint[]
            and competing.confkey = array[auth_id.attnum]::smallint[])
      ))
    order by 1
  $$,
  'every user_id has only the exact single-column cascading Auth reference'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the focused test and record the offending tables**

Run (host-issued Compose; never inside `app`):

```bash
docker compose --profile test run --rm db-test supabase/tests/database/account_deletion.test.sql
```

Expected: FAIL if any earlier migration omitted the required cascading foreign key; the diagnostic lists each offending schema and table.

- [ ] **Step 3: Correct existing foreign keys forward-only, then add the invariant guard**

```sql
do $correction$
declare target record; existing_fk record; constraint_name text;
begin
  for target in
    select n.nspname as schema_name,c.relname as table_name,c.oid as table_oid,
      a.attnum,auth_id.attnum as auth_id_attnum
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id'
      and a.attnum>0 and not a.attisdropped
    join pg_attribute auth_id on auth_id.attrelid='auth.users'::regclass
      and auth_id.attname='id' and auth_id.attnum>0 and not auth_id.attisdropped
    where n.nspname in('public','private') and c.relkind in('r','p')
  loop
    -- Remove every competing Auth FK that includes user_id: non-cascade and
    -- composite references to auth.users must not coexist or make the exact
    -- single-column invariant appear satisfied. Preserve owner-composite FKs
    -- to application relations; they enforce the tenant graph independently.
    for existing_fk in select conname from pg_constraint where contype='f'
      and conrelid=target.table_oid and confrelid='auth.users'::regclass
      and target.attnum=any(conkey)
      and not (confdeltype='c'
        and conkey=array[target.attnum]::smallint[]
        and confkey=array[target.auth_id_attnum]::smallint[])
    loop
      execute format('alter table %I.%I drop constraint %I',target.schema_name,
        target.table_name,existing_fk.conname);
    end loop;
    if not exists(select 1 from pg_constraint fk where fk.contype='f'
      and fk.conrelid=target.table_oid and fk.confrelid='auth.users'::regclass
      and fk.confdeltype='c'
      and fk.conkey=array[target.attnum]::smallint[]
      and fk.confkey=array[target.auth_id_attnum]::smallint[])
    then
      constraint_name:=left(target.table_name||'_user_id_auth_users_cascade_fkey',63);
      execute format('alter table %I.%I add constraint %I foreign key (user_id) '
        'references auth.users(id) on delete cascade',target.schema_name,target.table_name,constraint_name);
    end if;
  end loop;
end;
$correction$;

do $$
declare
  expected_tables constant text[] := array[
    'profiles','household_members','member_allergies','member_dislikes','privacy_consents',
    'pantry_items','generation_drafts','menus','menu_target_members',
    'generation_pantry_selections','dishes','dish_ingredients','recipe_steps',
    'menu_timeline_steps','menu_member_adaptations','menu_safety_actions','menu_label_confirmations',
    'menu_revalidations','shopping_lists','shopping_list_sources','shopping_items',
    'shopping_item_sources','shopping_label_confirmations','shopping_current_label_warnings'
  ];
  missing_user_id text[];
  offenders text[];
begin
  select coalesce(array_agg(expected_table order by expected_table), '{}')
    into missing_user_id
  from unnest(expected_tables) as expected_table
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = expected_table
      and column_name = 'user_id'
  );
  if cardinality(missing_user_id) > 0 then
    raise exception 'account deletion requires user_id columns: %', array_to_string(missing_user_id, ', ');
  end if;

  select coalesce(array_agg(format('%I.%I', n.nspname, c.relname) order by n.nspname, c.relname), '{}')
    into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = 'user_id'
   and a.attnum > 0
   and not a.attisdropped
  join pg_attribute auth_id
    on auth_id.attrelid = 'auth.users'::regclass
   and auth_id.attname = 'id'
   and auth_id.attnum > 0
   and not auth_id.attisdropped
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p')
    and (not exists (
      select 1
      from pg_constraint fk
      where fk.contype = 'f'
        and fk.conrelid = c.oid
        and fk.confrelid = 'auth.users'::regclass
        and fk.confdeltype = 'c'
        and fk.conkey = array[a.attnum]::smallint[]
        and fk.confkey = array[auth_id.attnum]::smallint[]
    ) or exists (
      select 1
      from pg_constraint competing
      where competing.contype = 'f'
        and competing.conrelid = c.oid
        and competing.confrelid = 'auth.users'::regclass
        and a.attnum = any(competing.conkey)
        and not (competing.confdeltype = 'c'
          and competing.conkey = array[a.attnum]::smallint[]
          and competing.confkey = array[auth_id.attnum]::smallint[])
    ));

  if cardinality(offenders) > 0 then
    raise exception 'account deletion requires exact non-competing user_id Auth FKs: %', array_to_string(offenders, ', ');
  end if;
end;
$$;
```

Never edit any already-applied migration — Plans 1–5's `001`–`040` or Plan 7's four (`optional_household_profiles`, `target_mode_storage`, `generation_command_v2`, `idea_generation_boundary`) — even when Step 2 identifies an offender. The account-deletion migration drops every competing FK to `auth.users` whose local key contains that offender's `user_id` (including composite and non-cascade Auth FKs), preserves owner-composite FKs to application tables, adds exactly `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`, and then runs the exact single-column guard above. A later discovery is fixed in a new migration created after the maintenance migration, never by changing an applied checksum.

Plan 7's `private.generation_regeneration_snapshots` is the case this correction must get right rather than "fix": its `(request_id,user_id) → private.ai_generation_requests(id,user_id) ON DELETE CASCADE` composite FK targets an application relation, so it is preserved by the rule above and must still be joined by its own exact single-column `user_id → auth.users(id) ON DELETE CASCADE`. Both survive migration; the guard passes only when the single-column Auth FK exists and no *Auth* FK competes with it. Step 2's diagnostic run therefore has to be read against the post–Plan 7 schema, not the Plan 5 schema.

- [ ] **Step 4: Rebuild the database and verify the invariant**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/account_deletion.test.sql
docker compose --profile test run --rm db-test
```

Expected: both focused assertions and the complete pgTAP suite pass.

- [ ] **Step 5: Commit the forward-only correction and invariant**

```bash
git add supabase/migrations supabase/tests/database/account_deletion.test.sql
git commit -m "test: enforce account deletion cascades"
```

### Task 2: Add the authenticated account-deletion API and settings flow

**Files:**
- Create: `shared/contracts/account.ts`
- Create: `netlify/functions/delete-account.ts`
- Create: `netlify/functions/delete-account.test.ts`
- Create: `src/features/account/delete-account-dialog.tsx`
- Create: `src/features/account/delete-account-dialog.test.tsx`
- Create: `src/features/account/account-settings-section.tsx`
- Create: `src/features/account/account-settings-section.test.tsx`
- Create: `src/features/auth/auth-cleanup.ts`
- Create: `src/features/auth/auth-cleanup.test.ts`
- Modify: `src/features/household/household-settings-page.tsx`
- Modify: `src/features/household/household-settings-page.test.tsx`

Do **not** modify `src/features/auth/session.ts`. Plan 1's `requireAccessToken` stays untouched; sign-out and post-delete cleanup live only in `auth-cleanup.ts` and `AccountSettingsSection`.

**Interfaces:**
- Consumes: `requireUser(request)`, `getSupabaseAdmin()`, and Plan 2's `parseJson`, `json`, `methodNotAllowed`, `HttpError`, and `handleError` helpers.
- Produces: `DELETE /api/account`, `DeleteAccountRequest`, `DeleteAccountResult`, `AccountSettingsSection`, its `DangerZone`, and local-auth cleanup after deletion. Plan 1 remains the sole `/settings` route/page owner.

- [ ] **Step 1: Define and test the exact request contract**

```ts
// shared/contracts/account.ts
import { z } from "zod";

export const deleteAccountRequestSchema = z.object({
  confirmation: z.literal("削除する"),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type DeleteAccountResult = { deleted: true };
```

The injected handler test covers: a non-`DELETE` request returns `405 method_not_allowed`; missing bearer token returns `401 auth_required`; a different phrase returns `400 invalid_request`; the handler ignores an extra `user_id`; Admin API failure returns `503 account_delete_failed`; success calls the one-argument dependency `deleteUser(authenticatedUser.userId)` exactly once and returns `{ok:true,data:{deleted:true}}`; no logged argument contains the user ID, email, or token. A separate adapter test spies on `getSupabaseAdmin().auth.admin.deleteUser` and proves the production dependency passes `(authenticatedUser.userId,false)` for hard deletion.

- [ ] **Step 2: Run the function test and verify failure**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/delete-account.test.ts
```

Expected: FAIL because the contract and function do not exist.

- [ ] **Step 3: Implement the function with injected dependencies**

Netlify Function modules use `tsconfig.functions.json` (`module`/`moduleResolution`: `NodeNext`). Every relative and shared import must carry the **`.js` extension** (same convention as `usage-today.ts` and the rest of `netlify/functions/`).

```ts
// netlify/functions/delete-account.ts
import type { Config } from "@netlify/functions";
import { deleteAccountRequestSchema, type DeleteAccountResult } from "../../shared/contracts/account.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

export type DeleteAccountDeps = {
  authenticate: typeof requireUser;
  deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
};

export const createDeleteAccountHandler = (deps: DeleteAccountDeps) => async (request: Request): Promise<Response> => {
  if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
  try {
    const auth = await deps.authenticate(request);
    await parseJson(request, deleteAccountRequestSchema);
    const { error } = await deps.deleteUser(auth.userId);
    if (error) {
      throw new HttpError(
        503,
        "account_delete_failed",
        "削除できませんでした。時間をおいてもう一度お試しください",
      );
    }
    return json<DeleteAccountResult>(200, { ok: true, data: { deleted: true } });
  } catch (error) {
    return handleError(error);
  }
};

const handler = createDeleteAccountHandler({
  authenticate: requireUser,
  deleteUser: async (userId) => getSupabaseAdmin().auth.admin.deleteUser(userId, false),
});

export default handler;
export const config: Config = { path: "/api/account" };
```

`parseJson` maps malformed JSON and Zod failures to Plan 2's closed `HttpError` codes and never logs the request body. The literal-schema failure is exposed as `invalid_request`; the page maps that code to “「削除する」と入力してください”.

- [ ] **Step 4: Run the focused function test**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/delete-account.test.ts
```

Expected: all account API cases pass.

- [ ] **Step 5: Write the failing settings-dialog tests**

The component test asserts that `AccountSettingsSection` renders sign-out and a separately labelled `DangerZone`. For ordinary sign-out, seed `kondate:generation:v2`, shopping recovery, auth flow/session/verifier, and the safety revision in both storage areas; clicking `ログアウト` must await `clearLocalAuthAndDrafts(getBrowserSupabaseClient())`, remove every owned recovery/auth key, preserve an unrelated preference, call no account-deletion API, and only then navigate to `/login?signedOut=1`. A deferred cleanup promise proves navigation cannot win the race. The destructive action is initially collapsed, opening it explains that family settings, history, pantry, and shopping data are permanently deleted, the submit button stays disabled until the exact phrase `削除する` is entered, failure keeps the dialog open with retry copy, Escape/cancel closes without a request, and deletion success awaits the same cleanup helper then navigates to `/login?accountDeleted=1`.

- [ ] **Step 6: Implement the accessible destructive flow**

```tsx
// src/features/account/delete-account-dialog.tsx
type DeleteAccountDialogProps = {
  open: boolean;
  pending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (confirmation: "削除する") => Promise<void>;
};

export function DeleteAccountDialog(props: DeleteAccountDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      setConfirmation("");
      dialog.showModal();
    }
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-account-title"
      onCancel={(event) => { event.preventDefault(); props.onCancel(); }}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-5"
    >
      <h2 id="delete-account-title" className="text-lg font-bold">アカウントを削除しますか？</h2>
      <p className="mt-3">家族設定、冷蔵庫、献立履歴、買い物リストを含むすべてのデータが削除され、元に戻せません。</p>
      <label className="mt-4 block" htmlFor="delete-confirmation">確認のため「削除する」と入力</label>
      <input
        id="delete-confirmation"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="off"
        className="mt-2 min-h-11 w-full rounded-xl border px-3"
      />
      <p role="alert" className="mt-2 min-h-6">{props.errorMessage}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" className="min-h-11 rounded-xl border" onClick={props.onCancel}>やめる</button>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-red-700 text-white disabled:opacity-50"
          disabled={confirmation !== "削除する" || props.pending}
          onClick={() => props.onConfirm("削除する")}
        >
          {props.pending ? "削除しています" : "完全に削除する"}
        </button>
      </div>
    </dialog>
  );
}
```

Create the cleanup module against Plan 1's real session boundary; no `auth-store.ts` is introduced:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
// Database の公開入口は generated 直 import ではなく re-export 側を使う（既存 client と同一）。
import type { Database } from "@/shared/types/database";
import { clearOwnedAuthStorage } from "./auth-flow";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
export async function clearLocalAuthAndDrafts(client: SupabaseClient<Database>): Promise<void> {
  await client.auth.signOut({scope:"local"}).catch(()=>undefined);
  for(const storage of [localStorage,sessionStorage]){
    clearOwnedAuthStorage(storage);
    for(const key of Object.keys(storage)){
      if(key.startsWith("kondate:generation:")||key.startsWith("kondate:shopping:")||
        key===householdSafetyRevisionStorageKey){
        storage.removeItem(key);
      }
    }
  }
}
```

Plan 1 owns and exports `ownedAuthStoragePrefixes` from `auth-flow.ts` as the exact `kondate.auth.flow.` and configured `kondate.auth.supabase` prefixes, plus `clearOwnedAuthStorage(storage)` implemented only from that export; the latter prefix covers Supabase session and library-owned PKCE verifier derivatives. Plan 6 calls that helper and never hardcodes a broad `sb-` rule or a second copy of an auth prefix. Also remove the exact privacy-minimal `kondate:household-safety-revision` key alongside every generation/shopping recovery key. `auth-cleanup.test.ts` seeds `kondate.auth.flow.*`, the Supabase session key and verifier derivative, `kondate:generation:v2` with a custom-reason command, shopping recovery keys, the safety revision, and an unrelated `kondate:preferences` key in both storage areas; cleanup removes only those owned keys/prefixes, retains the unrelated key, and resolves even when `signOut` reports that the already-deleted server user is absent. Import `useEffect`, `useRef`, and `useState` from React. `AccountSettingsSection` owns the account API mutation and ordinary sign-out. Deletion invokes cleanup only after the server delete succeeds; ordinary sign-out always awaits cleanup directly. Both navigate only after cleanup, and the ordinary path never calls `DELETE /api/account`.

Modify—not replace—Plan 1's `HouseholdSettingsPage` / `HouseholdSettingsForm`: import `AccountSettingsSection` from `@/features/account/account-settings-section` and render `<AccountSettingsSection />` **immediately before the closing `</main>`** of the loaded settings form (after the complete member/allergy/dislike editor, including any member-delete dialog still inside that same `main`). Do not extract, rename, or substitute that editor. Do not create another settings page, change the `/settings` route, or replace `HouseholdSettingsPage` in `router.tsx`. Its integration test first adds/edits/deletes a member and updates allergy/dislike state, then opens the composed danger zone; it proves all existing family CRUD controls remain present and the route still renders exactly one Plan 1 page owner.

- [ ] **Step 7: Run component, type, and build checks**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/account/delete-account-dialog.test.tsx
docker compose run --rm --no-deps app npx vitest run src/features/account/account-settings-section.test.tsx src/features/household/household-settings-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run build
```

Expected: tests pass, the settings route compiles, and `dist/` is produced.

- [ ] **Step 8: Commit account deletion**

```bash
git add shared/contracts/account.ts netlify/functions/delete-account.ts netlify/functions/delete-account.test.ts src/features/account src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx src/features/auth/auth-cleanup.ts src/features/auth/auth-cleanup.test.ts
git commit -m "feat: add permanent account deletion"
```

### Task 3: Lock environment parsing and live free-model verification

**Files:**
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `scripts/verify-openrouter-models.mjs`
- Create: `scripts/verify-openrouter-models.test.mjs`
- Create (optional contract table): `scripts/openrouter-models-contract.mjs` — shared accept/reject fixtures for script + Functions tests
- Modify: `package.json`
- Modify: `netlify/functions/_shared/env.ts`
- Modify: `netlify/functions/_shared/env.test.ts`

**Interfaces:**
- Consumes: the **existing** `scripts/verify-openrouter-models.mjs`, the existing `verify:openrouter:config` / `verify:openrouter:models` scripts and their `predev`/`prebuild` callers, `OPENROUTER_MODELS` parsing from Plan 3, and the OpenRouter `GET /api/v1/models` response.
- Produces: a testable refactor of that same script **plus** a Functions-side Zod mirror of the same free-model list rules, locked together by a shared contract test table. **The script names do not change.** `verify:openrouter:config` and `verify:openrouter:models` keep their current names and their `--remote` argument convention, because `predev` and `prebuild` already call them; introducing `verify:models:config`/`verify:models:remote` would break both.

**Single contract, two runtimes (not two independent designs):** build/CLI cannot import the Functions Zod stack without pulling Netlify runtime into `predev`, and Functions cannot depend on a Node script path for cold starts. Therefore keep two implementations that **must stay mirror-identical**:

1. `scripts/verify-openrouter-models.mjs` exports `parseConfiguredModels` for build/`predev`/`prebuild`/`--remote`.
2. `netlify/functions/_shared/env.ts` keeps (or tightens) its own `OPENROUTER_MODELS` Zod transform for runtime.

Do **not** claim a single shared module unless both call sites can import it without new bundling work. Instead: put the accepted and rejected model-list strings in **one table** (e.g. `scripts/openrouter-models-contract.mjs` exporting plain arrays, or a duplicated table with a comment pointer) and drive **both** `verify-openrouter-models.test.mjs` and `env.test.ts` from that same table so drift fails CI. Prose that says "one shared parser" means **one contract**, not necessarily one file.

The current script has no exports and does its work at module top level, so Step 1's test cannot import it as written. The refactor is therefore: extract `parseConfiguredModels`, `verifyRemoteModels`, and `main` as named exports, keep the executable guard, and keep `--remote` as the remote-check switch rather than adding a `VERIFY_OPENROUTER_REMOTE` env variable. Read the current file before rewriting it and preserve any rule it already enforces that the snippet below omits.

- [ ] **Step 1: Add table-driven failing tests for the verifier**

```js
// scripts/verify-openrouter-models.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { main, parseConfiguredModels, verifyRemoteModels } from "./verify-openrouter-models.mjs";

test("accepts ordered unique free model IDs", () => {
  assert.deepEqual(parseConfiguredModels("mock/first:free,mock/second:free"), ["mock/first:free", "mock/second:free"]);
});

for (const value of ["", "openrouter/auto", "vendor/paid", "vendor/a:free,vendor/a:free"]) {
  test(`rejects unsafe model configuration: ${value || "empty"}`, () => {
    assert.throws(() => parseConfiguredModels(value));
  });
}

test("requires both structured output parameters from every configured model", () => {
  assert.throws(() => verifyRemoteModels(["vendor/a:free"], [{
    id: "vendor/a:free",
    supported_parameters: ["response_format"],
  }]));
});

test("bounds the live Models API request and closes transport failures", async () => {
  const signal = AbortSignal.abort(new Error("test abort"));
  const fetchImpl = async (_url, init) => {
    assert.equal(init.signal, signal);
    throw new Error("sensitive transport detail");
  };
  await assert.rejects(
    main({ OPENROUTER_MODELS: "vendor/a:free" }, fetchImpl, () => signal, ["--remote"]),
    /openrouter_models_unavailable/u,
  );
});
```

- [ ] **Step 2: Run the Node test and verify failure**

Run (container-routed; host `node --test` is not an execution context for this plan):

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
```

Expected: FAIL because the verifier module does not export the tested functions (or the test file is red for the missing export).

- [ ] **Step 3: Implement structural and remote verification**

```js
// scripts/verify-openrouter-models.mjs
const officialModelsUrl = "https://openrouter.ai/api/v1/models?output_modalities=text";
export const modelsApiTimeoutMs = 5_000;

export function parseConfiguredModels(raw) {
  const models = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (models.length === 0) throw new Error("OPENROUTER_MODELS must not be empty");
  if (models.some((id) => id === "openrouter/auto" || !id.endsWith(":free"))) {
    throw new Error("OPENROUTER_MODELS accepts explicit :free IDs only");
  }
  if (new Set(models).size !== models.length) throw new Error("OPENROUTER_MODELS must not contain duplicates");
  return models;
}

export function verifyRemoteModels(configured, remote) {
  const byId = new Map(remote.map((model) => [model.id, model]));
  for (const id of configured) {
    const model = byId.get(id);
    if (!model) throw new Error(`${id} is not present in the OpenRouter Models API`);
    const parameters = new Set(Array.isArray(model.supported_parameters) ? model.supported_parameters : []);
    if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
      throw new Error(`${id} does not support strict structured output`);
    }
  }
}

export async function main(
  env = process.env,
  fetchImpl = fetch,
  createSignal = () => AbortSignal.timeout(modelsApiTimeoutMs),
  argv = process.argv.slice(2),
) {
  const configured = parseConfiguredModels(env.OPENROUTER_MODELS ?? "");
  if (env.CONTEXT === "production" && env.OPENROUTER_BASE_URL !== "https://openrouter.ai/api/v1") {
    throw new Error("production OPENROUTER_BASE_URL must equal https://openrouter.ai/api/v1");
  }
  if (!argv.includes("--remote")) return;
  let response;
  try {
    response = await fetchImpl(officialModelsUrl, {
      headers: { Accept: "application/json" }, signal: createSignal(),
    });
  } catch {
    throw new Error("openrouter_models_unavailable");
  }
  if (!response.ok) throw new Error(`OpenRouter Models API returned ${response.status}`);
  const body = await response.json();
  if (!body || !Array.isArray(body.data)) throw new Error("OpenRouter Models API returned an invalid body");
  verifyRemoteModels(configured, body.data);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "model verification failed"}\n`);
    process.exitCode = 1;
  });
}
```

The same free-model list rules must appear in the Zod schema in `netlify/functions/_shared/env.ts` as a **mirror** of `parseConfiguredModels` (see Interfaces above). Drive both the script Node tests and `env.test.ts` from the shared contract table so runtime and build cannot drift.

**Quota locks vs deadline locks — do not confuse them.** Today (`env.ts`) the 5/12/4/600 fields already use `releaseLockedInteger` and reject drift. **`OPENROUTER_TIMEOUT_MS`, `FUNCTION_TOTAL_BUDGET_MS`, and `AI_PROCESSING_STALE_SECONDS` do not:** they are `positiveInteger(...)` with defaults `20000` / `50000` / `180`, so any positive integer is accepted. Task 3 must **promote those three to exact-value locks** (same pattern as `releaseLockedInteger` or an equivalent `z.union([z.literal(20000), z.literal("20000")]).transform(() => 20000)`):

- Accept only `20000` / `"20000"` for `OPENROUTER_TIMEOUT_MS`.
- Accept only `50000` / `"50000"` for `FUNCTION_TOTAL_BUDGET_MS`.
- Accept only `180` / `"180"` for `AI_PROCESSING_STALE_SECONDS`.

Vitest cases (required, red-first before changing the schema):

- exact values (number and string forms) parse to the locked numbers;
- defaults when unset remain 20000 / 50000 / 180 if the schema still defaults, or fail closed if the plan prefers requiring explicit env — pick one and test it; Compose already sets the three values, so **require explicit env and reject unset** is acceptable;
- **reject** neighbors such as `19999`, `20001`, `49999`, `50001`, `179`, `181`, `0`, negatives, floats, and empty strings with a closed error (no silent coerce to default).

Do not claim these three are already release-locked in code before this Task; the roadmap/design intent is exact 20s / 50s / 180s, but implementation is still loose. `USER_DAILY_*` and `USER_SHORT_WINDOW_*` remain already locked — verify, do not weaken. `AUTH_CONTINUATION_TTL_SECONDS=300` comes from the continuation schema this one extends. A production-context test accepts only the exact `https://openrouter.ai/api/v1` base URL; lookalike hosts, credentials, query/fragment, HTTP, and trailing-path variants fail before build.

- [ ] **Step 4: Add scripts and a mock-safe environment template**

The existing script entries stay exactly as they are:

```json
{
  "scripts": {
    "verify:openrouter:config": "node scripts/verify-openrouter-models.mjs",
    "verify:openrouter:models": "node scripts/verify-openrouter-models.mjs --remote",
    "predev": "npm run verify:openrouter:config",
    "prebuild": "npm run verify:openrouter:config"
  }
}
```

Task 3 adds no script keys here. If the verifier needs `.env` values when run standalone, add `--env-file-if-exists=.env` inside `scripts/verify-openrouter-models.mjs`'s own invocation contract rather than changing `prebuild`, so `predev`/`prebuild` keep pointing at one name.

`.env.example` is **extended, never replaced**. It is the template for this repository's self-hosted Supabase stack and `scripts/generate-local-secrets.mjs` writes the matching `.env`: `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `ENABLE_GOOGLE_SIGNUP`, `GOOGLE_*`, `SMTP_*`, `OAUTH_MOCK_USER_PASSWORD`, and `GENERATION_REQUEST_HMAC_KEY` are all load-bearing — `compose.yaml` interpolates `${ANON_KEY}`/`${SERVICE_ROLE_KEY}` into the app service, so deleting them breaks the whole local and CI stack. Read the current file and keep every existing key.

Server values such as `SUPABASE_URL=http://kong:8000`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODELS`, and `OPENROUTER_BASE_URL` are supplied by `compose.yaml`'s app service rather than `.env.example`; documenting them here is optional and must not contradict Compose. The only variables Task 3 may need to add are ones this plan actually introduces and something actually reads — see the note below, and drop any that no runtime consumes.

`APP_ORIGIN`, `FAILED_GENERATION_LEDGER_RETENTION_DAYS`, and `VITE_PRIVACY_POLICY_URL` appeared in earlier drafts of this plan but exist nowhere in the codebase — no source file, Compose service, script, or `.env.example` key. They have been removed from this plan's `.env.example` block, CI environment, and production preflight list rather than invented at release time:

- `APP_ORIGIN` duplicated `SERVER_SITE_ORIGIN`, which already carries the canonical origin and is actually read. One name for one value.
- `FAILED_GENERATION_LEDGER_RETENTION_DAYS` is a hardcoded 30-day interval inside the cleanup SQL, not configuration. Task 8 keeps it in SQL; the retention constant stays release-locked there.
- `VITE_PRIVACY_POLICY_URL` has no consumer; the privacy notice is an in-app route.

If a later task genuinely needs one of them, introduce the runtime consumer and the Zod schema entry in the same commit that adds the variable — never a preflight requirement for a variable nothing reads.

The root Compose project has the Plan 1 service named exactly `oauth-mock`, with container origin `http://oauth-mock:8788`, browser origin `http://127.0.0.1:8788`, and `GET /health`. The focused Compose contract test asserts that exact service/healthcheck/port and the app's local provider variables. Environment tests accept these two browser variables only in local/mock mode. A production-context test requires `VITE_AUTH_PROVIDER_MODE=supabase` and rejects `VITE_OAUTH_MOCK_ORIGIN` even if it contains the expected local URL; production can never silently enable the pseudo-provider.

The root `compose.yaml` app/Function environment already carries both deadline controls, and `GENERATION_SYNC_DEADLINE_MS` is already absent repository-wide:

```yaml
FUNCTION_TOTAL_BUDGET_MS: "50000"
AI_PROCESSING_STALE_SECONDS: "180"
```

This part of the task is therefore verification, not migration. Add the focused configuration test that parses the Compose model and asserts both exact values, plus the source scan asserting zero occurrences of `GENERATION_SYNC_DEADLINE_MS` and one canonical runtime read of `FUNCTION_TOTAL_BUDGET_MS`. Both are expected to pass on first run; that is the correct outcome and not a reason to skip writing them, because they are what keeps the obsolete name from returning.

- [ ] **Step 5: Run config, runtime, type, and build checks**

Run:

```bash
docker compose run --rm --no-deps app node --test scripts/verify-openrouter-models.test.mjs
docker compose run --rm --no-deps -e OPENROUTER_MODELS="$LOCAL_MOCK_MODELS" app npm run verify:openrouter:config
docker compose run --rm --no-deps -e OPENROUTER_MODELS=vendor/paid app npm run verify:openrouter:config
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/env.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps -e OPENROUTER_MODELS="$LOCAL_MOCK_MODELS" app npm run build
docker compose config --quiet
docker compose run --rm --no-deps app sh -c \
  'if grep -rn "GENERATION_SYNC_DEADLINE_MS" compose.yaml netlify/functions scripts .env.example; then exit 1; fi'
```

`set -e` / GitHub Actions default `bash -e` must never use `grep …; test "$?" -eq 1`: a no-match `grep` exits 1 and aborts the step before `test` runs. Prefer `if grep …; then exit 1; fi` (match found = fail) so zero matches pass.

Expected: the first two checks and tests pass; the paid-model command exits nonzero with the explicit-free error; the injected abort proves the live metadata request receives one five-second signal and emits only `openrouter_models_unavailable`; the build succeeds with the mock configuration.

- [ ] **Step 6: Commit environment verification**

```bash
git add .env.example compose.yaml scripts/verify-openrouter-models.mjs scripts/verify-openrouter-models.test.mjs package.json package-lock.json netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts
git commit -m "build: verify free OpenRouter models"
```

### Task 4: Enforce safe logging, RLS inventory, and browser security headers

**Files:**
- Modify: `netlify/functions/_shared/logger.ts`
- Modify: `netlify/functions/_shared/logger.test.ts`
- Create: `supabase/tests/database/rls_inventory.test.sql`
- Create: `docs/testing/database-access-matrix.md`
- Modify: `netlify.toml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: every `netlify/functions/*.ts` route handler
- Modify: `src/features/planner/pantry-selector.tsx` (remove inline styles for CSP)
- Modify: `src/shared/ui/wizard/progress-indicator.tsx` (remove dynamic inline width)
- Modify: `src/styles.css` and/or feature CSS as needed for the relocated rules
- Modify: focused tests that assert pantry dialog / progress indicator structure

**Interfaces:**
- Consumes: function result/error codes and actual model IDs from Plans 2–5 and Plan 7 (including `idea_menu_not_supported`, `idea_menu_revalidation_not_supported`, `source_menu_changed`, and `idempotency_payload_mismatch`).
- Produces: allowlisted JSON logs, a dynamic RLS/grant test, SPA routing, security headers, and a production build command with live model verification.

- [ ] **Step 1: Write failing allowlist and RLS tests**

```ts
// netlify/functions/_shared/logger.test.ts
import { describe, expect, it, vi } from "vitest";
import { createSafeLogger } from "./logger";

it("serializes only the approved operational fields", () => {
  const write = vi.fn();
  const logger = createSafeLogger(write);
  logger({
    level: "error",
    requestId: "req-1",
    code: "openrouter_unavailable",
    durationMs: 123,
    modelId: "vendor/model:free",
  });
  expect(JSON.parse(write.mock.calls[0][0])).toEqual({
    level: "error",
    request_id: "req-1",
    code: "openrouter_unavailable",
    duration_ms: 123,
    model_id: "vendor/model:free",
  });
});
```

```sql
-- supabase/tests/database/rls_inventory.test.sql
begin;
select plan(8);
select is_empty(
  $$
    select format('%I.%I', n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  $$,
  'all public user-owned tables enable RLS'
);
select is_empty(
  $$
    select table_schema || '.' || table_name
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'private'
  $$,
  'browser roles have no private schema table grants'
);
select is_empty(
  $$ select n.nspname||'.'||c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
    where n.nspname='public' and c.relkind in('r','p')
      and not exists(select 1 from pg_policy p where p.polrelid=c.oid) $$,
  'every public user-owned table has an explicit policy'
);
select is_empty(
  $$ select table_schema||'.'||table_name||':'||privilege_type
    from information_schema.role_table_grants where grantee='anon'
      and table_schema in('public','private') $$,
  'anon has no application table grant'
);
select * from finish();
rollback;
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/logger.test.ts
docker compose --profile test run --rm db-test supabase/tests/database/rls_inventory.test.sql
```

Expected: the logging test fails until the helper exists; the RLS test reports any earlier policy boundary defect.

Create `docs/testing/database-access-matrix.md` with one row for every public/private table and callable RPC **as the schema stands after Plan 7**, not after Plan 5. Deriving rows from the migrations is what makes this correct, so read the Plan 7 migrations too: `private.generation_regeneration_snapshots` is a private ledger (service-only, no `anon`/`authenticated` grant, no Data API exposure); `private.idea_safety_fingerprint(...)` and `private.is_valid_generation_target_member_ids(...)` are private helpers with no browser-role `EXECUTE`; and every RPC Plan 7 replaced — `set_onboarding_status`, `save_generation_draft` (new arity), `get_ai_generation_submission_snapshot` (`service_role` only), the v2 `reserve_ai_generation`, `finalize_ai_generation_success`, `apply_shopping_draft`, and `apply_shopping_reconciliation` — gets exactly one matrix row carrying the *current* signature. Some of these Plan 7 drops and re-creates (`save_generation_draft`, `reserve_ai_generation`, `get_ai_generation_submission_snapshot`), which discards their grants and restores the default `PUBLIC EXECUTE`; others it replaces in place with re-declared grants. Either way the symmetric comparison below is what proves no stale, default, or over-broad grant survived; a row whose documented signature no longer exists must fail rather than silently match a same-named overload. Columns are `object`, `owner`, `anon`, `authenticated`, `service_role`, `RLS/policy`, and `reason`. Derive the rows from the migrations, not assumptions: catalogs are authenticated `SELECT`; user-owned aggregate roots/children are owner `SELECT` plus only the explicit browser columns; derived inserts and all private ledgers are service-only; anon is `none`; every security-definer RPC records its exact signature and role grant. Add a test-side `expected_access` values CTE generated from this matrix and four `is_empty` assertions that symmetrically compare `information_schema.role_table_grants`, `role_column_grants`, `routine_privileges`, and `pg_policies`, so either an undocumented extra grant/policy or a missing documented one fails. The four generic assertions above plus these four exact comparisons equal `plan(8)`; the exact matrix comparison is the authoritative gate.

- [ ] **Step 3: Implement the closed logging shape**

```ts
// netlify/functions/_shared/logger.ts additions; retain `logGenerationEvent` as a wrapper
export type SafeLogEvent = {
  level: "info" | "warn" | "error";
  requestId: string;
  code: string;
  durationMs: number;
  modelId?: string;
  /** Hourly maintenance only — four aggregate counts, never row IDs. */
  staleReservationsFinalized?: number;
  generationLedgersDeleted?: number;
  shoppingMutationsDeleted?: number;
  authContinuationsDeleted?: number;
};

type LogWriter = (serialized: string) => void;

export const createSafeLogger = (write: LogWriter = console.log) => (event: SafeLogEvent): void => {
  const record: Record<string, string | number> = {
    level: event.level,
    request_id: event.requestId,
    code: event.code,
    duration_ms: event.durationMs,
  };
  if (event.modelId !== undefined) record.model_id = event.modelId;
  if (event.staleReservationsFinalized !== undefined) {
    record.stale_reservations_finalized = event.staleReservationsFinalized;
  }
  if (event.generationLedgersDeleted !== undefined) {
    record.generation_ledgers_deleted = event.generationLedgersDeleted;
  }
  if (event.shoppingMutationsDeleted !== undefined) {
    record.shopping_mutations_deleted = event.shoppingMutationsDeleted;
  }
  if (event.authContinuationsDeleted !== undefined) {
    record.auth_continuations_deleted = event.authContinuationsDeleted;
  }
  write(JSON.stringify(record));
};

export const safeLog = createSafeLogger();
```

Implement Plan 3's `logGenerationEvent(level,event,sink)` as a compatibility wrapper around `createSafeLogger`, mapping `errorCode` to `code` and `null` model IDs to `undefined`. Note this changes the emitted JSON: the current implementation writes camelCase `{requestId,errorCode,durationMs,modelId}` with no `level`, and the new shape is snake_case with `level`. Update the existing `logger.test.ts` assertions in the same commit, and ensure Task 6's `scripts/assert-privacy-logs.mjs` expects the new snake_case field names — a log assertion left on the old camelCase keys would pass vacuously. Replace every production Function `console.*` call — **route handlers and the scheduled `maintenance-cleanup` handler alike** — with `safeLog`. There is no second camelCase log shape for schedules. Task 8 success logs use `code: "maintenance_cleanup"` plus the four optional count fields above; failures use `code: "maintenance_cleanup_failed"` with no counts. Do not pass caught error objects, request bodies, Supabase error messages, prompts, or AI responses. Internal unit tests may inspect errors but production logging code may not.

- [ ] **Step 4: Add Netlify build, SPA fallback, and headers**

Run:

```bash
docker compose run --rm --no-deps app npm install --save-dev --save-exact netlify-cli@26.2.0
```

Commit the resulting lockfile. The CLI is local and reproducible—`npx` network fallback is forbidden.

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "24"

[context.production]
  command = "npm run verify:openrouter:models && npm run build"

[context.deploy-preview]
  command = "npm run build"

[context.branch-deploy]
  command = "npm run build"

# Keep every existing redirect, in its existing order, above the SPA fallback.
[[redirects]]
  from = "/api/emergency-menus"
  to = "/.netlify/functions/emergency-menus"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; form-action 'self'"
    Referrer-Policy = "strict-origin-when-cross-origin"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=()"
```

This is a merge into the existing `netlify.toml`, not a replacement of it. The file already exists with `[build]`, `[build.environment]`, the `/api/emergency-menus` redirect, and the SPA fallback; Task 4 adds the context commands and the headers block and leaves everything else byte-identical. Do not drop the emergency-menus redirect because `emergency-menus.ts` also declares `config.path` — establish why the redirect exists before touching it, and keep it unless that investigation proves it dead. SPA catch-all stays last.

Supabase authentication redirects use top-level navigation and do not require adding Google domains to `connect-src`. If a custom Supabase domain is used, add that exact HTTPS and WSS origin to `connect-src` in the deployment commit.

**CSP vs existing React inline styles (must fix in this Task, not later):**
The header above uses `style-src 'self'` with **no** `'unsafe-inline'`. That is intentional for security, but the current SPA will break under that policy until inline styles are removed:

- `src/features/planner/pantry-selector.tsx` — expired-pantry confirm dialog uses `style={{ position: "fixed", zIndex: 20, inset: 0, … }}` and a second inline `width`/`maxHeight`/`overflow` block.
- `src/shared/ui/wizard/progress-indicator.tsx` — progress fill uses `style={{ width: percentage }}`.

Before enabling the CSP header (or in the same commit as enabling it):

1. Move the pantry dialog chrome into named CSS classes under the existing planner/pantry styles (or a small shared overlay class in `src/styles.css` if used by ≥3 call sites — prefer feature-local first).
2. For the progress bar, prefer a CSS custom property set once on the track (`style={{ ["--progress" as string]: percentage }}` is still an inline style attribute — **avoid** that under strict `style-src 'self'`). Use a discrete set of width utility classes, a `transform: scaleX(...)` with a class, or an SVG/`progress` element whose visual does not need a dynamic inline `width`. If a dynamic value is unavoidable, document an explicit, minimal CSP exception for that single pattern and get human approval — default is **no exception**.
3. Grep `src` for `style={{` and remaining `style=` before merge; zero production hits except any approved exception list.
4. Add a focused unit/component test that the pantry dialog and progress indicator still render without `style` attributes (or only the approved exception).

- [ ] **Step 5: Run security boundary and Netlify build checks**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/logger.test.ts
docker compose --profile test run --rm db-test supabase/tests/database/rls_inventory.test.sql
docker compose run --rm --no-deps -e OPENROUTER_MODELS="$LOCAL_MOCK_MODELS" app npm run build
docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
# Prove the built site would not need unsafe-inline styles under the published CSP:
docker compose run --rm --no-deps app sh -c \
  'if grep -rnE "style=\\{\\{|style=\"" src --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js"; then exit 1; fi'
```

After the offline Netlify build, open `dist/index.html` (or the Netlify publish directory) and confirm `netlify.toml` CSP is the one that would apply to `/*`. Prefer a small Node assertion that parses `netlify.toml` headers and fails if `style-src` contains `unsafe-inline` while any `src/**/*.tsx` still contains `style={{`. Expected: tests pass, no private-schema grant or RLS omission is listed, Vite emits `dist/`, Netlify accepts the configuration, and the SPA has no production inline styles that the CSP would block. The deploy-preview context deliberately uses structural model validation and makes no live Models API call; the production context always performs the remote check.

- [ ] **Step 6: Commit security hardening**

```bash
git add netlify/functions netlify.toml supabase/tests/database/rls_inventory.test.sql docs/testing/database-access-matrix.md package.json package-lock.json
git commit -m "security: enforce logging and deployment boundaries"
```

### Task 5: Add the mobile accessibility regression suite

**Files:**
- Create: `src/test/axe.ts`
- Create: `src/app/accessibility.test.tsx`
- Create: `e2e/specs/mobile-accessibility.spec.ts`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: components reported by the new tests

**Interfaces:**
- Consumes: the completed login, `/welcome`, optional household onboarding, the five-step planner wizard and its review screen, result (both modes), history (both modes), pantry, shopping, and settings routes, plus Plan 7's `e2e/fixtures/auth.ts` as that plan leaves it.
- Produces: automated landmark/name/live-region checks, 320/375/430-pixel layout and target-size checks across both target modes, and one added idea-mode E2E fixture.

- [ ] **Step 1: Add axe-core and write failing route tests**

Run:

```bash
docker compose run --rm --no-deps app npm install --save-dev axe-core
```

Create `src/test/axe.ts` with `runAxe(container: Element): Promise<AxeResults>` that calls `axe.run(container, { rules: { region: { enabled: true } } })` and throws a formatted assertion containing violation IDs and target selectors when `violations.length > 0`.

`src/app/accessibility.test.tsx` renders one representative state for each route and always asserts:

```ts
await expect(runAxe(container)).resolves.toMatchObject({ violations: [] });
expect(screen.getByRole("main")).toBeVisible();
```

Then assert **by route class** — never one shared status regex on every page (most routes have no permanent `role="status"` with 「作成中|保存しました|残り」):

| Route class | Extra assertions |
| --- | --- |
| Login (unauthenticated) | No bottom nav; named Google button; labeled email input; a textual error/live region when an error is shown |
| `/welcome` | No bottom nav; primary 「献立アイデアを考える」; secondary family-setup action; zero same-weight competing primaries |
| Shell routes (planner empty, pantry, history list, shopping empty, settings) | `navigation` named 「メインメニュー」; page `h1`; if a loading or save status is in the representative state, it uses `role="status"` or `role="alert"` with real copy from that feature — do not invent a global status string |
| Wizard steps | Each of `meal`, `ingredients`, `cuisine`, `audience`, `review` as its own state; step heading focusable; primary/secondary controls have accessible names |
| Audience with zero members | Family mode disabled, idea mode selectable, family-registration link present |
| Review (household / idea) | Idea review shows 「家族の年齢・アレルギーは確認されません」; generate control named 「献立を作る」 |
| Generation processing | Heading or status exposes 「献立を作っています」 (or the panel's live status text) |
| Result / history detail | Household may show shopping and safety regions; idea always shows 「家族条件を使用していません」 and **no** shopping control, family-adaptation region, or label-confirmation region in the tree (not merely disabled) |

Cover each wizard step plus the zero-member audience and both review modes. An idea surface must not merely disable forbidden controls — they must be absent from the accessibility tree.

- [ ] **Step 2: Run the component accessibility test and capture violations**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

Expected: FAIL until missing labels, landmarks, focus behavior, and live regions are corrected.

- [ ] **Step 3: Write the failing mobile Playwright checks**

`e2e/fixtures/auth.ts` is already reshaped for the optional-household flow. Read it: `authenticatedPage` ends on `/welcome` after a root re-entry; `completedOnboardingPage` completes family setup **and** privacy consent. Do not restore old onboarding consent order. Add only `ideaModePage`, leaving both existing fixtures untouched.

```ts
// e2e/fixtures/auth.ts — add only this fixture
// ideaModePage requires onboarding_status still not_started when /welcome is opened.
// Primary copy is 「献立アイデアを考える」(not_started). in_progress uses
// 「設定せず献立アイデアを考える」— do not use ideaModePage after in_progress.
ideaModePage: async ({ authenticatedPage: page }, use) => {
  await page.goto("/welcome");
  await page.getByRole("button", { name: "献立アイデアを考える" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/planner");
  await use(page);
},
```

After `ideaModePage` runs, status is `skipped` and `/welcome` redirects to `/planner`. Measure `/welcome` only with raw `authenticatedPage`.

**Locked E2E contracts (do not re-derive — copy from live helpers):**

| Contract | Source of truth |
| --- | --- |
| Wizard next | `clickWizardNext` in `e2e/fixtures/history.ts` (DOM `el.click()` — bottom-nav steals Playwright pointer clicks) |
| Meal radio for mock success | **`朝食` only** — `tools/openrouter-mock` success fixture is `mealType: "breakfast"`; validator rejects meal mismatch (`history.ts` / `shopping.ts` comments) |
| 44px targets | Plan 7: **primary/secondary `button` height only** — never require 44×44 on native `radio`/`checkbox`/`textbox` |
| Household members | `completedOnboardingPage` leaves eligible member auto-selected; accessible name is `家族1（…）` when display_name is null — **do not** use `/^おとな/` |
| Privacy hop | If generate disabled: privacy confirm → `/planner` → **`page.reload()`** then assert heading `5. 確認` (stale draft cache known issue) |

```ts
// e2e/specs/mobile-accessibility.spec.ts
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { clickWizardNext } from "../fixtures/history";

const assertNoHorizontalScroll = async (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);

/**
 * Plan 7 contract: major action buttons' height ≥ 44. Native radios/checkboxes are out of scope.
 * Never silently skip a missing name — that turns a missing primary control into a false green.
 * Callers pass only buttons that **must** exist in the current route × mode × step; use
 * `assertMajorActionHeights(page, { "次へ": 1 })` form when a single instance is required.
 */
const assertMajorActionHeights = async (
  page: Page,
  required: Readonly<Record<string, number>>,
) => {
  for (const [name, expectedCount] of Object.entries(required)) {
    const control = page.getByRole("button", { name });
    await expect(control, `missing required control: ${name}`).toHaveCount(expectedCount);
    for (let index = 0; index < expectedCount; index += 1) {
      const box = await control.nth(index).boundingBox();
      expect(box, `${name}[${String(index)}] box`).not.toBeNull();
      expect(box?.height, `${name}[${String(index)}] height`).toBeGreaterThanOrEqual(44);
    }
  }
};

/** Per-step required majors — do not pass a union of every wizard button on every step. */
const assertStepFits = async (
  page: Page,
  requiredMajors: Readonly<Record<string, number>>,
) => {
  await assertNoHorizontalScroll(page);
  await assertMajorActionHeights(page, requiredMajors);
};

const answerSharedWizardSteps = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "1. 食事" })).toBeVisible();
  await page.getByRole("radio", { name: "朝食" }).check();
  // meal step: 次へ required after selection
  await assertStepFits(page, { 次へ: 1 });
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "2. メイン食材" })).toBeVisible();
  await page.getByRole("textbox", { name: "メイン食材" }).fill("鶏肉");
  await assertStepFits(page, { 追加: 1, 次へ: 1 });
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "3. ジャンル" })).toBeVisible();
  await page.getByRole("radio", { name: "和食" }).check();
  await assertStepFits(page, { 次へ: 1 });
  await clickWizardNext(page);
};

const answerAudienceAndReview = async (page: Page, mode: "household" | "idea") => {
  await expect(page.getByRole("heading", { name: "4. 作る相手" })).toBeVisible();
  if (mode === "idea") {
    await page.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }).check();
    await page.getByRole("button", { name: "2人" }).click();
    await assertStepFits(page, { "2人": 1, 次へ: 1 });
  } else {
    // completedOnboardingPage: one eligible adult, default-selected as 家族1 — do not re-check.
    await page.getByRole("radio", { name: "家族に合わせて作る" }).check();
    await expect(page.getByRole("checkbox", { name: /家族1/u })).toBeChecked();
    await assertStepFits(page, { 次へ: 1 });
  }
  await clickWizardNext(page);

  await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible();
  if (mode === "idea") {
    await expect(page.getByText("家族の年齢・アレルギーは確認されません")).toBeVisible();
  }
  // review may show 献立を作る disabled until privacy; still require the control to exist
  await assertMajorActionHeights(page, { "献立を作る": 1 });
};

/**
 * completedOnboardingPage already has privacy; ideaModePage does not.
 * After privacy return, reload is mandatory (same as history.ts seedGeneratedIdeaMenu).
 */
const ensurePrivacyThenGenerate = async (page: Page, needsPrivacyHop: boolean) => {
  const generate = page.getByRole("button", { name: "献立を作る" });
  if (needsPrivacyHop) {
    await expect(generate).toBeDisabled();
    await page.getByRole("button", { name: "AI情報の説明を見る" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/privacy");
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/planner");
    await page.reload();
    await expect(page.getByRole("heading", { name: "5. 確認" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(generate).toBeEnabled({ timeout: 15_000 });
  await generate.click();
  await expect(page.getByRole("heading", { name: "献立ができました" })).toBeVisible({
    timeout: 60_000,
  });
};

for (const width of [320, 375, 430]) {
  test(`the household wizard and result fit ${width}px with usable targets`, async ({
    completedOnboardingPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/planner");
    await assertNoHorizontalScroll(page);
    await answerSharedWizardSteps(page);
    await answerAudienceAndReview(page, "household");
    await ensurePrivacyThenGenerate(page, false);
    await assertNoHorizontalScroll(page);
    // result surface (household success): live CTA from generation/history E2E
    await assertMajorActionHeights(page, { "これに決めた": 1 });
  });

  test(`the start screen fits ${width}px with usable targets`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/welcome");
    await assertNoHorizontalScroll(page);
    await assertMajorActionHeights(page, {
      "献立アイデアを考える": 1,
      "家族情報を登録する": 1,
    });
  });

  test(`the idea wizard and result fit ${width}px with usable targets`, async ({ ideaModePage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await answerSharedWizardSteps(page);
    await answerAudienceAndReview(page, "idea");
    await ensurePrivacyThenGenerate(page, true);
    await expect(page.getByText("家族条件を使用していません")).toBeVisible();
    await assertNoHorizontalScroll(page);
    await assertMajorActionHeights(page, { "これに決めた": 1 });
  });
}
```

Assert horizontal fit **at every wizard step**. Prefer importing `clickWizardNext` over duplicating it.

**Locked copy:** meal **`朝食`** (mock), cuisine `和食`, ingredients free-text + `追加` exact, audience radios as above, servings `N人`, generate `献立を作る`, result `献立ができました`, idea notices as above, privacy hop + **reload**.

- [ ] **Step 4: Correct shared UI primitives, focus, and status announcements**

Centralize fixes in whatever shared primitives actually exist at that point. `src/shared/ui/` currently holds only `placeholder-page.tsx` and Plan 7's `wizard/` directory (`wizard-frame`, `choice-card`, `progress-indicator`, `inline-notice`, `review-row`) — there is no `button.tsx`, `field.tsx`, `dialog.tsx`, or `toast.tsx` to centralize into. Fix Plan 7's wizard primitives and the app shell first, and extract a new shared primitive only when the same violation appears in three or more feature components; do not create a speculative design-system layer as part of an accessibility fix. Plan 7 Task 1 owns the wizard primitives' own ARIA/keyboard/focus contract, so changes there must keep its tests green rather than restate them. On route changes, move programmatic focus to the page `h1` with `tabIndex={-1}`. Loading updates use `role="status" aria-live="polite"`; validation and request failures use `role="alert"`; icon-only actions have Japanese accessible names; color is never the only error or selection cue. Do **not** force native radio/checkbox boxes to 44×44 CSS px to satisfy a bad measurement — fix the test contract first (Step 3).

- [ ] **Step 5: Run accessibility, mobile, and visual-layout checks**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
./scripts/run-e2e.sh e2e/specs/mobile-accessibility.spec.ts
docker compose run --rm --no-deps app npm run typecheck
```

Expected: axe reports zero violations in covered states; all three widths have no horizontal overflow; major-action height assertions and type checking pass.

- [ ] **Step 6: Commit accessibility hardening**

```bash
git add package.json package-lock.json src e2e/specs/mobile-accessibility.spec.ts e2e/fixtures/auth.ts
git commit -m "test: enforce mobile accessibility"
```

### Task 6: Complete adversarial and end-to-end acceptance coverage

**Files:**
- Create: `docs/testing/acceptance-matrix.md`
- Create: `e2e/specs/account-deletion.spec.ts`
- Create: `e2e/specs/full-journey.spec.ts`
- Create: `e2e/specs/auth-callback-security.spec.ts`
- Create: `e2e/fixtures/acceptance.ts`
- Create: `scripts/assert-privacy-logs.mjs`
- Create: `scripts/assert-privacy-logs.test.mjs`
- Create: `docs/testing/google-oauth-staging.md`
- Create: `scripts/verify-release-evidence.mjs`
- Create: `scripts/verify-release-evidence.test.mjs`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `scripts/run-e2e.sh`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tools/openrouter-mock/server.mjs`
- Add fixtures under: `tools/openrouter-mock/fixtures/adversarial/`

Install `pg` in **this** task (before any acceptance E2E that queries private tables). Do not wait for Task 8:

```bash
docker compose run --rm --no-deps app npm install --save-exact pg@8.22.0
docker compose run --rm --no-deps app npm install --save-dev --save-exact @types/pg@8.20.0
```

**Interfaces:**
- Consumes: all 22 acceptance criteria in the approved MVP design, the 8 success conditions in `docs/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md` §3.2, and every test added by Plans 1–5 and Plan 7.
- Produces: a one-to-one acceptance matrix over both criteria sets, Node-only service-role/DB-count fixtures, sanitized Function-log capture, final cross-feature journey tests in both target modes, deletion proof, deterministic OAuth callback/state coverage, an external same-SHA Google evidence verifier, and a fixed adversarial AI corpus.

- [ ] **Step 1: Inventory acceptance coverage before adding tests**

Create `docs/testing/acceptance-matrix.md` with two tables. The first is the MVP table with exactly 22 rows, unchanged in count and numbering. The second is a guided-planner table with exactly 8 rows, one per success condition in the Plan 7 design's §3.2 (household-free end-to-end completion, the fixed four-question order, the pre-generation review including whether safety conditions are used, answer survival across back/consent/disconnection, full retention of household-mode safety checks, idea mode never presented as family-safety-confirmed, 320-pixel/44-pixel compliance, and WCAG 2.1 AA contrast for body/supporting text and primary buttons). The whole-plan rule below is therefore 22/22 **and** 8/8; do not merge, renumber, or absorb guided-planner rows into the MVP 22. Each row in either table contains the criterion number, behavior, owning automated test file and exact test title, and test layer. A row may cite multiple tests, and a guided-planner row may cite a test Plan 7 already owns rather than duplicating it. The only non-local exception is real Google-provider success: its row cites deterministic automated PKCE/state/callback tests plus an external JSON artifact verified for the release candidate. The artifact is stored outside the repository and has exactly these fields: `candidateSha`, Netlify `stagingDeployId`, authoritative `stagingDeploySha`, ISO `executedAt`, ISO `expiresAt` exactly 24 hours later, non-email `tester`, HTTPS origin-only `stagingOrigin`, `startScreen: "login"`, `stateMatched: true`, `originalBrowserCallbackCompleted: true`, `tokenFreeResult: true`, and `passed: true`. It contains no account identifier, email, authorization code, continuation secret, PKCE verifier, access/refresh token, screenshot, or raw log. No other row may say “manual only”. Production secret configuration and post-deploy reachability cite Task 8's automated preflight, authoritative current-production-deploy verifier, and smoke scripts; a smoke result without both surrounding metadata checks is not evidence.

Write `verify-release-evidence.mjs` and its Node tests before documenting a pass. The CLI accepts the external artifact path, obtains the candidate with `execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"})`, and reads Netlify's authoritative deploy metadata for `stagingDeployId` from `GET https://api.netlify.com/api/v1/deploys/:id` using a protected release-runner `NETLIFY_AUTH_TOKEN` that is never configured as a site/build variable. It strictly validates the exact schema above, rejects unknown/sensitive keys recursively and email/token/code/verifier-like values, requires `candidateSha === stagingDeploySha === metadata.commit_ref === HEAD`, requires metadata `id` and deploy URL (`ssl_url` or `deploy_ssl_url`) to match the artifact's deploy ID after HTTPS-origin normalization (strip trailing slash/path), and requires unexpired evidence with `expiresAt = executedAt + 24h`. It prints only `google_oauth_evidence: pass` or a safe field/error code. The artifact's SHA/origin is never accepted as a self-assertion without that metadata readback. Tests inject clock/fetch and cover wrong local/artifact/metadata SHA, deploy-ID/origin mismatch, missing/extra fields, false booleans, future execution, expired or non-24-hour evidence, non-HTTPS/path-bearing origin, email-shaped tester, and forbidden sensitive material. `docs/testing/google-oauth-staging.md` is an instruction/template only; neither the actual JSON nor a copied result is committed.

```js
// scripts/verify-release-evidence.mjs
// Use Zod 4 APIs already used in shared/contracts (z.iso.datetime, z.url).
import {execFileSync} from "node:child_process";
import {readFileSync,realpathSync} from "node:fs";
import {sep} from "node:path";
import {z} from "zod";

/** Normalize Netlify deploy_ssl_url / artifact origin to bare HTTPS origin (no trailing slash/path). */
export function httpsOriginOnly(value){
  const parsed=new URL(value);
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.search||parsed.hash){
    throw new Error("staging_origin_invalid");
  }
  return parsed.origin; // never ends with /
}
const origin=z.string().refine((value)=>{
  try{return httpsOriginOnly(value)===new URL(value).origin&&!value.endsWith("/");}
  catch{return false;}
},"staging_origin_invalid");
export const googleOauthEvidenceSchema=z.object({
  candidateSha:z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  stagingDeployId:z.string().regex(/^[0-9a-f]{24}$/u),
  stagingDeploySha:z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  executedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),
  tester:z.string().trim().min(1).max(80)
    .refine((value)=>!/(?:@|token|code|verifier|secret|bearer)/iu.test(value),
      "tester_identifier_invalid"),
  stagingOrigin:origin,startScreen:z.literal("login"),stateMatched:z.literal(true),
  originalBrowserCallbackCompleted:z.literal(true),tokenFreeResult:z.literal(true),
  passed:z.literal(true),
}).strict();
// Netlify field is ssl_url on some payloads and deploy_ssl_url on others — accept either, compare origins.
const deployMetadataSchema=z.object({
  id:z.string(),commit_ref:z.string(),
  ssl_url:z.string().optional(),deploy_ssl_url:z.string().optional(),
}).passthrough().refine((m)=>Boolean(m.ssl_url||m.deploy_ssl_url),"staging_url_missing");
export function verifyGoogleOauthEvidence(value,{head,deployMetadata,now}){
  const evidence=googleOauthEvidenceSchema.parse(value);
  const metadata=deployMetadataSchema.parse(deployMetadata);
  if(metadata.id!==evidence.stagingDeployId)throw new Error("staging_deploy_id_mismatch");
  const metaOrigin=httpsOriginOnly(metadata.ssl_url??metadata.deploy_ssl_url);
  if(metaOrigin!==httpsOriginOnly(evidence.stagingOrigin))throw new Error("staging_origin_mismatch");
  if(evidence.candidateSha!==head.trim()||evidence.stagingDeploySha!==head.trim()||
    metadata.commit_ref!==head.trim())throw new Error("candidate_sha_mismatch");
  const executed=Date.parse(evidence.executedAt),expires=Date.parse(evidence.expiresAt);
  if(expires-executed!==86_400_000)throw new Error("evidence_expiry_invalid");
  if(executed>now.getTime()+300_000)throw new Error("evidence_time_invalid");
  if(now.getTime()>expires)throw new Error("evidence_expired");
  return evidence;
}
/**
 * Transport seam for Netlify metadata. Pure unit tests inject `{fetchImpl, now, head, readFile}`.
 * CLI spawn tests cannot reach a default `fetch` closed over in the module without a seam —
 * use one of the two deterministic options below (pick one, document it, test both unit and spawn).
 *
 * Option A (preferred): env-gated mock module path for child processes only.
 *   KONDATE_RELEASE_EVIDENCE_FETCH_MODULE=/abs/path/to/mock-fetch.mjs
 *   That module default-exports `(url, init) => Promise<Response>`.
 * Option B: optional second CLI arg `--fetch-fixture=/abs/path/to/deploy.json` that
 *   short-circuits Netlify HTTP and feeds deploy metadata from disk (production CLI forbids
 *   this unless CONTEXT is unset / test; production runner never sets the flag).
 */
export async function main(
  path=process.argv[2],
  env=process.env,
  {
    fetchImpl=fetch,
    now=()=>new Date(),
    revParseHead=()=>execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}),
    revParseTopLevel=()=>execFileSync("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}),
    readEvidence=(p)=>readFileSync(p,"utf8"),
  }={},
){
  if(path===undefined)throw new Error("evidence_path_required");
  const root=realpathSync(revParseTopLevel().trim());
  const evidencePath=realpathSync(path);
  if(evidencePath===root||evidencePath.startsWith(`${root}${sep}`)){
    throw new Error("evidence_must_be_external");
  }
  // Child-process inject: dynamic import only when env points outside the repo or to a tmp file.
  let resolvedFetch=fetchImpl;
  if(env.KONDATE_RELEASE_EVIDENCE_FETCH_MODULE){
    const mod=await import(env.KONDATE_RELEASE_EVIDENCE_FETCH_MODULE);
    resolvedFetch=mod.default??mod.fetchImpl;
    if(typeof resolvedFetch!=="function")throw new Error("fetch_module_invalid");
  }
  const value=JSON.parse(readEvidence(evidencePath));
  const head=revParseHead();
  const parsed=googleOauthEvidenceSchema.parse(value);
  if(!env.NETLIFY_AUTH_TOKEN)throw new Error("netlify_auth_required");
  const response=await resolvedFetch(
    `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(parsed.stagingDeployId)}`,
    {headers:{authorization:`Bearer ${env.NETLIFY_AUTH_TOKEN}`},
      signal:AbortSignal.timeout(5_000)},
  );
  if(!response.ok)throw new Error("staging_metadata_unavailable");
  verifyGoogleOauthEvidence(parsed,{head,deployMetadata:await response.json(),now:now()});
  process.stdout.write("google_oauth_evidence: pass\n");
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],"file:").href){
  main().catch((error)=>{
    const code=error instanceof Error&&/^[a-z_]+$/u.test(error.message)
      ?error.message:"release_evidence_invalid";
    process.stderr.write(`${code}\n`);process.exitCode=1;
  });
}
```

The executable guard catches every error, emits only a closed code (never Zod input, deploy metadata, token, or file content), and exits nonzero.

**Tests (two layers — both required):**

1. **Unit:** call `verifyGoogleOauthEvidence` and `main(..., { fetchImpl, now, revParseHead, readEvidence })` with injected deps — no network, no `spawn`.
2. **CLI spawn:** write evidence JSON outside the repo; write a tiny mock fetch module (or fixture file if Option B); run

```bash
docker compose run --rm --no-deps \
  -e NETLIFY_AUTH_TOKEN=test-token \
  -e KONDATE_RELEASE_EVIDENCE_FETCH_MODULE=/workspace/tmp/mock-netlify-fetch.mjs \
  app node scripts/verify-release-evidence.mjs /tmp/evidence-outside-repo.json
```

assert stdout `google_oauth_evidence: pass` and that a repository-local evidence path exits nonzero with `evidence_must_be_external`. Do **not** claim “spawn with mock fetch” without this env (or `--fetch-fixture`) inject point — a bare `spawn` always hits real `fetch`.

- [ ] **Step 2: Add deterministic adversarial fixtures**

Add one complete mock response for each case: direct allergen, allergen alias, processed food needing label confirmation, unsafe child shape, senior texture adaptation, unsupported medical/therapeutic request, missing portion branch, over-time timeline, must-use pantry omission, unavailable pantry quantity, duplicate whole regeneration, duplicate dish regeneration, malformed JSON, and valid fallback-model response. Extend Plan 3's existing `X-Kondate-Mock-Scenario` protocol; the production client sends that header only when its configured base URL is non-OpenRouter and `OPENROUTER_MOCK_SCENARIO` is set. Production deployment never defines that variable.

- [ ] **Step 3: Write failing full-journey and privacy tests**

Neither fixture may shell out to `docker`. Playwright runs inside the `e2e` Compose service, which has no Docker socket and no `docker` CLI — the same constraint CLAUDE.md documents for `app`. Acceptance fixtures below are written against what the `e2e` container actually has: `network_mode: host`, the repository mounted at `/workspace`, and the published service ports.

**Function privacy logs are a host post-run assertion — never a Playwright in-test read.** Playwright finishes before `run-e2e.sh` cleanup; a file written only in cleanup is not visible mid-test.

1. After the Playwright process exits (success or failure), and **before** `docker compose down`, `run-e2e.sh` writes `docker compose logs --no-color app` to a gitignored path (default `.e2e-function.log` at the worktree root). Host-issued `docker compose logs` is legitimate here.
2. When the env var `KONDATE_ASSERT_PRIVACY_LOGS=1` is set (CI and the Task 6 verification command), `run-e2e.sh` then runs:

```bash
docker compose run --rm --no-deps app node scripts/assert-privacy-logs.mjs .e2e-function.log
```

3. `scripts/assert-privacy-logs.mjs` (and its Node tests) assert that names, synthetic test emails (`@example.invalid`), allergy free text, planner notes, prompt markers, and raw mock response strings are absent, while `request_id` / `code` / `duration_ms` / optional `model_id` (Task 4 snake_case `safeLog` shape) are present for generation traffic. Idea-journey runs must show no family identifier / member UUID payload in the log surface. Plan 7 Task 8 owns the exhaustive family-canary matrix; this script only covers the Function log surface.
4. Add `.e2e-function.log` to `.gitignore`. Do **not** create `e2e/specs/privacy-logging.spec.ts` or `e2e/fixtures/function-logs.ts` as the primary gate — they encourage false reds.

Do not reintroduce a `docker` call inside the `e2e` container.

Create `e2e/fixtures/acceptance.ts` as a Node-side extension of the auth fixture. It reads **`SERVICE_ROLE_KEY`** from `/workspace/.env` — that is the actual key name in `.env`/`.env.example`; `SUPABASE_SERVICE_ROLE_KEY` is only the name Compose maps it to inside the app container, and the `e2e` service declares no such environment — and creates a non-persisting admin client for `http://127.0.0.1:8000`. It exports `queryOwnedCounts(userId)`, which validates `userId` with Zod and connects to Postgres **directly with `pg`** at `127.0.0.1:54322` (published by `infra/supabase.override.yaml` and reachable because `e2e` uses host networking), querying every `public`/`private` base table containing `user_id` and returning `{table,count}` JSON without printing row values. A direct connection is required rather than PostgREST because `private` tables are deliberately not exposed to the Data API. Close the client in a `finally`. `seedCompleteOwnedGraph(page)` uses the existing onboarding, pantry, generation, revalidation, regeneration, and shopping fixture helpers, creates a generated menu targeting both a toddler and a senior with processed-food confirmation coverage, proves at least one normalized `menu_safety_actions` row was produced by Plans 2–3, and leaves a fresh planner draft. It must also seed the Plan 7 surface, because a cascade is only proven for rows that exist: at least one `target_mode = 'idea'` menu alongside the household one, and at least one row in `private.generation_regeneration_snapshots` from a completed regeneration reservation. Assert both are non-zero before deletion and zero after, so the snapshot's cascade through `private.ai_generation_requests` to `auth.users` is exercised rather than assumed. The idea menu also proves the deletion path does not depend on non-empty `menu_target_members`. Before deletion, assert only a named `requiredNonEmptyFamilies` set (profile/household/privacy, pantry/draft, menu/dish/action/confirmation, history/revalidation, shopping) has positive counts; idempotency ledgers and other optional tables may legitimately remain zero. No service-role value enters `page`, browser storage, screenshots, or logs.

`full-journey.spec.ts` covers two journeys. **Import** Task 5 locked helpers (`clickWizardNext`, meal **`朝食`**, privacy hop + **reload**, major-action 44px rules) and/or reuse `e2e/fixtures/history.ts` / `seedGeneratedIdeaMenu` rather than inventing parallel flows. The household journey is login fixture → `/welcome` → resumable household setup → wizard questions → review (including **must/prefer pantry selection on the review step**, not a separate post-review screen) → privacy hop only if still required (with reload) → full generation and recovery → timeline and dish tabs → label confirmation → whole and dish regeneration → accept → history group → shopping creation and approved reconciliation. The idea journey is login fixture → `/welcome` → 「献立アイデアを考える」 → shared steps with audience 「人数だけ指定してアイデアを見る」 and explicit servings → review notice → privacy + reload → generation → result with 「家族条件を使用していません」 → history idea surfaces → mode-preserving regeneration → accept and favourite. The idea journey asserts zero shopping network requests, zero `kondate:shopping:*` storage keys, and no `child_friendly` regeneration reason; it never converts to household mode.

Privacy log assertions run via `scripts/assert-privacy-logs.mjs` after full-journey (and account-deletion) Playwright completes — see the host post-run contract above. When verifying Task 6 alone, invoke:

```bash
KONDATE_ASSERT_PRIVACY_LOGS=1 ./scripts/run-e2e.sh e2e/specs/full-journey.spec.ts e2e/specs/account-deletion.spec.ts
```

`account-deletion.spec.ts` creates a dedicated test user with the named required aggregate families, opens Plan 1's `/settings`, first proves the existing member edit/allergy/dislike controls are still present, then opens the composed Plan 6 danger zone and performs the exact-phrase flow. It verifies redirect to the login message, verifies the old access token receives `401`, and uses the service-role test fixture to assert zero Auth user and zero rows across every inventoried owned table—including tables whose pre-delete count was zero.

```ts
const before=await queryOwnedCounts(userId);
const requiredNonEmptyFamilies=new Set([
  "public.profiles","public.household_members","public.privacy_consents",
  "public.pantry_items","public.generation_drafts","public.menus","public.dishes",
  "public.menu_member_adaptations","public.menu_safety_actions",
  "public.menu_label_confirmations","public.menu_revalidations",
  "public.shopping_lists","public.shopping_items","public.shopping_label_confirmations",
  "private.generation_regeneration_snapshots",
]);
for(const table of requiredNonEmptyFamilies){
  expect(before.find((row)=>row.table===table)?.count,`${table} must be seeded`).toBeGreaterThan(0);
}
await deleteThroughSettings(page);
const authLookup=await admin.auth.admin.getUserById(userId);
expect(authLookup.data.user).toBeNull();expect(authLookup.error).not.toBeNull();
expect(await queryOwnedCounts(userId)).toEqual(before.map(({table})=>({table,count:0})));
const rejected=await page.request.get("/api/usage/today",{headers:{authorization:`Bearer ${oldToken}`}});
expect(rejected.status()).toBe(401);
```

Add `e2e/specs/auth-callback-security.spec.ts`: create a local PKCE attempt, assert the matching state reaches the deterministic callback exchange stub once in the original browser, then assert unknown state, mismatched state, reused continuation, reused code, and `AUTH_CONTINUATION_TTL_SECONDS=300` expiry all fail with the safe retry copy and erase transient code/state. Google cancel remains automated. Real Google success is executed only in staging from `startScreen: "login"` on the exact release candidate. The operator obtains `stagingDeployId` and `stagingDeploySha` from Netlify deploy metadata—not typed memory—sets `expiresAt` to exactly 24 hours after `executedAt`, writes the external JSON artifact, and runs `node scripts/verify-release-evidence.mjs "$GOOGLE_OAUTH_RELEASE_EVIDENCE"` with `NETLIFY_AUTH_TOKEN` before expiry and before tag/deploy.

- [ ] **Step 4: Run the new tests and verify the expected failures**

Run:

```bash
KONDATE_ASSERT_PRIVACY_LOGS=1 ./scripts/run-e2e.sh e2e/specs/full-journey.spec.ts e2e/specs/account-deletion.spec.ts e2e/specs/auth-callback-security.spec.ts
```

Expected: FAIL on every missing cross-feature fixture or behavior; failures identify a route, scenario, or leaked test marker.

- [ ] **Step 5: Fix only the surfaced integration gaps and complete the matrix**

Update product files where a failing acceptance test proves a gap, including surfaces owned by **Plans 1–5 and Plan 7** (welcome, wizard, idea result/history, mode-aware generation, settings composition). Stay within existing ownership boundaries: fix wiring, a11y, copy consistency, cascade, and logging holes — do **not** add new product modes, reopen locked contracts (`TargetMode`, HMAC v2, shopping idea reject codes), or invent features outside the approved designs. Add the exact final test title to its matrix row after the test passes. Do not weaken safety fixtures, replace assertions with snapshots, or skip an acceptance criterion.

- [ ] **Step 6: Run the complete deterministic test suite**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm app npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
docker compose run --rm --no-deps app node --test scripts/verify-release-evidence.test.mjs
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
```

Expected: unit/component/adversarial, pgTAP, and all Playwright tests report zero failures without contacting OpenRouter.

- [ ] **Step 7: Commit the acceptance suite**

```bash
git add docs/testing e2e tools/openrouter-mock src netlify/functions shared supabase \
  scripts/run-e2e.sh scripts/assert-privacy-logs.mjs scripts/assert-privacy-logs.test.mjs \
  scripts/verify-release-evidence.mjs scripts/verify-release-evidence.test.mjs \
  .gitignore package.json package-lock.json
git commit -m "test: cover Kondate acceptance journeys"
```

### Task 7: Add deterministic GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/ci.sh`
- Modify: `playwright.config.ts`
- Verify: `scripts/generate-local-secrets.sh`

**Interfaces:**
- Consumes: the root Compose project and all scripts established in Plans 1–6.
- Produces: one required `verify` job with artifacts on failure and no real OpenRouter traffic.

- [ ] **Step 1: Add a local CI aggregate and prove it stops on failure**

The aggregate cannot be an npm script. It has to issue `docker compose` commands, so it cannot run inside `app` (no Docker socket); and running it on the host would require host Node, which this repository deliberately does not assume. Add a host shell script instead — `scripts/ci.sh` — that mirrors the workflow steps in order:

```bash
#!/usr/bin/env bash
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
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
docker compose run --rm --no-deps app npm run build
docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
```

`set -e` gives the stop-on-first-failure behavior the npm `&&` chain provided. Add an `EXIT` trap for teardown in the same task as Task 8's extensions. The workflow keeps its steps enumerated rather than calling this script, so a failure names the failing gate in the GitHub UI; a source test asserts the two stay in the same order.

Run `./scripts/ci.sh` once with a deliberate failing focused test, verify later commands do not run, then revert that deliberate test change.

- [ ] **Step 2: Create the workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    env:
      CI: "true"
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - name: Generate ephemeral local secrets
        run: ./scripts/generate-local-secrets.sh
      - name: Assert the canonical local continuation origin
        run: |
          set -a; . ./.env; set +a
          test "$SERVER_SITE_ORIGIN" = "http://127.0.0.1:5173"
          test "$VITE_AUTH_PROVIDER_MODE" = "oauth_mock"
          test "$VITE_OAUTH_MOCK_ORIGIN" = "http://127.0.0.1:8788"
      - run: docker compose config --quiet
      - run: docker compose up -d --wait
      - run: curl --fail --silent --show-error http://127.0.0.1:8788/health
      - run: docker compose run --rm --no-deps app npm run format:check
      - run: docker compose run --rm --no-deps app npm run lint
      - run: docker compose run --rm --no-deps app npm run typecheck
      - run: docker compose run --rm --no-deps app npx vitest run
      - run: docker compose --profile test run --rm db-test
      - name: Verify public and private generated database types
        run: |
          docker compose run --rm app npm run db:types
          git diff --exit-code -- src/shared/types/database.generated.ts
      - run: ./scripts/run-e2e.sh
      - run: docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
      - run: docker compose run --rm --no-deps app npm run build
      - run: docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-report
          path: playwright-report
          if-no-files-found: ignore
      - name: Show container health on failure
        if: failure()
        run: docker compose ps
      - name: Tear down and remove ephemeral secrets
        if: always()
        run: |
          docker compose down --volumes
          rm -f .env
```

The job carries no `env:` block beyond `CI`. Every runtime value comes from the `.env` that `generate-local-secrets.sh` writes, and Compose interpolates it into each service. This is deliberate: a job-level `env:` entry becomes a shell variable that **wins over `.env`** during interpolation, so an earlier draft's hardcoded `AUTH_CONTINUATION_ENCRYPTION_KEY` silently replaced the generated ephemeral key while `GENERATION_REQUEST_HMAC_KEY` stayed generated — two keys of the same kind with different provenance. One source of truth removes that class of bug, and the origin assertion now sources `.env` so it verifies the generated file instead of restating a literal it just set itself.

There is no `actions/setup-node` and no host `npm ci`: dependencies live in the image and the `node_modules` volume, and every Node command is container-routed. The runner needs only Docker, `git`, and `curl`.

`npm run db:types` runs `scripts/generate-database-types.sh`, which reads pg-meta at `?included_schemas=public,private`; it does not use the Supabase CLI's `--schema` flag. It is run **with** the stack up and without `--no-deps`, because `meta` publishes no host port and is reachable only from inside the Compose network — this is why the plan never runs it on the host. The source-level script test therefore asserts that **that** URL keeps both schemas, not that a `--schema public,private` argument is present. Do not rewrite the generator to the CLI form just to match a phrase in this plan: the committed `database.generated.ts` was produced by pg-meta, and swapping generators would produce formatting drift that fails `git diff --exit-code` for reasons unrelated to schema changes. `generate-local-secrets.sh` runs first, before any Compose interpolation, and needs no host Node of its own. It creates only the gitignored `.env`, and the `always()` cleanup removes it even after a failed start/test. CI's explicit `SERVER_SITE_ORIGIN` remains Plan 1's canonical `http://127.0.0.1:5173`; the assertion fails before E2E if the shell environment overrides the generated file with a different continuation origin. The offline Netlify build does not change that local runtime origin. E2E runs through `./scripts/run-e2e.sh`, never a bare `npm run e2e`/`playwright test` on the runner. That wrapper is the project's only supported entry point: it resolves the Compose project name, drives the dedicated `e2e` Compose service, holds a lock against concurrent runs, and restores the normal dev stack on success, failure, and interrupt alike. Because Playwright runs inside that container, CI installs no host browser — drop any `playwright install` step — and the container, not the runner, owns the browser version.

Do not upload database volumes, `.env`, traces containing typed household data, or Function log files. Configure Playwright screenshots, video, and traces as `retain-on-failure`; E2E fixtures use synthetic names and conditions only.

- [ ] **Step 3: Validate workflow syntax and reproduce its commands locally**

Run:

```bash
docker compose up -d --wait
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
docker compose --profile test run --rm db-test
docker compose run --rm app npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
docker compose run --rm --no-deps -e OPENROUTER_MODELS="$LOCAL_MOCK_MODELS" app npm run build
docker compose run --rm --no-deps app npm exec --offline netlify -- build --offline --context deploy-preview
docker compose config --quiet
docker compose down --volumes
rm -f .env
```

Before the first command, run `./scripts/generate-local-secrets.sh` (it is Docker-based and needs no host Node). Expected: every command exits 0, public/private generated types have no diff, the pinned offline Netlify CLI accepts the deploy-preview build, `.env` is absent after cleanup, and OpenRouter mock request counts confirm zero external calls.

- [ ] **Step 4: Commit CI**

```bash
git add .github/workflows/ci.yml scripts/ci.sh playwright.config.ts
git commit -m "ci: gate the complete MVP"
```

### Task 8: Write deployment runbooks and production smoke automation

**Files:**
- Create via CLI: migration logical name `maintenance_cleanup` (created after the account-deletion migration; referred to below as the maintenance migration / "051")
- Create: `supabase/tests/database/maintenance_cleanup.test.sql`
- Modify: `.env.example`
- Modify: `scripts/generate-local-secrets.sh`
- Modify: `scripts/generate-local-secrets.mjs`
- Create: `scripts/provision-maintenance-role.sh`
- Create: `scripts/provision-maintenance-role.test.mjs`
- Create: `netlify/functions/_shared/maintenance-env.ts`
- Create: `netlify/functions/_shared/maintenance-env.test.ts`
- Create: `netlify/functions/_shared/maintenance-db.ts`
- Create: `netlify/functions/_shared/maintenance-db.test.ts`
- Create: `netlify/functions/_shared/maintenance-db.integration.test.ts`
- Create: `netlify/functions/maintenance-cleanup.ts`
- Create: `netlify/functions/maintenance-cleanup.test.ts`
- Modify: `vitest.config.ts`
- Create: `scripts/preflight-production.mjs`
- Create: `scripts/preflight-production.test.mjs`
- Create: `scripts/smoke-production.mjs`
- Create: `scripts/smoke-production.test.mjs`
- Create: `scripts/verify-production-deploy.mjs`
- Create: `scripts/verify-production-deploy.test.mjs`
- Create: `scripts/verify-browser-secrets.mjs`
- Create: `scripts/verify-browser-secrets.test.mjs`
- Create: `docs/deployment/supabase.md`
- Create: `docs/deployment/netlify.md`
- Create: `docs/runbooks/openrouter.md`
- Create: `docs/runbooks/account-deletion.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `netlify/functions/_shared/env.ts`
- Modify: `netlify/functions/_shared/env.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: managed Supabase credentials, the server-only `GENERATION_REQUEST_HMAC_KEY` and `SUPABASE_MAINTENANCE_DB_URL`, Netlify environment variables, migration order, a deployed public origin, Plan 1's exact managed-project parser and `private.auth_continuations`, Plan 3's canonical generation-ledger/stale-reservation cleanup transitions, and Plan 5's `private.shopping_mutations(user_id,idempotency_key,request_hash,response,created_at)` replay ledger.
- Produces: a bounded `SECURITY DEFINER` maintenance RPC executable only by a NOLOGIN executor role, a dedicated LOGIN with a command-start database timeout, an hourly production Scheduled Function using direct PostgreSQL protocol, exact 30-day terminal-generation and shopping-mutation retention, project-ref-bound production preflight, authoritative current-production-deploy verification, and reproducible migration, least-privilege provisioning, configuration, rollback-decision, model-rotation, and post-deploy procedures.

- [ ] **Step 1: Write failing preflight and smoke unit tests**

The preflight test passes a complete synthetic production environment using project ref `abcdefghijklmnopqrst` and expects no errors, then removes each required variable in turn and expects its exact name in the error. It also asserts that `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `GENERATION_REQUEST_HMAC_KEY`, and `SUPABASE_MAINTENANCE_DB_URL` are rejected when exposed through any `VITE_`-prefixed alias, requires `VITE_AUTH_PROVIDER_MODE=supabase`, and uses `Object.hasOwn(env,"VITE_OAUTH_MOCK_ORIGIN")` to reject the mock-origin key even when its value is empty. It rejects a missing HMAC key, invalid base64, any decoded length other than exactly 32 bytes, Plan 3's documented sample/local value, and a `VITE_GENERATION_REQUEST_HMAC_KEY` key even when empty. It requires both `SUPABASE_URL` and `VITE_SUPABASE_URL` to equal the exact managed origin `https://abcdefghijklmnopqrst.supabase.co`, requires `SUPABASE_PUBLISHABLE_KEY === VITE_SUPABASE_PUBLISHABLE_KEY`, and passes that extracted ref into maintenance parsing. Arbitrary HTTPS, short/uppercase refs, suffix lookalikes, credentials, ports, trailing slash, path/query/fragment, browser/server ref mismatch, publishable-key mismatch, a direct database host with another ref, and a Session-pooler username with another ref all fail with closed codes. `oauth_mock` mode, the local mock URL, a maintenance URL without TLS, a URL whose direct username is not exactly `kondate_maintenance_login` (or whose Supavisor Session username is not exactly that role plus the expected project-ref suffix), and a URL containing credentials in any error all fail in production.

Write `maintenance_cleanup.test.sql` red first. It proves the exact **scheduled** batched signatures `public.cleanup_stale_ai_generations_batch(timestamptz,integer)`, `public.cleanup_ai_generation_requests_batch(timestamptz,integer)`, `private.cleanup_shopping_mutations(timestamptz,integer)`, and `public.cleanup_auth_continuations_batch(timestamptz,integer)` plus `public.run_kondate_maintenance(timestamptz,integer)`. Additionally prove that the **preexisting one-argument / service-path wrappers keep their original meaning and grants** so existing callers and pgTAP do not break:

- `public.cleanup_stale_ai_generations(timestamptz default clock_timestamp())` — still exists; optional internal delegate to the batch function with a fixed limit or inline the same transition without changing call sites.
- `public.cleanup_ai_generation_requests(timestamptz, uuid default null)` — still exists; do **not** add a competing `(timestamptz,integer)` overload.
- `public.cleanup_auth_continuations(timestamptz)` — still exists and still means **expired rows only** (`expires_at <= p_now`), bounded (current body uses `limit 100`); it must **not** delete unexpired claimed rows. Claimed-and-still-unexpired cleanup is only for `cleanup_auth_continuations_batch` / `run_kondate_maintenance` if the design requires it; if batch also only deletes expired, document that “expired-or-claimed” in global constraints means claimed rows leave when their `expires_at` has passed (current schema already bounds TTL). Prefer matching the existing expire-only semantics unless a focused product decision expands claimed-before-expiry deletion — and then update Plan 1 continuation pgTAP in the same Task.
- `private.cleanup_expired_shopping_mutations(uuid,integer)` — still exists for request-path cleanup.

No ambiguous overload was introduced between batch and legacy signatures. It proves `kondate_maintenance_executor` is NOLOGIN, NOINHERIT, not superuser, cannot bypass RLS, has `USAGE` on `public` and `EXECUTE` on that one RPC only, and has no table, sequence, helper-function, or private-schema privilege. `public`, `anon`, `authenticated`, and `service_role` cannot execute the RPC. Seed terminal generation requests and shopping mutations at exactly 30 days, just older than 30 days, and 29 days; expired, claimed, and live continuations; expired processing reservations with both sent and unsent global slots; and more than one batch in both retention ledgers. Assert both exact 30-day boundaries are retained, only older terminal/shopping rows are deleted, expired/claimed continuations are deleted, live continuations remain, and stale reservations use Plan 3's canonical transition to release success plus only unsent attempt/global reservations. A second run returns all four zero counts; a batch of two leaves deterministic work for the next call; concurrent calls use `FOR UPDATE SKIP LOCKED` and never double-release or double-delete.

Plan 7's `private.generation_regeneration_snapshots` is deliberately **not** a fifth category. It is request-bound with `ON DELETE CASCADE` from `private.ai_generation_requests(id,user_id)`, so terminal-ledger retention removes it implicitly. Seed a regeneration snapshot on a terminal request just older than 30 days and one on a retained request at the exact boundary, then assert the first snapshot disappears with its request, the second survives, `generationLedgersDeleted` counts requests rather than snapshots, and the returned object still has exactly four keys. Also assert no snapshot on a still-`processing` request or on a menu-referenced request is ever removed. Adding a snapshot count, a snapshot-first delete, or a separate snapshot category is out of scope and would break the four-key readback contract below.

Write `maintenance-env.test.ts`, `maintenance-db.test.ts`, and `maintenance-cleanup.test.ts` red first. The local environment test accepts exactly `kondate_maintenance_login@db:5432/postgres?sslmode=disable` solely in explicit local-test mode — the container-internal address, since all Node commands are container-routed. Production parsing additionally requires an explicit expected project ref previously extracted from the exact server Supabase origin, plus a `postgres:`/`postgresql:` URL with a non-empty password, canonical dedicated-login identity, exact `/postgres` path, canonical host/port, and `sslmode=require`, `verify-ca`, or `verify-full`. Accepted production shapes are direct `kondate_maintenance_login@db.<expected-project-ref>.supabase.co:5432` and IPv4 Supavisor Session `kondate_maintenance_login.<expected-project-ref>@<region>.pooler.supabase.com:5432`; the same valid shapes with another project ref, port `6543`, and every transaction-mode/dedicated pooler fail. They reject fragments, duplicate parameters, and every query key except the one `sslmode` key—especially `options`, `search_path`, timeout, role, and application-name overrides. They reject `localhost`, alternate local ports, credentials/query details in errors, and `VITE_SUPABASE_MAINTENANCE_DB_URL` even when empty. Mode-selection tests allow local parsing only for the conjunction `CONTEXT=dev && KONDATE_MAINTENANCE_ENV=local`; either key alone, any other value, deploy-preview, branch-deploy, or production selects strict production parsing and rejects loopback. Production preflight rejects the presence of `KONDATE_MAINTENANCE_ENV` even when empty. The adapter unit tests assert a single client per invocation, one overall deadline that begins before connection and never resets, parameterized fixed RPC SQL, the role/timeout guards, strict four-count result parsing before `COMMIT`, `ROLLBACK` when safe, and one idempotent `client.end()` after success, SQL failure, result-parse failure, server cancellation, and client timeout; environment-parse failure constructs no client. No log or thrown public error contains the URL, project ref, password, host, or raw driver error.

The Function test injects the clock, database adapter, and **Task 4 `safeLog` / `createSafeLogger` sink**. It asserts one parsed counts-only maintenance call, `204`, and a success log whose JSON keys are only `level`, `request_id`, `code` (`maintenance_cleanup`), `duration_ms`, and the four snake_case aggregates (`stale_reservations_finalized`, `generation_ledgers_deleted`, `shopping_mutations_deleted`, `auth_continuations_deleted`). Failure logging uses `code: "maintenance_cleanup_failed"` with no counts and no raw driver text. Assert no Supabase REST/admin client import, no camelCase `durationMs`/`errorCode` emission, and no `console.*` in the handler source. It imports `config`, expects `config` to equal `{schedule:"@hourly"}`, and rejects a `path` key. The source/config test documents that a Scheduled Function runs only for a published production deploy, has no directly invokable URL, and is locally debugged by starting `docker compose run --rm --no-deps app npm exec --offline netlify -- dev` with the generated local `.env`, then running `docker compose run --rm --no-deps app npm exec --offline netlify -- functions:invoke maintenance-cleanup` from a second terminal (or the host equivalent once `netlify-cli` is in the image).

Write `maintenance-db.integration.test.ts` against the real local PostgreSQL path and dedicated login. Exclude it from the ordinary suite in the same commit: `vitest.config.ts` currently includes `netlify/functions/**/*.test.ts` with a global `jsdom` environment, so without an `exclude` entry this file would also run inside `docker compose run --rm --no-deps app npx vitest run`, where the stack is absent and `pg` would be running under jsdom. Add it to `exclude`, mark the file `// @vitest-environment node`, and run it only through its dedicated command (which omits `--no-deps` because it needs `db`). Before the transaction it asserts `session_user=current_user='kondate_maintenance_login'` and `current_setting('statement_timeout')='20s'`; inside it asserts `session_user='kondate_maintenance_login'`, `current_user='kondate_maintenance_executor'`, and the local timeout remains `20s`. A fixed test-only seam, unavailable to requests and production call sites, runs the actual maintenance RPC and then `pg_sleep(21)` before commit; expect SQLSTATE `57014` near 20 seconds, assert all generation, shopping-mutation, and continuation writes rolled back from an independent admin connection, and prove the `kondate-maintenance` connection disappeared from `pg_stat_activity`. A second test lets earlier categories change rows while an admin connection holds an `ACCESS EXCLUSIVE` lock on the later `private.auth_continuations` table; the same real RPC must be canceled with `57014`, roll back the earlier generation and shopping deletion changes, release/close both clients in `finally`, and leave no partial cleanup. The 25-second client ceiling is a backstop and must not win over the database's 20-second error in either test.

The smoke test injects `fetch` and asserts these exact probes: `GET /` must return `200` HTML containing the root mount element; unauthenticated `POST /api/generations/menu` must return `401` and `auth_required`; unauthenticated `DELETE /api/account` must return `401` and `auth_required`. It must never call a generation route with authorization.

Write `verify-production-deploy.test.mjs` red first. Its pure verifier receives `candidateSha`, `tagSha`, `productionDeployId`, expected production origin, deploy metadata, and site metadata. The success fixture requires `HEAD === candidateSha === tagSha === deploy.commit_ref`, deploy `id` match, `context='production'`, `state='ready'`, exact HTTPS origin-only deploy URL (`ssl_url`, normalized with the same `httpsOriginOnly` helper as Task 6), and `site.published_deploy.id === productionDeployId`. Table tests reject a wrong HEAD, candidate, tag, deploy SHA/ID/context/state/origin, stale site-published ID, credentials/path/query/fragment in the requested origin, missing metadata, and an extra/invalid input. The CLI reads HEAD and the annotated tag target with `execFileSync` argument arrays, fetches the named deploy then its site metadata with a five-second timeout and protected `NETLIFY_AUTH_TOKEN`, prints only `production_deploy: pass` or a closed code, and never prints metadata, token, origin, or raw response. `smoke-production.test.mjs` additionally proves the exact already-verified `PRODUCTION_ORIGIN` string is passed unchanged to all three probes.

Write `verify-browser-secrets.test.mjs` red first with a temporary synthetic source/build tree. It proves both a forbidden variable name and each synthetic secret value fail closed, clean fixtures pass, absent `dist/` is accepted before build, and diagnostics contain only the variable name plus relative file—not the secret, matching line, URL, or surrounding contents.

- [ ] **Step 2: Implement the least-privilege database path, scripts, and package commands**

Install the direct PostgreSQL driver if Task 6 has not already done so (same exact versions). Prefer a single install in Task 6; Task 8 only re-runs install when `pg` is missing from `package.json`:

```bash
docker compose run --rm --no-deps app npm install --save-exact pg@8.22.0
docker compose run --rm --no-deps app npm install --save-dev --save-exact @types/pg@8.20.0
```

```json
{
  "scripts": {
    "preflight:production": "node scripts/preflight-production.mjs",
    "smoke:production": "node scripts/smoke-production.mjs",
    "verify:production-deploy": "node scripts/verify-production-deploy.mjs",
    "verify:browser-secrets": "node --env-file-if-exists=.env scripts/verify-browser-secrets.mjs",
    "test:maintenance-db:integration": "node --env-file=.env node_modules/vitest/vitest.mjs run netlify/functions/_shared/maintenance-db.integration.test.ts"
  }
}
```

`preflight-production.mjs` validates `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_MAGIC_LINK_RESEND_SECONDS`, `VITE_AUTH_CONTINUATION_TTL_MS`, `VITE_AUTH_PROVIDER_MODE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MAINTENANCE_DB_URL`, `SERVER_SITE_ORIGIN`, `AUTH_CONTINUATION_ENCRYPTION_KEY`, `GENERATION_REQUEST_HMAC_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODELS`, `GLOBAL_DAILY_AI_LIMIT`, `USER_DAILY_AI_LIMIT`, `USER_DAILY_EXTERNAL_CALL_LIMIT`, `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT`, `USER_SHORT_WINDOW_SECONDS`, `AUTH_CONTINUATION_TTL_SECONDS`, `OPENROUTER_TIMEOUT_MS`, `FUNCTION_TOTAL_BUDGET_MS`, and `AI_PROCESSING_STALE_SECONDS`; it calls the exported OpenRouter parser plus Plan 1's `parseManagedSupabaseProjectRef` and the production parser from `maintenance-env.ts`. Both Supabase app URLs must be byte-identical exact managed origins, their extracted 20-character refs must be equal, both publishable-key variables must be byte-identical, and the maintenance parser receives that expected ref and requires the direct database host or Session username suffix to match. It checks all numeric values are positive integers; fixes the release-locked limits at exactly `5` successful generations, `12` user daily sends, `4` sends per `600` seconds, failed-ledger retention at `30` days, continuation TTL at `300` seconds/`300000` browser milliseconds, attempt timeout at `20000` ms, total Function budget at `50000` ms, and processing-stale threshold at exactly `180` seconds; requires `VITE_AUTH_PROVIDER_MODE === "supabase"`, rejects the presence of `VITE_OAUTH_MOCK_ORIGIN`, `KONDATE_MAINTENANCE_ENV`, and every `VITE_` alias of a server secret, requires the continuation key to decode to exactly 32 bytes and the generation HMAC key to use canonical base64 decoding to exactly 32 bytes, rejects the HMAC sample/local value, and requires `OPENROUTER_BASE_URL` to equal `https://openrouter.ai/api/v1`; it performs no network call. Extend Plan 3's `_shared/env.test.ts` with the same production HMAC cases while leaving its runtime parser the sole owner of decoded key material. Its tests call the validator with an explicit object and spawn the CLI with a complete synthetic `env` object that does not spread or inherit `process.env`, so ambient developer variables cannot hide a missing deployment variable, generation key, maintenance credential, cross-project endpoint, or mock-provider leak. Errors name the missing variable or a closed validation code only, never a URL component, project ref, or secret value.

`smoke-production.mjs` requires one HTTPS origin argument, rejects a URL with credentials/query/fragment, runs the three probes above with a five-second `AbortSignal.timeout(5000)`, and exits nonzero with the probe name and HTTP status only. It never prints a response body or environment value.

`verify-production-deploy.mjs` requires `CANDIDATE_SHA`, `RELEASE_TAG`, `PRODUCTION_DEPLOY_ID`, and exact HTTPS origin-only `PRODUCTION_ORIGIN` plus `NETLIFY_AUTH_TOKEN`. It reads HEAD and `git rev-list -n 1 <tag>` without a shell, fetches `GET /api/v1/deploys/:productionDeployId`, then `GET /api/v1/sites/:site_id`, and applies the pure checks from Step 1. Both requests use `AbortSignal.timeout(5000)`. `site_id` is accepted only from the validated deploy response and URL-encoded; no caller-provided API URL exists. The site response must identify the same deploy as its current `published_deploy`, preventing a ready but superseded production deploy from satisfying the gate. The script emits only its closed pass/error code. Task 9 runs it immediately before and after `smoke-production -- "$PRODUCTION_ORIGIN"`; a concurrent publish or origin change therefore closes the release rather than blessing the wrong deploy.

`verify-browser-secrets.mjs` scans `src/` and any built `dist/` for the forbidden server-variable names and for the non-empty values of `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GENERATION_REQUEST_HMAC_KEY`, `SUPABASE_MAINTENANCE_DB_URL`, `MAINTENANCE_DB_PASSWORD`, and `NETLIFY_AUTH_TOKEN` present in its explicit environment. It reports only the variable name and relative file, never the matching value or line contents, and exits nonzero on a match. It also scans `shared/`, which Vite aliases into the browser bundle and which an earlier draft omitted. Because `/workspace/dist` is a tmpfs mount in the `app` service, a build in one `docker compose run` leaves nothing for a later one to scan: run the build and the scan **in the same container invocation**, and make the script exit nonzero — not zero — when `dist/` is absent after a build was expected, so the "absent dist is accepted" allowance cannot turn into a silent pass. Its tests use synthetic secrets and fixtures to prove both name/value detection and redacted output. CI runs it after the build with the generated `.env`; the protected release runner runs it after the production build with its transient complete server-secret environment.

The maintenance migration keeps the existing cleanup entry points as compatibility wrappers and moves their transitions into bounded, batched variants (`1..250`, `FOR UPDATE SKIP LOCKED`). Read the current signatures before writing it, because they are not uniform and one of them makes a naive overload illegal:

- `public.cleanup_stale_ai_generations(p_now timestamptz default clock_timestamp())` — one argument with a default.
- `public.cleanup_auth_continuations(p_now timestamptz)` — one argument.
- `public.cleanup_ai_generation_requests(p_before timestamptz, p_user_id uuid default null)` — **already two arguments**, the second a defaulted `uuid`.

Its retention key is **`completed_at`**, not `updated_at`: the existing body deletes rows whose `status in ('succeeded','failed','constraint_conflict')`, whose `completed_at is not null` and `< p_before`, and which no menu references. `updated_at` is `not null default now()` and moves for reasons unrelated to terminating, so batching on it would delete different rows than the canonical transition. The batched variant keeps `completed_at` and every one of those guards.

Adding `cleanup_ai_generation_requests(timestamptz,integer)` alongside that last one creates an ambiguous overload: any two-argument call with an untyped `NULL` or numeric literal fails to resolve, and the existing service-role callers become fragile. Do not create that overload. Give the batched variant a distinct name — `public.cleanup_ai_generation_requests_batch(p_before timestamptz, p_limit integer)` — leave the existing `(timestamptz,uuid)` function and its grants untouched, and have `run_kondate_maintenance` call the batch function. Apply the same rule anywhere else a proposed overload would collide with an existing defaulted parameter; a new name is always cheaper than an ambiguity.

Shopping-mutation retention already has a helper: `private.cleanup_expired_shopping_mutations(p_user_id uuid, p_limit integer default 100)` deletes the same 30-day-old rows, but per user and capped at 100, and it is called on the request path rather than by a scheduler. Do not add a second, silently different cleaner. Add `private.cleanup_shopping_mutations(p_before timestamptz, p_limit integer)` as the account-wide scheduled variant with the `1..250` bound, deleting only `private.shopping_mutations.created_at < p_before`, ordering by `created_at,user_id,idempotency_key`, locking with `FOR UPDATE SKIP LOCKED`, and returning one count; then state explicitly in the migration comment and the access matrix that the two coexist by design — the per-user one bounds a single request's cleanup, the account-wide one is the hourly sweep — and prove with pgTAP that neither deletes a row at or newer than the exact 30-day boundary. If that division turns out not to hold, collapse them rather than leaving two retention rules. Exact-boundary rows are retained. The account-wide helper has no public wrapper because no browser/service path consumes it. Migration `051` creates or normalizes `kondate_maintenance_executor` as `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; the migration never creates a LOGIN or embeds a password. The executor receives only `USAGE ON SCHEMA public` and `EXECUTE ON FUNCTION public.run_kondate_maintenance(timestamptz,integer)`. Revoke the RPC from `PUBLIC`, `anon`, `authenticated`, and `service_role`, and revoke table, sequence, private-schema, and every bounded-helper privilege—including the shopping helper—from the executor. Existing one-argument wrappers keep only the preexisting service-role permissions required by Plans 1 and 3; neither the executor nor the Scheduled Function calls them directly.

`run_kondate_maintenance` does not duplicate quota-release or replay SQL. It calls the canonical bounded transitions in this fixed order: stale reservations via `cleanup_stale_ai_generations_batch`, terminal generation ledgers with `completed_at < p_now - interval '30 days'` via `cleanup_ai_generation_requests_batch`, shopping mutation replays with `created_at < p_now - interval '30 days'` via `private.cleanup_shopping_mutations`, then auth continuations via `cleanup_auth_continuations_batch` (default: same expire-only rule as the one-arg wrapper unless a documented expansion is approved). The RPC is `SECURITY DEFINER SET search_path=''`, uses schema-qualified references and fixed SQL only. (The existing Plan 1–5 cleanup functions use `set search_path = pg_catalog, pg_temp`; Plan 7 moves the RPCs it replaces to `''`. New functions here use `''` — do not rewrite untouched existing functions' `search_path` as a drive-by change, since that alters an applied migration's behavior without a test demanding it.) It returns this strict JSON object:

```json
{
  "staleReservationsFinalized": 0,
  "generationLedgersDeleted": 0,
  "shoppingMutationsDeleted": 0,
  "authContinuationsDeleted": 0
}
```

Do not put `set_config('statement_timeout',...)` inside the RPC and do not claim that a function-local setting bounds its containing command: PostgreSQL chooses the statement timeout before executing that command. Each of the four categories receives the same caller-supplied maximum of 250, so one invocation is bounded and reentrant; excess work remains for the next hour. Never delete a processing row as terminal-ledger retention, a menu-referenced request, a shopping mutation at or newer than the exact 30-day boundary, or a live unclaimed continuation. Never delete a regeneration snapshot directly; it leaves only as a cascade of its own terminal request.

Append safe placeholders for `KONDATE_MAINTENANCE_ENV=local`, `MAINTENANCE_DB_PASSWORD`, and `SUPABASE_MAINTENANCE_DB_URL` to `.env.example`. The stable `scripts/generate-local-secrets.sh` wrapper delegates to `scripts/generate-local-secrets.mjs`; that implementation creates a URL-safe random local password, percent-encodes its credential component, and writes `KONDATE_MAINTENANCE_ENV=local` plus the password and exact URL `postgresql://kondate_maintenance_login:<encoded>@db:5432/postgres?sslmode=disable` only to the mode-`0600`, gitignored `.env`. It never prints them. `scripts/provision-maintenance-role.sh` is a **host-issued Compose command**, not a host `psql` invocation: this repository does not install `psql` on the host. It pipes its SQL into `docker compose exec -T db psql --no-psqlrc -v ON_ERROR_STOP=1` and passes the password through the environment (`PGPASSWORD`-style) or stdin, never argv. It reads the password without shell tracing or command-line exposure, provisions `kondate_maintenance_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`, grants membership in the NOLOGIN executor, and executes `ALTER ROLE kondate_maintenance_login SET statement_timeout='20s'`. It is idempotent for local/CI use, sends password material to `psql` through protected stdin/environment only, emits closed status text without SQL/URLs, and unsets it before exit. Its source test rejects `set -x`, password/URL echoing, password-bearing argv, committed literal credentials, or provisioning the LOGIN in a migration.

`maintenance-env.ts` returns an opaque validated connection string without logging or serialization helpers. Production parsing requires `{mode:"production",expectedProjectRef}` where the ref has already been extracted by Plan 1's exact managed-origin helper; absence or malformed ref fails before URL inspection. It accepts only `postgres:`/`postgresql:`, non-empty password, exact `/postgres` path, no fragment, and exactly one query parameter: `sslmode` in the set `require|verify-ca|verify-full`. It accepts either `db.<expectedProjectRef>.supabase.co:5432` with URL username exactly `kondate_maintenance_login`, or Supavisor Session mode on port `5432` with canonical URL-routing username `kondate_maintenance_login.<expectedProjectRef>`; the latter suffix is transport metadata, while the post-connect guard must still see exact database `session_user='kondate_maintenance_login'`. A syntactically valid direct or Session URL for any other project fails closed. This rejects URL-supplied `options`, role, search-path, timeout, application-name, duplicate-key overrides, port `6543`, and every transaction-mode pooler. Although transaction mode is normally attractive for serverless traffic, it cannot guarantee the session-level role default required here; this one hourly connection is instead capped at 25 seconds, limited to two login connections, and always closed. The local-test parser alone accepts the **container-internal** canonical address: exact host `db`, port `5432`, exact login username `kondate_maintenance_login`, path `/postgres`, and sole `sslmode=disable`. Everything else — `localhost`, `127.0.0.1`, IPv6 loopback, any other host or port — fails. This is the address that works from inside the Compose network, which is where every Node command in this plan runs; the host-published `127.0.0.1:54322` mapping in `infra/supabase.override.yaml` exists for human inspection only and is deliberately **not** accepted, so a developer cannot accidentally point the local parser at something the container-routed test cannot reach. Earlier drafts specified `127.0.0.1:54322` and were unreachable from `app`, which sits on the default bridge network. `selectMaintenanceEnvironmentMode` returns that mode only for `CONTEXT=dev && KONDATE_MAINTENANCE_ENV=local`. Both parsers reject `VITE_SUPABASE_MAINTENANCE_DB_URL` by key presence, and production preflight rejects the local-mode key itself.

`maintenance-db.ts` creates one `pg.Client` per invocation with `application_name: "kondate-maintenance"`, `connectionTimeoutMillis: 5_000`, `query_timeout: 25_000`, and `idle_in_transaction_session_timeout: 25_000`; it deliberately does not override `statement_timeout` in the driver. The database role default is therefore the authoritative ceiling from the first command. A single 25-second overall client deadline starts before `connect()`, bounds the whole adapter rather than resetting per query, and uses one idempotent close path; `query_timeout` is an additional per-query backstop. After connecting, a fixed guard checks `session_user`, `current_user`, and `current_setting('statement_timeout')` before `BEGIN`. The same client then runs these fixed operations:

```sql
begin;
set local role kondate_maintenance_executor;
set local statement_timeout = '20s';
select session_user, current_user, current_setting('statement_timeout');
select public.run_kondate_maintenance($1::timestamptz, $2::integer) as counts;
commit;
```

The pre-transaction guard must see the dedicated LOGIN and `20s`; the in-transaction guard must see that LOGIN as `session_user`, the executor as `current_user`, and `20s`. The timestamp and fixed batch `250` are parameters; no request controls a role, identifier, SQL fragment, timeout, or batch. Parse the exact four-key, non-negative-integer counts object before `COMMIT`, including `shoppingMutationsDeleted`; a missing, extra, or malformed count rolls the entire transaction back. On a server error including SQLSTATE `57014`, issue `ROLLBACK` only while the connection is usable. If the overall 25-second deadline/client timeout fires or protocol state is uncertain, issue no further SQL and close the socket so PostgreSQL rolls back the open transaction. In every path, remove the deadline listener and await the same idempotent `client.end()` in `finally`; use no global pool and leave no warm-invocation connection. Cleanup failure is folded into the same closed error code and never replaces or logs the original error.

Implement the Scheduled Function with the current Netlify code configuration and no HTTP route. Logging uses Task 4's `safeLog` only — never a parallel camelCase `console.*` shape:

```ts
import type { Config } from "@netlify/functions";
import { parseManagedSupabaseProjectRef } from "./_shared/env.js";
import { safeLog } from "./_shared/logger.js";
import { runMaintenance } from "./_shared/maintenance-db.js";
import {
  parseMaintenanceDatabaseEnv,
  selectMaintenanceEnvironmentMode,
} from "./_shared/maintenance-env.js";

export default async function maintenanceCleanup(): Promise<Response> {
  const started = performance.now();
  const deadline = AbortSignal.timeout(25_000);
  const requestId = "maintenance";
  try {
    const mode = selectMaintenanceEnvironmentMode(process.env);
    let connectionString: string;
    if (mode === "local") {
      connectionString = parseMaintenanceDatabaseEnv(process.env, { mode });
    } else {
      const expectedProjectRef = parseManagedSupabaseProjectRef(
        String(process.env.SUPABASE_URL ?? ""),
      );
      if (expectedProjectRef === null) throw new Error("supabase_project_invalid");
      connectionString = parseMaintenanceDatabaseEnv(process.env, {
        mode,
        expectedProjectRef,
      });
    }
    const counts = await runMaintenance({
      connectionString,
      now: new Date().toISOString(),
      batchSize: 250,
      signal: deadline,
    });
    safeLog({
      level: "info",
      requestId,
      code: "maintenance_cleanup",
      durationMs: Math.round(performance.now() - started),
      staleReservationsFinalized: counts.staleReservationsFinalized,
      generationLedgersDeleted: counts.generationLedgersDeleted,
      shoppingMutationsDeleted: counts.shoppingMutationsDeleted,
      authContinuationsDeleted: counts.authContinuationsDeleted,
    });
    return new Response(null, { status: 204 });
  } catch {
    safeLog({
      level: "error",
      requestId,
      code: "maintenance_cleanup_failed",
      durationMs: Math.round(performance.now() - started),
    });
    return new Response(null, { status: 500 });
  }
}
export const config: Config = { schedule: "@hourly" };
```

RPC/JSON counts stay camelCase in the TypeScript result object (matching `run_kondate_maintenance`); only the serialized log lines use snake_case via `createSafeLogger`. Never emit raw `console.*` or camelCase log keys from production Functions.

The login-default/database ceiling (20 seconds), node-postgres client timeout (25 seconds), and Netlify Scheduled Function maximum (30 seconds) are ordered and independently tested. `schedule` is mutually exclusive with `path`; this Function therefore appears in no API route table and cannot be invoked by URL. It runs only on published production deploys, not deploy previews. The local runbook provisions the dedicated local login, starts Netlify Dev in its canonical `dev` context so the generated local-mode marker is honored, and then uses the CLI invocation above; standalone or production-context invocation with a loopback or cross-project URL fails closed. Monitoring records the four counts, duration, and a closed error code only—never row IDs, mutation response JSON, continuation fields, prompts, user data, project refs, database error text, hostnames, usernames, or connection strings.

- [ ] **Step 3: Write the Supabase deployment runbook with exact order**

`docs/deployment/supabase.md` specifies:

1. Create the managed project in the chosen region and record its exact 20-character project ref, exact origin `https://<project-ref>.supabase.co`, publishable key, service-role key, and administrator deployment database URL in the deployment secret manager. These are distinct from the maintenance credential. Reject a custom/arbitrary REST origin for this MVP; browser and server app URLs are the same recorded managed origin and their publishable keys are identical.
2. Configure Site URL to the canonical Netlify HTTPS origin and allow only Plan 1's canonical local `http://127.0.0.1:5173/auth/callback`, the Netlify production callback, and explicitly approved deploy-preview callbacks.
3. Configure Google provider credentials and magic-link email templates; verify both callback paths in a staging project.
4. Run `npm exec --offline supabase -- db push --db-url "$SUPABASE_DB_URL" --include-all` from a clean tagged commit. Verify by filename order that every Plan 7 migration applies first, then the account-deletion migration, then the maintenance migration — use the exact CLI-emitted paths recorded in the Task 1 and Task 8 briefs, never a filename retyped from this plan.
5. Generate a unique maintenance password in the deployment secret manager. Through protected administrator `psql` with history, echo, statement logging, and shell tracing disabled, create or normalize `kondate_maintenance_login` as `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`, set/rotate its password with `psql`'s protected password-input path, grant `kondate_maintenance_executor` membership, and execute `ALTER ROLE kondate_maintenance_login SET statement_timeout='20s'`. Pass secret material through protected stdin/environment, never a CLI argument or SQL editor; SQL editors may be used only for the non-secret grant/default statements if their transcripts are protected. The committed migration creates only the NOLOGIN executor and RPC grants.
6. If the Netlify runtime can reach the project's IPv6 direct endpoint or the project has the IPv4 add-on, build the TLS-required direct URL with exact host `db.<the-recorded-project-ref>.supabase.co:5432` and username `kondate_maintenance_login`. Otherwise use the official IPv4 Supavisor **Session** URL on port `5432`, replacing its role prefix with `kondate_maintenance_login` while retaining exactly the same recorded project-ref routing suffix. A ref copied from another environment is a hard failure even when its credentials connect. Percent-encode credential components without ever printing the intermediate URL, store the result only as the Netlify Functions-scoped `SUPABASE_MAINTENANCE_DB_URL`, and immediately discard local copies. Never use port `6543`/transaction mode, a service-role JWT, administrator database password, repository, ticket, shell history, or log as storage; session mode is required for the login default and one-client transaction semantics.
7. Connect once with the dedicated URL and verify `session_user=current_user='kondate_maintenance_login'` and `current_setting('statement_timeout')='20s'` before any transaction. Then verify a transaction can `SET LOCAL ROLE kondate_maintenance_executor`, sees the same `20s`, can call only the maintenance RPC, and cannot select owned tables or execute another application RPC. Output booleans/role names only; redact the connection command and URL.
8. Run the database suite, including the exact 30-day terminal-generation and `private.shopping_mutations` boundaries, four-count readback, and real 20-second cancellation/rollback integration tests, against staging, not production; promote the same migration files to production only after staging passes. To check for schema drift, regenerate types **with the same generator that produced the committed file** — `scripts/generate-database-types.sh` pointed at the staging database through `PG_META_TYPES_URL` — and `diff -u` the result against `src/shared/types/database.generated.ts`. Do not compare against `supabase gen types` output: a different generator produces cosmetic differences that are indistinguishable from real public/private drift.
9. Verify catalog versions and privacy explanation version, then create no production demo household data.

The runbook states migrations are forward-only. A failure before traffic is fixed by a new migration; rollback of frontend traffic uses Netlify’s previous deploy, never `db reset` or destructive migration reversal. Maintenance credential rollback is independent: disable the schedule, revoke LOGIN or executor membership, terminate only that login's sessions, rotate the secret, and read back role/default/privilege state before re-enabling. No runbook command prints a password or connection URL, and all operator transcripts/artifacts are checked for their absence.

- [ ] **Step 4: Write the Netlify and operations runbooks**

`docs/deployment/netlify.md` lists the exact browser-safe and server-only variables above, sets both Supabase app URLs to the same exact managed origin and both publishable-key variables to the same value, sets `VITE_AUTH_PROVIDER_MODE=supabase`, proves `VITE_OAUTH_MOCK_ORIGIN` and `KONDATE_MAINTENANCE_ENV` are absent, uses the `verify:openrouter:models` production build command, and requires `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` exactly. It adds both `GENERATION_REQUEST_HMAC_KEY` and the same-project `SUPABASE_MAINTENANCE_DB_URL` only through Netlify's protected Functions runtime scope—not Builds, deploy logs, `netlify.toml`, repository files, preview contexts, or any `VITE_` key—and validates them without printing either value. Before deployment, a protected release runner injects the same secrets transiently into an environment-clean `npm run preflight:production` subprocess; only its exit status and closed check names enter release evidence, and the site build receives neither. The HMAC key is stable across MVP deploys because retained requests store only the HMAC: rotation requires a reviewed new HMAC version/keyring migration plus explicit pending-command handling, never an ad-hoc environment replacement. The runbook confirms the five-second provider/live-model verification separately in the deploy log and deploys the tagged commit. It obtains `PRODUCTION_DEPLOY_ID` and `PRODUCTION_ORIGIN` only from authoritative Netlify deploy/site metadata inside the protected runner, verifies them with `verify:production-deploy`, passes that unchanged verified origin to `smoke:production`, and verifies the deploy again afterward. An operator-typed smoke origin, example URL, artifact-supplied origin, or unverified environment override is forbidden. The local `oauth-mock` service/origin, local-mode marker, sample HMAC key, and local maintenance password/URL are never copied into a Netlify site variable. Maintenance-password rotation creates a new dedicated password, atomically replaces the protected variable, verifies one scheduled run, and then invalidates the old password without exposing either value.

`docs/runbooks/openrouter.md` instructs the operator to query the Models API for current `:free` IDs through the fixed five-second metadata deadline, require `structured_outputs` and `response_format`, run the fixed adversarial corpus in staging, order models explicitly, update only `OPENROUTER_MODELS`, redeploy, and confirm no paid or automatic model was added. It records the release-locked controls—exactly 5 successful generations per user/JST day, exactly 12 external sends per user/JST day, exactly 4 sends per fixed 600 seconds, 20-second per-attempt timeout, and 50-second total Function budget—and forbids operational tuning of 5/12/4/600 without a reviewed release. It also documents the `maintenance-cleanup` Scheduled Function: `@hourly`, published production only, 250 rows in each of four categories, exact 30-day generation/shopping retention, the implicit regeneration-snapshot cascade that is not a fifth counted category, dedicated PostgreSQL login, role-default and transaction-local 20-second database bounds, 25-second client bound under the 30-second platform limit, idempotent reentry, mandatory connection cleanup, and four-count-only monitoring. Local diagnosis first provisions the ephemeral local login, starts `npm exec --offline netlify dev`, and then uses `npm exec --offline netlify functions:invoke maintenance-cleanup` from another terminal; no URL probe is attempted. A timeout requires checking only the closed failure metric and aggregate row counts, then reproducing against staging tests that assert SQLSTATE `57014`; never enable raw driver errors or print the maintenance URL. If no verified free model exists, keep AI unavailable and leave emergency menus enabled.

`docs/runbooks/account-deletion.md` explains the user-visible hard-delete flow, a safe support response that does not request allergy data or tokens, verification through aggregate counts rather than PII logs, and escalation when the Auth Admin API returns an error. It states that deletion is mode-independent: an account holding only idea-mode menus and no family members deletes through the same single Auth-user path, and support must not ask a household-less user to "complete family setup first". It never instructs an operator to delete rows manually before deleting the Auth user.

- [ ] **Step 5: Run runbook automation and documentation checks**

Update `.github/workflows/ci.yml` so the role boundary is exercised rather than mocked. Immediately after `docker compose up -d --wait`, run `./scripts/provision-maintenance-role.sh`; run the five local-safe Node script tests shown below and the dedicated integration command before the ordinary test suite; and run `npm run verify:browser-secrets` after each browser build. The production-deploy verifier unit test uses injected metadata only and never contacts Netlify in CI. The generated `.env` supplies both local maintenance values and remains mode `0600`; neither value appears in workflow `env`, command arguments, uploaded artifacts, test names, failure output, or container diagnostics. Keep the existing `if: always()` teardown and `.env` removal. Update `scripts/ci.sh` to include those Node tests, the maintenance integration run after unit tests, and the browser-secret scan after build, and document that its caller must have generated `.env`, started Compose, and provisioned the role first.

Run:

```bash
docker compose run --rm --no-deps app node --test scripts/provision-maintenance-role.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/maintenance-env.test.ts netlify/functions/_shared/maintenance-db.test.ts netlify/functions/maintenance-cleanup.test.ts
docker compose --profile test run --rm db-test supabase/tests/database/maintenance_cleanup.test.sql
docker compose run --rm app npm run test:maintenance-db:integration
docker compose run --rm --no-deps app sh -c 'npm run build && npm run verify:browser-secrets'
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app sh -c \
  'if grep -rnE "GENERATION_REQUEST_HMAC_KEY|SUPABASE_MAINTENANCE_DB_URL|MAINTENANCE_DB_PASSWORD" src shared; then exit 1; fi'
```

Before the focused database commands, generate `.env`, start the stack, and run `./scripts/provision-maintenance-role.sh`; use an `EXIT` trap to stop Compose and remove `.env` without printing either maintenance value. Expected: script tests pass, including a CLI subprocess whose `env` is a complete synthetic HTTPS production configuration built from an empty object and which accepts no inherited/local variables; removing each required key, changing either app project ref/key, or changing the maintenance project ref fails with a closed code. The migration privilege assertions and exact generation/shopping 30-day boundaries pass; the real login reports its 20-second default before `BEGIN`; both the `pg_sleep` and relation-lock paths return SQLSTATE `57014` around 20 seconds, roll back generation/shopping/continuation changes, and leave no maintenance connection. Unit tests prove four-count cleanup on all outcomes. The production deploy unit test rejects every SHA/tag/origin/current-published-deploy mismatch. Do not run `preflight:production` against the local mock `.env`, because production mode correctly rejects that environment. The real command runs only in the protected release runner with a complete secret-manager environment as required by `docs/deployment/netlify.md`; the Netlify site build does not receive the maintenance URL. Markdown formatting and browser-source secret-name scans pass.

- [ ] **Step 6: Commit deployment automation and runbooks**

```bash
git add .env.example .github/workflows/ci.yml supabase/migrations supabase/tests/database/maintenance_cleanup.test.sql netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/maintenance-env.ts netlify/functions/_shared/maintenance-env.test.ts netlify/functions/_shared/maintenance-db.ts netlify/functions/_shared/maintenance-db.test.ts netlify/functions/_shared/maintenance-db.integration.test.ts netlify/functions/maintenance-cleanup.ts netlify/functions/maintenance-cleanup.test.ts scripts/generate-local-secrets.sh scripts/generate-local-secrets.mjs scripts/provision-maintenance-role.sh scripts/provision-maintenance-role.test.mjs scripts/preflight-production.mjs scripts/preflight-production.test.mjs scripts/smoke-production.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.mjs scripts/verify-browser-secrets.test.mjs docs/deployment docs/runbooks package.json package-lock.json vitest.config.ts scripts/ci.sh
git commit -m "feat: add least-privilege production maintenance"
```

### Task 9: Run the final release gate and record evidence

**Files:**
- Create: `docs/testing/release-checklist.md`
- Modify: `docs/testing/acceptance-matrix.md`

**Interfaces:**
- Consumes: all plans, commits, tests, and runbooks.
- Produces: one immutable release-candidate commit, an external checked release gate and Google artifact tied to that exact SHA, and a same-SHA tag/deploy; none contains credentials, user data, or raw logs.

- [ ] **Step 1: Obtain final code review and prepare release templates**

Invoke `superpowers:requesting-code-review` over the full implementation range. Resolve every Blocker and High finding with a failing regression test first and rerun its focused gate. Medium findings that are explicitly deferred must include an owner and follow-up issue; safety, privacy, authorization, data-loss, paid-model, and accessibility failures cannot be deferred.

Complete all 22 MVP and all 8 guided-planner acceptance-matrix ownership/test-title rows. Create `release-checklist.md` as the immutable command/check template: required tool versions, every gate command, expected exit status, the 22/22 and 8/8 rule, links to the four deployment/runbook documents, the four-category maintenance-login/default-timeout/privilege/retention checks, the external evidence location policy, the authoritative current-production-deploy checks before and after smoke, and the rule that the tested candidate is obtained with `git rev-parse HEAD`. Do not put a guessed/self-referential commit SHA, execution result, user value, database URL, credential, or raw log in the repository.

- [ ] **Step 2: Make Task 9's sole repository commit before testing the candidate**

```bash
git add docs/testing/release-checklist.md docs/testing/acceptance-matrix.md
git commit -m "chore: add Kondate MVP release gate"
test -z "$(git status --porcelain)"
export CANDIDATE_SHA="$(git rev-parse HEAD)"
```

After this commit, do not modify or commit the checklist, matrix, evidence, generated types, or any other tracked file. Gate results live in the protected CI/release system; real-Google results live only in the external strict JSON artifact. This order avoids an evidence commit changing the SHA that was actually tested.

- [ ] **Step 3: Run the entire gate from the clean candidate**

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
./scripts/run-e2e.sh
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

Use an `EXIT` trap in the executable runbook/CI wrapper so Compose teardown, maintenance connection termination, and `.env` removal also occur after failure. Expected: every verification exits 0; the dedicated LOGIN's default/SET ROLE/privilege assertions, generation/shopping exact retention boundaries, four-count readback, and both real cancellation/rollback paths pass without a leaked connection; production preflight rejects every cross-project Supabase permutation; `npm run db:types` includes `public,private` and has no diff; the offline Netlify deploy-preview build passes; no deterministic test contacts live OpenRouter or Netlify; no server-secret name or value enters browser output; `dist/` stays ignored; final HEAD and worktree are byte-for-byte the captured candidate.

- [ ] **Step 4: Verify staging evidence, tag, and deploy the same SHA**

Deploy `CANDIDATE_SHA` to staging without another commit. Read the immutable staging deploy ID/SHA from Netlify metadata, start at the Google login screen in the original browser, execute real Google success, and write the exact external JSON artifact from Task 6 with a 24-hour expiry. Verify it, create the tag, run production preflight/live-model verification and migration `051` from that unchanged tagged checkout, and deploy that exact tag. The protected runner obtains `PRODUCTION_DEPLOY_ID` and `PRODUCTION_ORIGIN` from Netlify API metadata—not operator input—and before the Google evidence expires runs:

```bash
test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"
NETLIFY_AUTH_TOKEN="$NETLIFY_AUTH_TOKEN" node scripts/verify-release-evidence.mjs "$GOOGLE_OAUTH_RELEASE_EVIDENCE"
test -z "$(git status --porcelain)"
git tag -a "v1.0.0" "$CANDIDATE_SHA" -m "Kondate MVP"
test "$(git rev-list -n 1 v1.0.0)" = "$CANDIDATE_SHA"
# Deploy tag v1.0.0, then populate both variables from authoritative Netlify metadata.
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

The protected release record stores `candidateSha`, production deploy ID, UTC execution date, Node/npm/Compose versions, command exit statuses/counts, 22/22 and 8/8, and the verified external Google artifact reference—never its sensitive inputs, origin value, metadata body, or raw logs. Production preflight/live model metadata verification, migration `051`, tag, current Netlify `published_deploy`, both production metadata checks, and the intervening smoke must all resolve to `CANDIDATE_SHA` and the one verified origin. `PRODUCTION_ORIGIN` is populated only by the protected metadata-readback step and is immutable for the command block; typing or copying an example origin is forbidden. There is no post-evidence repository commit; if any gate, staging check, production metadata check, or smoke fails, fix it in a new commit, discard the stale artifact/tag candidate, capture the new HEAD, and repeat Steps 3–4.

## Plan Completion Gate

Before calling this plan complete, run the roadmap’s global verification gate plus the public/private type diff and offline Netlify build, confirm `docs/testing/acceptance-matrix.md` has 22 populated MVP rows plus 8 populated guided-planner rows, confirm the account-deletion E2E proves Auth and all inventoried owned-row removal with a non-empty normalized safety-action producer fixture and non-empty idea-menu and `private.generation_regeneration_snapshots` fixtures, and verify the unexpired external Google artifact against current HEAD and authoritative staging metadata. Run `npm run preflight:production` from an empty explicit environment containing one exact managed Supabase project across browser/server/maintenance, a fresh canonical 32-byte production HMAC key, and all other required values; then run `npm run verify:browser-secrets` with that protected complete environment to scan names and values. Run the container-routed secret-name scan over `dist src shared` with `if grep …; then exit 1; fi` so zero matches pass under `set -e` (never `grep; test $? -eq 1`). Confirm the dedicated maintenance login starts at `statement_timeout='20s'`, the executor's grants remain exact, generation and shopping mutation exact 30-day boundaries plus four-count readback pass, regeneration snapshots leave only by cascade with their terminal requests, both SQLSTATE `57014` rollback tests pass, and `pg_stat_activity` has no leaked maintenance connection. Finally rerun the authoritative production deploy verifier around smoke, require current `published_deploy`, HEAD, tag, `commit_ref`, and verified smoke origin to equal the candidate contract, and confirm the worktree is clean. Then use `superpowers:verification-before-completion` and report the exact commands and outcomes without reproducing credentials, project refs, origins, metadata, or raw database errors.

## Official References

- Supabase delete user: https://supabase.com/docs/reference/javascript/auth-admin-deleteuser
- Supabase database migrations: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase pgTAP testing: https://supabase.com/docs/guides/database/testing
- Supabase PostgreSQL connection modes: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase database timeouts: https://supabase.com/docs/guides/database/postgres/timeouts
- Netlify Vite deployment: https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/
- Netlify Functions configuration: https://docs.netlify.com/build/functions/configuration/
- Netlify Scheduled Functions: https://docs.netlify.com/build/functions/scheduled-functions/
- Netlify Function environment variables: https://docs.netlify.com/build/functions/environment-variables/
- Netlify local Function invocation: https://docs.netlify.com/api-and-cli-guides/cli-guides/manage-functions/
- node-postgres Client API: https://node-postgres.com/apis/client
- node-postgres transactions: https://node-postgres.com/features/transactions
- PostgreSQL `statement_timeout`: https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-STATEMENT-TIMEOUT
- PostgreSQL `ALTER ROLE`: https://www.postgresql.org/docs/current/sql-alterrole.html
- OpenRouter Models API: https://openrouter.ai/docs/guides/overview/models
- OpenRouter structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
