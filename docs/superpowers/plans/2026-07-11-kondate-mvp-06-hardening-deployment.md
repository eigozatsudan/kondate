# Kondate Hardening and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the MVP with irreversible account deletion, repository-wide privacy and RLS checks, mobile accessibility verification, deterministic CI, and reproducible Netlify plus managed Supabase deployment.

**Architecture:** Account deletion remains a narrowly scoped authenticated Netlify Function and uses the Supabase Auth Admin API so deleting the Auth user drives database cascades. Build-time scripts reject unsafe OpenRouter configuration before Vite runs and verify live model metadata through a bounded five-second request at deployment. Production preflight binds browser, server, direct database, and Supavisor Session endpoints to one exact managed Supabase project ref. An hourly production Netlify Scheduled Function uses `pg` and a server-only, dedicated least-privilege PostgreSQL login to invoke one bounded maintenance RPC across stale reservations, generation ledgers, shopping idempotency mutations, and auth continuations; its database-role default timeout is effective before the RPC command begins. CI starts the same root Docker Compose stack used locally, provisions that same role boundary with ephemeral local credentials, runs every test layer, regenerates both public/private types, and produces the same offline Netlify build later deployed to production. A protected production-deploy verifier reads authoritative Netlify deploy and site metadata before and after smoke so the active deploy, candidate, tag, and smoke origin remain one SHA/origin.

**Tech Stack:** Node.js 24 LTS, TypeScript strict mode, Supabase Auth Admin API/PostgreSQL/RLS, node-postgres (`pg`), Netlify Functions and configuration, Vitest, React Testing Library, axe-core, Playwright, GitHub Actions, Docker Compose.

## Global Constraints

- Implement only after Plans 1–5 and preserve every route, type, migration, and ownership boundary in the roadmap.
- Account deletion is a hard delete after an explicit Japanese confirmation phrase. It deletes the authenticated Supabase Auth user; every owned row must disappear through tested `ON DELETE CASCADE` paths.
- Plan 1 remains the final `/settings` route and `HouseholdSettingsPage` owner. Plan 6 composes only `AccountSettingsSection`/DangerZone into that page and must preserve all family CRUD tests and controls.
- Never accept a user ID from the account-deletion request and never put a name, email, access token, household condition, prompt, or raw AI response in logs or CI artifacts.
- Browser code receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, public policy URLs, and Plan 1's provider-mode switch. Local/CI use `VITE_AUTH_PROVIDER_MODE=oauth_mock` plus exact `VITE_OAUTH_MOCK_ORIGIN=http://127.0.0.1:8788`; production requires `VITE_AUTH_PROVIDER_MODE=supabase` and forbids the mock-origin variable. Production browser and server Supabase URLs are exact managed origins with the same 20-character project ref, their publishable keys are byte-identical, and the maintenance direct host or Session-pooler username suffix carries that same ref. Service-role, OpenRouter, `GENERATION_REQUEST_HMAC_KEY`, and `SUPABASE_MAINTENANCE_DB_URL` credentials exist only in server-side secret contexts. The HMAC key and maintenance URL are Functions-scoped in Netlify and are exposed transiently only to the protected release preflight process; neither is a `VITE_` variable, site-build input, browser asset, repository value, artifact, or log field.
- Release-locked generation controls are exactly 5 successes/JST day, 12 sends/user/JST day, and 4 sends/fixed 600-second window. Runtime parsing and production preflight reject any drift in 5/12/4/600.
- Every configured OpenRouter model is explicit, unique, ends in `:free`, is not `openrouter/auto`, and supports both `structured_outputs` and `response_format` according to the live Models API at deployment time. That metadata request has one five-second abort deadline and reports a closed error without response content.
- The live-model check is mandatory for a Netlify production build but not for normal tests, which use `mock/kondate:free` and the local mock service.
- The SPA works without horizontal scrolling at 320, 375, and 430 CSS pixels. Every visible interactive target is at least 44 by 44 CSS pixels and every asynchronous status is exposed through text and an appropriate live region.
- CI runs formatting, lint, type checking, unit/component/adversarial tests, database tests, integration/E2E tests, the Netlify production build, Docker Compose validation, and dependency auditing. No deploy proceeds after a failed gate.
- Production smoke tests are read-only except for the unauthenticated rejection probes; they do not create users, menus, or OpenRouter calls.
- `maintenance-cleanup` uses code config `schedule: "@hourly"` with no `path`, runs only on published production deploys, and uses one fresh `pg.Client` per invocation. Its four fixed categories are stale generation reservations, terminal generation ledgers older than 30 days, `private.shopping_mutations` older than 30 days, and expired-or-claimed auth continuations. The dedicated LOGIN has `statement_timeout='20s'` before the first SQL command; the transaction reasserts and verifies `SET LOCAL ROLE kondate_maintenance_executor` plus `SET LOCAL statement_timeout='20s'`; the driver aborts at 25 seconds; and the platform stops at 30 seconds. Every path rolls back when possible, closes the connection, and logs exactly four aggregate cleanup counts, duration, and a closed error code only.
- The release checklist/matrix commit precedes the final gate. Local, staging Google, tag, and the currently published production deployment all resolve to the same candidate SHA; the protected verifier reads Netlify deploy metadata and current site `published_deploy` metadata before and after smoke. Evidence is external and no evidence-result commit follows it.
- Follow red-green-refactor and end every task with a focused commit.

---

### Task 1: Prove account-wide cascade behavior

**Files:**
- Create: `supabase/migrations/20260711005000_account_deletion.sql`
- Create: `supabase/tests/database/account_deletion.test.sql`

**Interfaces:**
- Consumes: every `public` and `private` table created by Plans 1–5 that has a `user_id` column.
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
      ('shopping_item_sources'),('shopping_label_confirmations')
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

Run: `npm run db:test -- supabase/tests/database/account_deletion.test.sql`

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
    'shopping_item_sources','shopping_label_confirmations'
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

Never edit migrations `001`–`040`, even when Step 2 identifies an offender. Migration `050` drops every competing FK to `auth.users` whose local key contains that offender's `user_id` (including composite and non-cascade Auth FKs), preserves owner-composite FKs to application tables, adds exactly `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`, and then runs the exact single-column guard above. A later discovery is fixed in a new `052+` migration because `051` is reserved for scheduled maintenance, never by changing an applied checksum.

- [ ] **Step 4: Rebuild the database and verify the invariant**

Run:

```bash
npm run db:reset
npm run db:test -- supabase/tests/database/account_deletion.test.sql
npm run db:test
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
- Modify: `src/features/auth/session.ts`

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

Run: `npm test -- --run netlify/functions/delete-account.test.ts`

Expected: FAIL because the contract and function do not exist.

- [ ] **Step 3: Implement the function with injected dependencies**

```ts
// netlify/functions/delete-account.ts
import type { Config } from "@netlify/functions";
import { deleteAccountRequestSchema, type DeleteAccountResult } from "../../shared/contracts/account";
import { requireUser } from "./_shared/auth";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http";
import { getSupabaseAdmin } from "./_shared/supabase-admin";

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

Run: `npm test -- --run netlify/functions/delete-account.test.ts`

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
import type { Database } from "@/shared/types/database.generated";
import { clearOwnedAuthStorage } from "./auth-flow";
import {householdSafetyRevisionStorageKey} from "@/features/household/household-queries";
export async function clearLocalAuthAndDrafts(client:SupabaseClient<Database>):Promise<void>{
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

Modify—not replace—Plan 1's `HouseholdSettingsPage`: import `AccountSettingsSection` from `@/features/account/account-settings-section` and render `<AccountSettingsSection />` after the existing complete member/allergy/dislike editor inside its current `<main>`. Do not extract, rename, or substitute that editor. Do not create another settings page, change the `/settings` route, or replace `HouseholdSettingsPage` in `router.tsx`. Its integration test first adds/edits/deletes a member and updates allergy/dislike state, then opens the composed danger zone; it proves all existing family CRUD controls remain present and the route still renders exactly one Plan 1 page owner.

- [ ] **Step 7: Run component, type, and build checks**

Run:

```bash
npm test -- --run src/features/account/delete-account-dialog.test.tsx
npm test -- --run src/features/account/account-settings-section.test.tsx src/features/household/household-settings-page.test.tsx
npm run typecheck
npm run build
```

Expected: tests pass, the settings route compiles, and `dist/` is produced.

- [ ] **Step 8: Commit account deletion**

```bash
git add shared/contracts/account.ts netlify/functions/delete-account.ts netlify/functions/delete-account.test.ts src/features/account src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx src/features/auth/auth-cleanup.ts src/features/auth/auth-cleanup.test.ts src/features/auth/session.ts
git commit -m "feat: add permanent account deletion"
```

### Task 3: Lock environment parsing and live free-model verification

**Files:**
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `scripts/verify-openrouter-models.mjs`
- Create: `scripts/verify-openrouter-models.test.mjs`
- Modify: `package.json`
- Modify: `netlify/functions/_shared/env.ts`

**Interfaces:**
- Consumes: `OPENROUTER_MODELS` parsing from Plan 3 and the OpenRouter `GET /api/v1/models` response.
- Produces: `verify:models:config`, `verify:models:remote`, and one shared model-list parser used by build and Functions.

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
    main({ OPENROUTER_MODELS: "vendor/a:free", VERIFY_OPENROUTER_REMOTE: "1" },
      fetchImpl, () => signal),
    /openrouter_models_unavailable/u,
  );
});
```

- [ ] **Step 2: Run the Node test and verify failure**

Run: `node --test scripts/verify-openrouter-models.test.mjs`

Expected: FAIL because the verifier module does not exist.

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
) {
  const configured = parseConfiguredModels(env.OPENROUTER_MODELS ?? "");
  if (env.CONTEXT === "production" && env.OPENROUTER_BASE_URL !== "https://openrouter.ai/api/v1") {
    throw new Error("production OPENROUTER_BASE_URL must equal https://openrouter.ai/api/v1");
  }
  if (env.VERIFY_OPENROUTER_REMOTE !== "1") return;
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

The same `parseConfiguredModels` rules must be represented in the Zod schema in `netlify/functions/_shared/env.ts`; its Vitest table reuses the accepted and rejected values above so runtime and build cannot drift. The schema fixes `USER_DAILY_EXTERNAL_CALL_LIMIT=12`, `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT=4`, `USER_SHORT_WINDOW_SECONDS=600`, `FAILED_GENERATION_LEDGER_RETENTION_DAYS=30`, `AUTH_CONTINUATION_TTL_SECONDS=300`, `OPENROUTER_TIMEOUT_MS=20000`, `FUNCTION_TOTAL_BUDGET_MS=50000`, and `AI_PROCESSING_STALE_SECONDS=180` exactly. A production-context test accepts only the exact `https://openrouter.ai/api/v1` base URL; lookalike hosts, credentials, query/fragment, HTTP, and trailing-path variants fail before build.

- [ ] **Step 4: Add scripts and a mock-safe environment template**

```json
{
  "scripts": {
    "verify:models:config": "node scripts/verify-openrouter-models.mjs",
    "verify:models:remote": "VERIFY_OPENROUTER_REMOTE=1 node scripts/verify-openrouter-models.mjs",
    "prebuild": "node --env-file-if-exists=.env scripts/verify-openrouter-models.mjs"
  }
}
```

Merge these keys into the existing `scripts` object; do not replace earlier scripts.

```dotenv
# Browser-safe values
VITE_SUPABASE_URL=http://127.0.0.1:8000
VITE_SUPABASE_PUBLISHABLE_KEY=generated-by-scripts/generate-local-secrets.sh
VITE_PRIVACY_POLICY_URL=/privacy
VITE_MAGIC_LINK_RESEND_SECONDS=60
VITE_AUTH_CONTINUATION_TTL_MS=300000
VITE_AUTH_PROVIDER_MODE=oauth_mock
VITE_OAUTH_MOCK_ORIGIN=http://127.0.0.1:8788

# Server-only local values; never prefix these with VITE_
SUPABASE_URL=http://kong:8000
SUPABASE_PUBLISHABLE_KEY=generated-by-scripts/generate-local-secrets.sh
SUPABASE_SERVICE_ROLE_KEY=generated-by-scripts/generate-local-secrets.sh
SERVER_SITE_ORIGIN=http://127.0.0.1:5173
AUTH_CONTINUATION_ENCRYPTION_KEY=generated-32-byte-base64-secret
OPENROUTER_API_KEY=local-mock-key
OPENROUTER_BASE_URL=http://openrouter-mock:8787/api/v1
OPENROUTER_MODELS=mock/kondate:free
GLOBAL_DAILY_AI_LIMIT=45
USER_DAILY_AI_LIMIT=5
USER_DAILY_EXTERNAL_CALL_LIMIT=12
USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT=4
USER_SHORT_WINDOW_SECONDS=600
FAILED_GENERATION_LEDGER_RETENTION_DAYS=30
AUTH_CONTINUATION_TTL_SECONDS=300
OPENROUTER_TIMEOUT_MS=20000
FUNCTION_TOTAL_BUDGET_MS=50000
AI_PROCESSING_STALE_SECONDS=180
APP_ORIGIN=http://127.0.0.1:5173
```

The root Compose project has the Plan 1 service named exactly `oauth-mock`, with container origin `http://oauth-mock:8788`, browser origin `http://127.0.0.1:8788`, and `GET /health`. The focused Compose contract test asserts that exact service/healthcheck/port and the app's local provider variables. Environment tests accept these two browser variables only in local/mock mode. A production-context test requires `VITE_AUTH_PROVIDER_MODE=supabase` and rejects `VITE_OAUTH_MOCK_ORIGIN` even if it contains the expected local URL; production can never silently enable the pseudo-provider.

Update the root `compose.yaml` app/Function environment to use those same two deadline controls:

```yaml
FUNCTION_TOTAL_BUDGET_MS: "50000"
AI_PROCESSING_STALE_SECONDS: "180"
```

Remove the obsolete `GENERATION_SYNC_DEADLINE_MS` key everywhere. Add a focused configuration test that parses the Compose model and asserts both exact values, then asserts a repository source scan returns zero occurrences of `GENERATION_SYNC_DEADLINE_MS` and one canonical runtime read of `FUNCTION_TOTAL_BUDGET_MS` rather than allowing both deadline names to coexist.

- [ ] **Step 5: Run config, runtime, type, and build checks**

Run:

```bash
node --test scripts/verify-openrouter-models.test.mjs
OPENROUTER_MODELS=mock/kondate:free npm run verify:models:config
OPENROUTER_MODELS=vendor/paid npm run verify:models:config
npm test -- --run netlify/functions/_shared/env.test.ts
npm run typecheck
OPENROUTER_MODELS=mock/kondate:free npm run build
docker compose config --quiet
test "$(rg -n 'GENERATION_SYNC_DEADLINE_MS' compose.yaml netlify/functions scripts .env.example | wc -l)" -eq 0
```

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

**Interfaces:**
- Consumes: function result/error codes and actual model IDs from Plans 2–5.
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
npm test -- --run netlify/functions/_shared/logger.test.ts
npm run db:test -- supabase/tests/database/rls_inventory.test.sql
```

Expected: the logging test fails until the helper exists; the RLS test reports any earlier policy boundary defect.

Create `docs/testing/database-access-matrix.md` with one row for every public/private table and callable RPC. Columns are `object`, `owner`, `anon`, `authenticated`, `service_role`, `RLS/policy`, and `reason`. Derive the rows from the migrations, not assumptions: catalogs are authenticated `SELECT`; user-owned aggregate roots/children are owner `SELECT` plus only the explicit browser columns; derived inserts and all private ledgers are service-only; anon is `none`; every security-definer RPC records its exact signature and role grant. Add a test-side `expected_access` values CTE generated from this matrix and four `is_empty` assertions that symmetrically compare `information_schema.role_table_grants`, `role_column_grants`, `routine_privileges`, and `pg_policies`, so either an undocumented extra grant/policy or a missing documented one fails. The four generic assertions above plus these four exact comparisons equal `plan(8)`; the exact matrix comparison is the authoritative gate.

- [ ] **Step 3: Implement the closed logging shape**

```ts
// netlify/functions/_shared/logger.ts additions; retain `logGenerationEvent` as a wrapper
export type SafeLogEvent = {
  level: "info" | "warn" | "error";
  requestId: string;
  code: string;
  durationMs: number;
  modelId?: string;
};

type LogWriter = (serialized: string) => void;

export const createSafeLogger = (write: LogWriter = console.log) => (event: SafeLogEvent): void => {
  const record: Record<string, string | number> = {
    level: event.level,
    request_id: event.requestId,
    code: event.code,
    duration_ms: event.durationMs,
  };
  if (event.modelId) record.model_id = event.modelId;
  write(JSON.stringify(record));
};

export const safeLog = createSafeLogger();
```

Implement Plan 3's `logGenerationEvent(level,event,sink)` as a compatibility wrapper around `createSafeLogger`, mapping `errorCode` to `code` and `null` model IDs to `undefined`. Replace every route-handler `console.*` call with `safeLog`. Do not pass caught error objects, request bodies, Supabase error messages, prompts, or AI responses. Internal unit tests may inspect errors but production logging code may not.

- [ ] **Step 4: Add Netlify build, SPA fallback, and headers**

Run `npm install --save-dev --save-exact netlify-cli@26.2.0`; commit the resulting lockfile. The CLI is local and reproducible—`npx` network fallback is forbidden.

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "24"

[context.production]
  command = "npm run verify:models:remote && npm run build"

[context.deploy-preview]
  command = "npm run build"

[context.branch-deploy]
  command = "npm run build"

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

Supabase authentication redirects use top-level navigation and do not require adding Google domains to `connect-src`. If a custom Supabase domain is used, add that exact HTTPS and WSS origin to `connect-src` in the deployment commit.

- [ ] **Step 5: Run security boundary and Netlify build checks**

Run:

```bash
npm test -- --run netlify/functions/_shared/logger.test.ts
npm run db:test -- supabase/tests/database/rls_inventory.test.sql
OPENROUTER_MODELS=mock/kondate:free npm run build
npm exec --offline netlify -- build --offline --context deploy-preview
```

Expected: tests pass, no private-schema grant or RLS omission is listed, Vite emits `dist/`, and Netlify accepts the configuration. The deploy-preview context deliberately uses structural model validation and makes no live Models API call; the production context always performs the remote check.

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
- Consumes: the completed login, onboarding, planner, result, history, pantry, shopping, and settings routes.
- Produces: automated landmark/name/live-region checks and 320/375/430-pixel layout and target-size checks.

- [ ] **Step 1: Add axe-core and write failing route tests**

Run: `npm install --save-dev axe-core`

Create `src/test/axe.ts` with `runAxe(container: Element): Promise<AxeResults>` that calls `axe.run(container, { rules: { region: { enabled: true } } })` and throws a formatted assertion containing violation IDs and target selectors when `violations.length > 0`.

`src/app/accessibility.test.tsx` renders one representative state for each route and asserts:

```ts
await expect(runAxe(container)).resolves.toMatchObject({ violations: [] });
expect(screen.getByRole("main")).toBeVisible();
expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
expect(screen.getByRole("status")).toHaveTextContent(/作成中|保存しました|残り/);
```

Login has no authenticated navigation, so its test requires exactly one `main`, a named Google button, a labeled email input, and a textual error region instead.

- [ ] **Step 2: Run the component accessibility test and capture violations**

Run: `npm test -- --run src/app/accessibility.test.tsx`

Expected: FAIL until missing labels, landmarks, focus behavior, and live regions are corrected.

- [ ] **Step 3: Write the failing mobile Playwright checks**

First extend Plan 1's fixture without changing the existing raw `authenticatedPage` used by onboarding tests:

```ts
type AuthFixtures = {
  authEmail: string;
  authenticatedPage: Page;
  completedOnboardingPage: Page;
};
// add to base.extend<AuthFixtures>:
completedOnboardingPage: async ({ authenticatedPage: page }, use) => {
  await completeMinimumOnboarding(page);
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await use(page);
},
```

```ts
// e2e/specs/mobile-accessibility.spec.ts
import { expect, test } from "../fixtures/auth";

for (const width of [320, 375, 430]) {
  test(`planner and result fit ${width}px with usable targets`, async ({ completedOnboardingPage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/planner");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const visibleControls = page.locator("a:visible,button:visible,input:visible,select:visible,textarea:visible");
    for (let index = 0; index < await visibleControls.count(); index += 1) {
      const box = await visibleControls.nth(index).boundingBox();
      expect(box, `control ${index} has a box`).not.toBeNull();
      expect(box?.height, `control ${index} height`).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: "献立を作る" }).click();
    await expect(page.getByRole("status")).toContainText("献立を作っています");
    await expect(page.getByRole("heading", { name: "今日の献立" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
```

- [ ] **Step 4: Correct shared UI primitives, focus, and status announcements**

Centralize fixes in `src/shared/ui/button.tsx`, `field.tsx`, `dialog.tsx`, `toast.tsx`, and the app shell. On route changes, move programmatic focus to the page `h1` with `tabIndex={-1}`. Loading updates use `role="status" aria-live="polite"`; validation and request failures use `role="alert"`; icon-only actions have Japanese accessible names; color is never the only error or selection cue.

- [ ] **Step 5: Run accessibility, mobile, and visual-layout checks**

Run:

```bash
npm test -- --run src/app/accessibility.test.tsx
npm run e2e -- e2e/specs/mobile-accessibility.spec.ts
npm run typecheck
```

Expected: axe reports zero violations in covered states; all three widths have no horizontal overflow; target-size assertions and type checking pass.

- [ ] **Step 6: Commit accessibility hardening**

```bash
git add package.json package-lock.json src e2e/specs/mobile-accessibility.spec.ts
git commit -m "test: enforce mobile accessibility"
```

### Task 6: Complete adversarial and end-to-end acceptance coverage

**Files:**
- Create: `docs/testing/acceptance-matrix.md`
- Create: `e2e/specs/account-deletion.spec.ts`
- Create: `e2e/specs/full-journey.spec.ts`
- Create: `e2e/specs/privacy-logging.spec.ts`
- Create: `e2e/specs/auth-callback-security.spec.ts`
- Create: `e2e/fixtures/acceptance.ts`
- Create: `e2e/fixtures/function-logs.ts`
- Create: `docs/testing/google-oauth-staging.md`
- Create: `scripts/verify-release-evidence.mjs`
- Create: `scripts/verify-release-evidence.test.mjs`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `tools/openrouter-mock/server.mjs`
- Add fixtures under: `tools/openrouter-mock/fixtures/adversarial/`

**Interfaces:**
- Consumes: all 22 acceptance criteria in the approved design and every test added by Plans 1–5.
- Produces: a one-to-one acceptance matrix, `completedOnboardingPage`, Node-only service-role/DB-count fixtures, sanitized Function-log capture, final cross-feature journey tests, deletion proof, deterministic OAuth callback/state coverage, an external same-SHA Google evidence verifier, and a fixed adversarial AI corpus.

- [ ] **Step 1: Inventory acceptance coverage before adding tests**

Create `docs/testing/acceptance-matrix.md` with exactly 22 rows. Each row contains the design acceptance number, behavior, owning automated test file and exact test title, and test layer. A row may cite multiple tests. The only non-local exception is real Google-provider success: its row cites deterministic automated PKCE/state/callback tests plus an external JSON artifact verified for the release candidate. The artifact is stored outside the repository and has exactly these fields: `candidateSha`, Netlify `stagingDeployId`, authoritative `stagingDeploySha`, ISO `executedAt`, ISO `expiresAt` exactly 24 hours later, non-email `tester`, HTTPS origin-only `stagingOrigin`, `startScreen: "login"`, `stateMatched: true`, `originalBrowserCallbackCompleted: true`, `tokenFreeResult: true`, and `passed: true`. It contains no account identifier, email, authorization code, continuation secret, PKCE verifier, access/refresh token, screenshot, or raw log. No other row may say “manual only”. Production secret configuration and post-deploy reachability cite Task 8's automated preflight, authoritative current-production-deploy verifier, and smoke scripts; a smoke result without both surrounding metadata checks is not evidence.

Write `verify-release-evidence.mjs` and its Node tests before documenting a pass. The CLI accepts the external artifact path, obtains the candidate with `execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"})`, and reads Netlify's authoritative deploy metadata for `stagingDeployId` from `GET https://api.netlify.com/api/v1/deploys/:id` using a protected release-runner `NETLIFY_AUTH_TOKEN` that is never configured as a site/build variable. It strictly validates the exact schema above, rejects unknown/sensitive keys recursively and email/token/code/verifier-like values, requires `candidateSha === stagingDeploySha === metadata.commit_ref === HEAD`, requires metadata `id` and `deploy_ssl_url` to match the artifact's deploy ID/origin, and requires unexpired evidence with `expiresAt = executedAt + 24h`. It prints only `google_oauth_evidence: pass` or a safe field/error code. The artifact's SHA/origin is never accepted as a self-assertion without that metadata readback. Tests inject clock/fetch and cover wrong local/artifact/metadata SHA, deploy-ID/origin mismatch, missing/extra fields, false booleans, future execution, expired or non-24-hour evidence, non-HTTPS/path-bearing origin, email-shaped tester, and forbidden sensitive material. `docs/testing/google-oauth-staging.md` is an instruction/template only; neither the actual JSON nor a copied result is committed.

```js
// scripts/verify-release-evidence.mjs
import {execFileSync} from "node:child_process";
import {readFileSync,realpathSync} from "node:fs";
import {sep} from "node:path";
import {z} from "zod";

const origin=z.string().url().refine((value)=>{
  const parsed=new URL(value);
  return parsed.protocol==="https:"&&parsed.origin===value&&parsed.username===""&&
    parsed.password===""&&parsed.search===""&&parsed.hash==="";
},"staging_origin_invalid");
export const googleOauthEvidenceSchema=z.object({
  candidateSha:z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  stagingDeployId:z.string().regex(/^[0-9a-f]{24}$/u),
  stagingDeploySha:z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  executedAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}),
  tester:z.string().trim().min(1).max(80)
    .refine((value)=>!/(?:@|token|code|verifier|secret|bearer)/iu.test(value),
      "tester_identifier_invalid"),
  stagingOrigin:origin,startScreen:z.literal("login"),stateMatched:z.literal(true),
  originalBrowserCallbackCompleted:z.literal(true),tokenFreeResult:z.literal(true),
  passed:z.literal(true),
}).strict();
const deployMetadataSchema=z.object({
  id:z.string(),commit_ref:z.string(),deploy_ssl_url:z.string().url(),
}).passthrough();
export function verifyGoogleOauthEvidence(value,{head,deployMetadata,now}){
  const evidence=googleOauthEvidenceSchema.parse(value);
  const metadata=deployMetadataSchema.parse(deployMetadata);
  if(metadata.id!==evidence.stagingDeployId)throw new Error("staging_deploy_id_mismatch");
  if(metadata.deploy_ssl_url!==evidence.stagingOrigin)throw new Error("staging_origin_mismatch");
  if(evidence.candidateSha!==head.trim()||evidence.stagingDeploySha!==head.trim()||
    metadata.commit_ref!==head.trim())throw new Error("candidate_sha_mismatch");
  const executed=Date.parse(evidence.executedAt),expires=Date.parse(evidence.expiresAt);
  if(expires-executed!==86_400_000)throw new Error("evidence_expiry_invalid");
  if(executed>now.getTime()+300_000)throw new Error("evidence_time_invalid");
  if(now.getTime()>expires)throw new Error("evidence_expired");
  return evidence;
}
export async function main(path=process.argv[2],env=process.env,fetchImpl=fetch){
  if(path===undefined)throw new Error("evidence_path_required");
  const root=realpathSync(execFileSync("git",["rev-parse","--show-toplevel"],
    {encoding:"utf8"}).trim());
  const evidencePath=realpathSync(path);
  if(evidencePath===root||evidencePath.startsWith(`${root}${sep}`)){
    throw new Error("evidence_must_be_external");
  }
  const value=JSON.parse(readFileSync(evidencePath,"utf8"));
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"});
  const parsed=googleOauthEvidenceSchema.parse(value);
  if(!env.NETLIFY_AUTH_TOKEN)throw new Error("netlify_auth_required");
  const response=await fetchImpl(
    `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(parsed.stagingDeployId)}`,
    {headers:{authorization:`Bearer ${env.NETLIFY_AUTH_TOKEN}`},
      signal:AbortSignal.timeout(5_000)},
  );
  if(!response.ok)throw new Error("staging_metadata_unavailable");
  verifyGoogleOauthEvidence(parsed,{head,deployMetadata:await response.json(),now:new Date()});
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

The executable guard catches every error, emits only a closed code (never Zod input, deploy metadata, token, or file content), and exits nonzero. Tests call `verifyGoogleOauthEvidence` with injected metadata/clock and spawn the CLI with a temporary file outside the repository plus a mock Netlify fetch; a repository-local evidence path is rejected as `evidence_must_be_external`.

- [ ] **Step 2: Add deterministic adversarial fixtures**

Add one complete mock response for each case: direct allergen, allergen alias, processed food needing label confirmation, unsafe child shape, senior texture adaptation, unsupported medical/therapeutic request, missing portion branch, over-time timeline, must-use pantry omission, unavailable pantry quantity, duplicate whole regeneration, duplicate dish regeneration, malformed JSON, and valid fallback-model response. Extend Plan 3's existing `X-Kondate-Mock-Scenario` protocol; the production client sends that header only when its configured base URL is non-OpenRouter and `OPENROUTER_MOCK_SCENARIO` is set. Production deployment never defines that variable.

- [ ] **Step 3: Write failing full-journey and privacy tests**

Create `e2e/fixtures/function-logs.ts` using `execFile` rather than shell interpolation:

```ts
import { execFile } from "node:child_process";import { promisify } from "node:util";
const run=promisify(execFile);
export async function readFunctionLogs(since:string):Promise<string>{
  const {stdout}=await run("docker",["compose","logs","--no-color","--since",since,"app"],
    {maxBuffer:2_000_000});return stdout;
}
```

Create `e2e/fixtures/acceptance.ts` as a Node-side extension of the auth fixture. It parses `SUPABASE_SERVICE_ROLE_KEY` from `.env`, creates a non-persisting admin client for `http://127.0.0.1:8000`, and exports `queryOwnedCounts(userId)`. The latter validates `userId` with Zod and uses `execFile("docker",["compose","exec","-T","db","psql",...])` to query every `public`/`private` base table containing `user_id`, returning `{table,count}` JSON without printing row values. `seedCompleteOwnedGraph(page)` uses the existing onboarding, pantry, generation, revalidation, regeneration, and shopping fixture helpers, creates a generated menu targeting both a toddler and a senior with processed-food confirmation coverage, proves at least one normalized `menu_safety_actions` row was produced by Plans 2–3, and leaves a fresh planner draft. Before deletion, assert only a named `requiredNonEmptyFamilies` set (profile/household/privacy, pantry/draft, menu/dish/action/confirmation, history/revalidation, shopping) has positive counts; idempotency ledgers and other optional tables may legitimately remain zero. No service-role value enters `page`, browser storage, screenshots, or logs.

`full-journey.spec.ts` covers login fixture → resumable household setup → privacy confirmation → pantry must/prefer selection → full generation and recovery → timeline and dish tabs → label confirmation → whole and dish regeneration → accept → history group → shopping creation and approved reconciliation.

`privacy-logging.spec.ts` captures mock Function logs and asserts that names, test email, allergy free text, planner note, prompt markers, and raw mock response strings are absent while request ID, safe error code, duration, and model ID are present.

`account-deletion.spec.ts` creates a dedicated test user with the named required aggregate families, opens Plan 1's `/settings`, first proves the existing member edit/allergy/dislike controls are still present, then opens the composed Plan 6 danger zone and performs the exact-phrase flow. It verifies redirect to the login message, verifies the old access token receives `401`, and uses the service-role test fixture to assert zero Auth user and zero rows across every inventoried owned table—including tables whose pre-delete count was zero.

```ts
const before=await queryOwnedCounts(userId);
const requiredNonEmptyFamilies=new Set([
  "public.profiles","public.household_members","public.privacy_consents",
  "public.pantry_items","public.generation_drafts","public.menus","public.dishes",
  "public.menu_member_adaptations","public.menu_safety_actions",
  "public.menu_label_confirmations","public.menu_revalidations",
  "public.shopping_lists","public.shopping_items","public.shopping_label_confirmations",
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
npm run e2e -- e2e/specs/full-journey.spec.ts e2e/specs/privacy-logging.spec.ts e2e/specs/account-deletion.spec.ts
```

Expected: FAIL on every missing cross-feature fixture or behavior; failures identify a route, scenario, or leaked test marker.

- [ ] **Step 5: Fix only the surfaced integration gaps and complete the matrix**

Update product files owned by Plans 1–5 only where a failing acceptance test proves a gap. Add the exact final test title to its matrix row after the test passes. Do not weaken safety fixtures, replace assertions with snapshots, or skip an acceptance criterion.

- [ ] **Step 6: Run the complete deterministic test suite**

Run:

```bash
npm test -- --run
npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
node --test scripts/verify-release-evidence.test.mjs
npm run db:test
npm run e2e
```

Expected: unit/component/adversarial, pgTAP, and all Playwright tests report zero failures without contacting OpenRouter.

- [ ] **Step 7: Commit the acceptance suite**

```bash
git add docs/testing e2e tools/openrouter-mock src netlify/functions shared supabase scripts/verify-release-evidence.mjs scripts/verify-release-evidence.test.mjs
git commit -m "test: cover Kondate acceptance journeys"
```

### Task 7: Add deterministic GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Verify: `scripts/generate-local-secrets.sh`

**Interfaces:**
- Consumes: the root Compose project and all scripts established in Plans 1–6.
- Produces: one required `verify` job with artifacts on failure and no real OpenRouter traffic.

- [ ] **Step 1: Add a local CI aggregate and prove it stops on failure**

Add this package script, keeping the individual commands available:

```json
{
  "scripts": {
    "ci": "npm run format:check && npm run lint && npm run typecheck && npm test -- --run && npm run db:test && npm run db:types && git diff --exit-code -- src/shared/types/database.generated.ts && npm run e2e && npm run build && npm exec --offline netlify -- build --offline --context deploy-preview && docker compose config --quiet"
  }
}
```

Run `npm run ci` once with a deliberate failing focused test, verify later commands do not run, then revert that deliberate test change.

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
    timeout-minutes: 30
    env:
      CI: "true"
      OPENROUTER_MODELS: mock/kondate:free
      OPENROUTER_API_KEY: local-mock-key
      OPENROUTER_BASE_URL: http://127.0.0.1:8787/api/v1
      SERVER_SITE_ORIGIN: http://127.0.0.1:5173
      APP_ORIGIN: http://127.0.0.1:5173
      AUTH_CONTINUATION_ENCRYPTION_KEY: MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=
      VITE_MAGIC_LINK_RESEND_SECONDS: "60"
      VITE_AUTH_CONTINUATION_TTL_MS: "300000"
      VITE_AUTH_PROVIDER_MODE: oauth_mock
      VITE_OAUTH_MOCK_ORIGIN: http://127.0.0.1:8788
      GLOBAL_DAILY_AI_LIMIT: "45"
      USER_DAILY_AI_LIMIT: "5"
      USER_DAILY_EXTERNAL_CALL_LIMIT: "12"
      USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT: "4"
      USER_SHORT_WINDOW_SECONDS: "600"
      FAILED_GENERATION_LEDGER_RETENTION_DAYS: "30"
      AUTH_CONTINUATION_TTL_SECONDS: "300"
      OPENROUTER_TIMEOUT_MS: "20000"
      FUNCTION_TOTAL_BUDGET_MS: "50000"
      AI_PROCESSING_STALE_SECONDS: "180"
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Generate ephemeral local secrets
        run: ./scripts/generate-local-secrets.sh
      - name: Assert the canonical local continuation origin
        run: |
          test "$SERVER_SITE_ORIGIN" = "http://127.0.0.1:5173"
          test "$APP_ORIGIN" = "$SERVER_SITE_ORIGIN"
          test "$VITE_AUTH_PROVIDER_MODE" = "oauth_mock"
          test "$VITE_OAUTH_MOCK_ORIGIN" = "http://127.0.0.1:8788"
      - run: npm exec --offline playwright -- install --with-deps chromium
      - run: docker compose config --quiet
      - run: docker compose up -d --wait
      - run: curl --fail --silent --show-error http://127.0.0.1:8788/health
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test -- --run
      - run: npm run db:test
      - name: Verify public and private generated database types
        run: |
          npm run db:types
          git diff --exit-code -- src/shared/types/database.generated.ts
      - run: npm run e2e
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run build
      - run: npm exec --offline netlify -- build --offline --context deploy-preview
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

`npm run db:types` is locked to the offline/local command that emits both `--schema public,private` into `src/shared/types/database.generated.ts`; a source-level script test fails if either schema is omitted. `generate-local-secrets.sh` runs after `npm ci` and before any Compose interpolation. It creates only the gitignored `.env`, and the `always()` cleanup removes it even after a failed start/test. CI's explicit `SERVER_SITE_ORIGIN` and `APP_ORIGIN` both remain Plan 1's canonical `http://127.0.0.1:5173`; the assertion fails before E2E if shell environment overrides the generated file with a different continuation origin. The offline Netlify build does not change that local runtime origin. Do not upload database volumes, `.env`, traces containing typed household data, or Function log files. Configure Playwright screenshots, video, and traces as `retain-on-failure`; E2E fixtures use synthetic names and conditions only.

- [ ] **Step 3: Validate workflow syntax and reproduce its commands locally**

Run:

```bash
docker compose up -d --wait
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run db:test
npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
npm run e2e
npm audit --omit=dev --audit-level=high
OPENROUTER_MODELS=mock/kondate:free npm run build
npm exec --offline netlify -- build --offline --context deploy-preview
docker compose config --quiet
docker compose down --volumes
rm -f .env
```

Before the first command, run `npm ci && ./scripts/generate-local-secrets.sh`. Expected: every command exits 0, public/private generated types have no diff, the pinned offline Netlify CLI accepts the deploy-preview build, `.env` is absent after cleanup, and OpenRouter mock request counts confirm zero external calls.

- [ ] **Step 4: Commit CI**

```bash
git add .github/workflows/ci.yml package.json package-lock.json playwright.config.ts
git commit -m "ci: gate the complete MVP"
```

### Task 8: Write deployment runbooks and production smoke automation

**Files:**
- Create: `supabase/migrations/20260711005100_maintenance_cleanup.sql`
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

Write `maintenance_cleanup.test.sql` red first. It proves exact overloads `cleanup_stale_ai_generations(timestamptz,integer)`, `cleanup_ai_generation_requests(timestamptz,integer)`, `private.cleanup_shopping_mutations(timestamptz,integer)`, and `cleanup_auth_continuations(timestamptz,integer)` plus `run_kondate_maintenance(timestamptz,integer)`. It proves `kondate_maintenance_executor` is NOLOGIN, NOINHERIT, not superuser, cannot bypass RLS, has `USAGE` on `public` and `EXECUTE` on that one RPC only, and has no table, sequence, helper-function, or private-schema privilege. `public`, `anon`, `authenticated`, and `service_role` cannot execute the RPC. Seed terminal generation requests and shopping mutations at exactly 30 days, just older than 30 days, and 29 days; expired, claimed, and live continuations; expired processing reservations with both sent and unsent global slots; and more than one batch in both retention ledgers. Assert both exact 30-day boundaries are retained, only older terminal/shopping rows are deleted, expired/claimed continuations are deleted, live continuations remain, and stale reservations use Plan 3's canonical transition to release success plus only unsent attempt/global reservations. A second run returns all four zero counts; a batch of two leaves deterministic work for the next call; concurrent calls use `FOR UPDATE SKIP LOCKED` and never double-release or double-delete.

Write `maintenance-env.test.ts`, `maintenance-db.test.ts`, and `maintenance-cleanup.test.ts` red first. The local environment test accepts exactly `kondate_maintenance_login@127.0.0.1:54322/postgres?sslmode=disable` solely in explicit local-test mode. Production parsing additionally requires an explicit expected project ref previously extracted from the exact server Supabase origin, plus a `postgres:`/`postgresql:` URL with a non-empty password, canonical dedicated-login identity, exact `/postgres` path, canonical host/port, and `sslmode=require`, `verify-ca`, or `verify-full`. Accepted production shapes are direct `kondate_maintenance_login@db.<expected-project-ref>.supabase.co:5432` and IPv4 Supavisor Session `kondate_maintenance_login.<expected-project-ref>@<region>.pooler.supabase.com:5432`; the same valid shapes with another project ref, port `6543`, and every transaction-mode/dedicated pooler fail. They reject fragments, duplicate parameters, and every query key except the one `sslmode` key—especially `options`, `search_path`, timeout, role, and application-name overrides. They reject `localhost`, alternate local ports, credentials/query details in errors, and `VITE_SUPABASE_MAINTENANCE_DB_URL` even when empty. Mode-selection tests allow local parsing only for the conjunction `CONTEXT=dev && KONDATE_MAINTENANCE_ENV=local`; either key alone, any other value, deploy-preview, branch-deploy, or production selects strict production parsing and rejects loopback. Production preflight rejects the presence of `KONDATE_MAINTENANCE_ENV` even when empty. The adapter unit tests assert a single client per invocation, one overall deadline that begins before connection and never resets, parameterized fixed RPC SQL, the role/timeout guards, strict four-count result parsing before `COMMIT`, `ROLLBACK` when safe, and one idempotent `client.end()` after success, SQL failure, result-parse failure, server cancellation, and client timeout; environment-parse failure constructs no client. No log or thrown public error contains the URL, project ref, password, host, or raw driver error.

The Function test injects the clock, database adapter, and logger. It asserts one parsed counts-only maintenance call, `204`, safe metrics containing only `staleReservationsFinalized`, `generationLedgersDeleted`, `shoppingMutationsDeleted`, `authContinuationsDeleted`, and duration, closed `maintenance_cleanup_failed` logging, and no Supabase REST/admin client import. It imports `config`, expects `config` to equal `{schedule:"@hourly"}`, and rejects a `path` key. The source/config test documents that a Scheduled Function runs only for a published production deploy, has no directly invokable URL, and is locally debugged by starting `npm exec --offline netlify dev` with the generated local `.env`, then running `npm exec --offline netlify functions:invoke maintenance-cleanup` from a second terminal.

Write `maintenance-db.integration.test.ts` against the real local PostgreSQL path and dedicated login. Before the transaction it asserts `session_user=current_user='kondate_maintenance_login'` and `current_setting('statement_timeout')='20s'`; inside it asserts `session_user='kondate_maintenance_login'`, `current_user='kondate_maintenance_executor'`, and the local timeout remains `20s`. A fixed test-only seam, unavailable to requests and production call sites, runs the actual maintenance RPC and then `pg_sleep(21)` before commit; expect SQLSTATE `57014` near 20 seconds, assert all generation, shopping-mutation, and continuation writes rolled back from an independent admin connection, and prove the `kondate-maintenance` connection disappeared from `pg_stat_activity`. A second test lets earlier categories change rows while an admin connection holds an `ACCESS EXCLUSIVE` lock on the later `private.auth_continuations` table; the same real RPC must be canceled with `57014`, roll back the earlier generation and shopping deletion changes, release/close both clients in `finally`, and leave no partial cleanup. The 25-second client ceiling is a backstop and must not win over the database's 20-second error in either test.

The smoke test injects `fetch` and asserts these exact probes: `GET /` must return `200` HTML containing the root mount element; unauthenticated `POST /api/generations/menu` must return `401` and `auth_required`; unauthenticated `DELETE /api/account` must return `401` and `auth_required`. It must never call a generation route with authorization.

Write `verify-production-deploy.test.mjs` red first. Its pure verifier receives `candidateSha`, `tagSha`, `productionDeployId`, expected production origin, deploy metadata, and site metadata. The success fixture requires `HEAD === candidateSha === tagSha === deploy.commit_ref`, deploy `id` match, `context='production'`, `state='ready'`, exact HTTPS origin-only `deploy.ssl_url`, and `site.published_deploy.id === productionDeployId`. Table tests reject a wrong HEAD, candidate, tag, deploy SHA/ID/context/state/origin, stale site-published ID, credentials/path/query/fragment in the requested origin, missing metadata, and an extra/invalid input. The CLI reads HEAD and the annotated tag target with `execFileSync` argument arrays, fetches the named deploy then its site metadata with a five-second timeout and protected `NETLIFY_AUTH_TOKEN`, prints only `production_deploy: pass` or a closed code, and never prints metadata, token, origin, or raw response. `smoke-production.test.mjs` additionally proves the exact already-verified `PRODUCTION_ORIGIN` string is passed unchanged to all three probes.

Write `verify-browser-secrets.test.mjs` red first with a temporary synthetic source/build tree. It proves both a forbidden variable name and each synthetic secret value fail closed, clean fixtures pass, absent `dist/` is accepted before build, and diagnostics contain only the variable name plus relative file—not the secret, matching line, URL, or surrounding contents.

- [ ] **Step 2: Implement the least-privilege database path, scripts, and package commands**

Install the direct PostgreSQL driver as a Function runtime dependency and its types as a development dependency, preserving exact lockfile versions:

```bash
npm install --save-exact pg@8.22.0
npm install --save-dev --save-exact @types/pg@8.20.0
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

`preflight-production.mjs` validates `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PRIVACY_POLICY_URL`, `VITE_MAGIC_LINK_RESEND_SECONDS`, `VITE_AUTH_CONTINUATION_TTL_MS`, `VITE_AUTH_PROVIDER_MODE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MAINTENANCE_DB_URL`, `SERVER_SITE_ORIGIN`, `AUTH_CONTINUATION_ENCRYPTION_KEY`, `GENERATION_REQUEST_HMAC_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODELS`, `GLOBAL_DAILY_AI_LIMIT`, `USER_DAILY_AI_LIMIT`, `USER_DAILY_EXTERNAL_CALL_LIMIT`, `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT`, `USER_SHORT_WINDOW_SECONDS`, `FAILED_GENERATION_LEDGER_RETENTION_DAYS`, `AUTH_CONTINUATION_TTL_SECONDS`, `OPENROUTER_TIMEOUT_MS`, `FUNCTION_TOTAL_BUDGET_MS`, `AI_PROCESSING_STALE_SECONDS`, and `APP_ORIGIN`; it calls the exported OpenRouter parser plus Plan 1's `parseManagedSupabaseProjectRef` and the production parser from `maintenance-env.ts`. Both Supabase app URLs must be byte-identical exact managed origins, their extracted 20-character refs must be equal, both publishable-key variables must be byte-identical, and the maintenance parser receives that expected ref and requires the direct database host or Session username suffix to match. It checks all numeric values are positive integers; fixes the release-locked limits at exactly `5` successful generations, `12` user daily sends, `4` sends per `600` seconds, failed-ledger retention at `30` days, continuation TTL at `300` seconds/`300000` browser milliseconds, attempt timeout at `20000` ms, total Function budget at `50000` ms, and processing-stale threshold at exactly `180` seconds; requires `VITE_AUTH_PROVIDER_MODE === "supabase"`, rejects the presence of `VITE_OAUTH_MOCK_ORIGIN`, `KONDATE_MAINTENANCE_ENV`, and every `VITE_` alias of a server secret, requires the continuation key to decode to exactly 32 bytes and the generation HMAC key to use canonical base64 decoding to exactly 32 bytes, rejects the HMAC sample/local value, `SERVER_SITE_ORIGIN === APP_ORIGIN`, and `OPENROUTER_BASE_URL` to equal `https://openrouter.ai/api/v1`; it performs no network call. Extend Plan 3's `_shared/env.test.ts` with the same production HMAC cases while leaving its runtime parser the sole owner of decoded key material. Its tests call the validator with an explicit object and spawn the CLI with a complete synthetic `env` object that does not spread or inherit `process.env`, so ambient developer variables cannot hide a missing deployment variable, generation key, maintenance credential, cross-project endpoint, or mock-provider leak. Errors name the missing variable or a closed validation code only, never a URL component, project ref, or secret value.

`smoke-production.mjs` requires one HTTPS origin argument, rejects a URL with credentials/query/fragment, runs the three probes above with a five-second `AbortSignal.timeout(5000)`, and exits nonzero with the probe name and HTTP status only. It never prints a response body or environment value.

`verify-production-deploy.mjs` requires `CANDIDATE_SHA`, `RELEASE_TAG`, `PRODUCTION_DEPLOY_ID`, and exact HTTPS origin-only `PRODUCTION_ORIGIN` plus `NETLIFY_AUTH_TOKEN`. It reads HEAD and `git rev-list -n 1 <tag>` without a shell, fetches `GET /api/v1/deploys/:productionDeployId`, then `GET /api/v1/sites/:site_id`, and applies the pure checks from Step 1. Both requests use `AbortSignal.timeout(5000)`. `site_id` is accepted only from the validated deploy response and URL-encoded; no caller-provided API URL exists. The site response must identify the same deploy as its current `published_deploy`, preventing a ready but superseded production deploy from satisfying the gate. The script emits only its closed pass/error code. Task 9 runs it immediately before and after `smoke-production -- "$PRODUCTION_ORIGIN"`; a concurrent publish or origin change therefore closes the release rather than blessing the wrong deploy.

`verify-browser-secrets.mjs` scans `src/` and any built `dist/` for the forbidden server-variable names and for the non-empty values of `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GENERATION_REQUEST_HMAC_KEY`, `SUPABASE_MAINTENANCE_DB_URL`, `MAINTENANCE_DB_PASSWORD`, and `NETLIFY_AUTH_TOKEN` present in its explicit environment. It reports only the variable name and relative file, never the matching value or line contents, and exits nonzero on a match. Its tests use synthetic secrets and fixtures to prove both name/value detection and redacted output. CI runs it after the build with the generated `.env`; the protected release runner runs it after the production build with its transient complete server-secret environment.

Migration `051` keeps the exact Plan 1/Plan 3 one-argument cleanup signatures as compatibility wrappers and moves their existing transitions into bounded two-argument overloads (`1..250`, `FOR UPDATE SKIP LOCKED`). It adds `private.cleanup_shopping_mutations(p_before timestamptz,p_limit integer)` with the same `1..250` bound; it deletes only `private.shopping_mutations.created_at < p_before`, orders by `created_at,user_id,idempotency_key`, locks with `FOR UPDATE SKIP LOCKED`, and returns one count. Exact-boundary rows are retained. The helper has no public wrapper because no browser/service path consumes it. Migration `051` creates or normalizes `kondate_maintenance_executor` as `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`; the migration never creates a LOGIN or embeds a password. The executor receives only `USAGE ON SCHEMA public` and `EXECUTE ON FUNCTION public.run_kondate_maintenance(timestamptz,integer)`. Revoke the RPC from `PUBLIC`, `anon`, `authenticated`, and `service_role`, and revoke table, sequence, private-schema, and every bounded-helper privilege—including the shopping helper—from the executor. Existing one-argument wrappers keep only the preexisting service-role permissions required by Plans 1 and 3; neither the executor nor the Scheduled Function calls them directly.

`run_kondate_maintenance` does not duplicate quota-release or replay SQL. It calls the canonical bounded transitions in this fixed order: stale reservations, terminal generation ledgers with `updated_at < p_now - interval '30 days'`, shopping mutation replays with `created_at < p_now - interval '30 days'`, then expired-or-claimed continuations. The RPC is `SECURITY DEFINER SET search_path=''`, uses schema-qualified references and fixed SQL only, and returns this strict JSON object:

```json
{
  "staleReservationsFinalized": 0,
  "generationLedgersDeleted": 0,
  "shoppingMutationsDeleted": 0,
  "authContinuationsDeleted": 0
}
```

Do not put `set_config('statement_timeout',...)` inside the RPC and do not claim that a function-local setting bounds its containing command: PostgreSQL chooses the statement timeout before executing that command. Each of the four categories receives the same caller-supplied maximum of 250, so one invocation is bounded and reentrant; excess work remains for the next hour. Never delete a processing row as terminal-ledger retention, a menu-referenced request, a shopping mutation at or newer than the exact 30-day boundary, or a live unclaimed continuation.

Append safe placeholders for `KONDATE_MAINTENANCE_ENV=local`, `MAINTENANCE_DB_PASSWORD`, and `SUPABASE_MAINTENANCE_DB_URL` to `.env.example`. The stable `scripts/generate-local-secrets.sh` wrapper delegates to `scripts/generate-local-secrets.mjs`; that implementation creates a URL-safe random local password, percent-encodes its credential component, and writes `KONDATE_MAINTENANCE_ENV=local` plus the password and exact URL `postgresql://kondate_maintenance_login:<encoded>@127.0.0.1:54322/postgres?sslmode=disable` only to the mode-`0600`, gitignored `.env`. It never prints them. `scripts/provision-maintenance-role.sh` reads the password without shell tracing or command-line exposure, provisions `kondate_maintenance_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`, grants membership in the NOLOGIN executor, and executes `ALTER ROLE kondate_maintenance_login SET statement_timeout='20s'`. It is idempotent for local/CI use, sends password material to `psql` through protected stdin/environment only, emits closed status text without SQL/URLs, and unsets it before exit. Its source test rejects `set -x`, password/URL echoing, password-bearing argv, committed literal credentials, or provisioning the LOGIN in a migration.

`maintenance-env.ts` returns an opaque validated connection string without logging or serialization helpers. Production parsing requires `{mode:"production",expectedProjectRef}` where the ref has already been extracted by Plan 1's exact managed-origin helper; absence or malformed ref fails before URL inspection. It accepts only `postgres:`/`postgresql:`, non-empty password, exact `/postgres` path, no fragment, and exactly one query parameter: `sslmode` in the set `require|verify-ca|verify-full`. It accepts either `db.<expectedProjectRef>.supabase.co:5432` with URL username exactly `kondate_maintenance_login`, or Supavisor Session mode on port `5432` with canonical URL-routing username `kondate_maintenance_login.<expectedProjectRef>`; the latter suffix is transport metadata, while the post-connect guard must still see exact database `session_user='kondate_maintenance_login'`. A syntactically valid direct or Session URL for any other project fails closed. This rejects URL-supplied `options`, role, search-path, timeout, application-name, duplicate-key overrides, port `6543`, and every transaction-mode pooler. Although transaction mode is normally attractive for serverless traffic, it cannot guarantee the session-level role default required here; this one hourly connection is instead capped at 25 seconds, limited to two login connections, and always closed. The local-test parser alone accepts exact host `127.0.0.1`, port `54322`, exact login username, `/postgres`, and sole `sslmode=disable`; `localhost`, IPv6 loopback, and any other port fail. `selectMaintenanceEnvironmentMode` returns that mode only for `CONTEXT=dev && KONDATE_MAINTENANCE_ENV=local`. Both parsers reject `VITE_SUPABASE_MAINTENANCE_DB_URL` by key presence, and production preflight rejects the local-mode key itself.

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

Implement the Scheduled Function with the current Netlify code configuration and no HTTP route:

```ts
import type { Config } from "@netlify/functions";
import { runMaintenance } from "./_shared/maintenance-db";
import { parseMaintenanceDatabaseEnv, selectMaintenanceEnvironmentMode } from "./_shared/maintenance-env";
import { parseManagedSupabaseProjectRef } from "./_shared/env";

export default async function maintenanceCleanup():Promise<Response>{
  const started=performance.now();
  const deadline=AbortSignal.timeout(25_000);
  try{
    const mode=selectMaintenanceEnvironmentMode(process.env);
    let connectionString:string;
    if(mode==="local"){
      connectionString=parseMaintenanceDatabaseEnv(process.env,{mode});
    }else{
      const expectedProjectRef=parseManagedSupabaseProjectRef(
        String(process.env.SUPABASE_URL ?? ""));
      if(expectedProjectRef===null) throw new Error("supabase_project_invalid");
      connectionString=parseMaintenanceDatabaseEnv(process.env,
        {mode,expectedProjectRef});
    }
    const counts=await runMaintenance({
      connectionString,now:new Date().toISOString(),batchSize:250,
      signal:deadline,
    });
    console.info(JSON.stringify({event:"maintenance_cleanup",...counts,
      durationMs:Math.round(performance.now()-started)}));
    return new Response(null,{status:204});
  }catch{
    console.error(JSON.stringify({event:"maintenance_cleanup",
      errorCode:"maintenance_cleanup_failed",
      durationMs:Math.round(performance.now()-started)}));
    return new Response(null,{status:500});
  }
}
export const config:Config={schedule:"@hourly"};
```

The login-default/database ceiling (20 seconds), node-postgres client timeout (25 seconds), and Netlify Scheduled Function maximum (30 seconds) are ordered and independently tested. `schedule` is mutually exclusive with `path`; this Function therefore appears in no API route table and cannot be invoked by URL. It runs only on published production deploys, not deploy previews. The local runbook provisions the dedicated local login, starts Netlify Dev in its canonical `dev` context so the generated local-mode marker is honored, and then uses the CLI invocation above; standalone or production-context invocation with a loopback or cross-project URL fails closed. Monitoring records the four counts, duration, and a closed error code only—never row IDs, mutation response JSON, continuation fields, prompts, user data, project refs, database error text, hostnames, usernames, or connection strings.

- [ ] **Step 3: Write the Supabase deployment runbook with exact order**

`docs/deployment/supabase.md` specifies:

1. Create the managed project in the chosen region and record its exact 20-character project ref, exact origin `https://<project-ref>.supabase.co`, publishable key, service-role key, and administrator deployment database URL in the deployment secret manager. These are distinct from the maintenance credential. Reject a custom/arbitrary REST origin for this MVP; browser and server app URLs are the same recorded managed origin and their publishable keys are identical.
2. Configure Site URL to the canonical Netlify HTTPS origin and allow only Plan 1's canonical local `http://127.0.0.1:5173/auth/callback`, the Netlify production callback, and explicitly approved deploy-preview callbacks.
3. Configure Google provider credentials and magic-link email templates; verify both callback paths in a staging project.
4. Run `npm exec --offline supabase -- db push --db-url "$SUPABASE_DB_URL" --include-all` from a clean tagged commit, including `20260711005100_maintenance_cleanup.sql` after account-deletion migration `050`.
5. Generate a unique maintenance password in the deployment secret manager. Through protected administrator `psql` with history, echo, statement logging, and shell tracing disabled, create or normalize `kondate_maintenance_login` as `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`, set/rotate its password with `psql`'s protected password-input path, grant `kondate_maintenance_executor` membership, and execute `ALTER ROLE kondate_maintenance_login SET statement_timeout='20s'`. Pass secret material through protected stdin/environment, never a CLI argument or SQL editor; SQL editors may be used only for the non-secret grant/default statements if their transcripts are protected. The committed migration creates only the NOLOGIN executor and RPC grants.
6. If the Netlify runtime can reach the project's IPv6 direct endpoint or the project has the IPv4 add-on, build the TLS-required direct URL with exact host `db.<the-recorded-project-ref>.supabase.co:5432` and username `kondate_maintenance_login`. Otherwise use the official IPv4 Supavisor **Session** URL on port `5432`, replacing its role prefix with `kondate_maintenance_login` while retaining exactly the same recorded project-ref routing suffix. A ref copied from another environment is a hard failure even when its credentials connect. Percent-encode credential components without ever printing the intermediate URL, store the result only as the Netlify Functions-scoped `SUPABASE_MAINTENANCE_DB_URL`, and immediately discard local copies. Never use port `6543`/transaction mode, a service-role JWT, administrator database password, repository, ticket, shell history, or log as storage; session mode is required for the login default and one-client transaction semantics.
7. Connect once with the dedicated URL and verify `session_user=current_user='kondate_maintenance_login'` and `current_setting('statement_timeout')='20s'` before any transaction. Then verify a transaction can `SET LOCAL ROLE kondate_maintenance_executor`, sees the same `20s`, can call only the maintenance RPC, and cannot select owned tables or execute another application RPC. Output booleans/role names only; redact the connection command and URL.
8. Run the database suite, including the exact 30-day terminal-generation and `private.shopping_mutations` boundaries, four-count readback, and real 20-second cancellation/rollback integration tests, against staging, not production; promote the same migration files to production only after staging passes. Run `npm exec --offline supabase -- gen types typescript --db-url "$SUPABASE_DB_URL" --schema public,private > /tmp/database.generated.ts`, compare both schemas to the committed generated type through `diff -u`, and fail on any public/private drift.
9. Verify catalog versions and privacy explanation version, then create no production demo household data.

The runbook states migrations are forward-only. A failure before traffic is fixed by a new migration; rollback of frontend traffic uses Netlify’s previous deploy, never `db reset` or destructive migration reversal. Maintenance credential rollback is independent: disable the schedule, revoke LOGIN or executor membership, terminate only that login's sessions, rotate the secret, and read back role/default/privilege state before re-enabling. No runbook command prints a password or connection URL, and all operator transcripts/artifacts are checked for their absence.

- [ ] **Step 4: Write the Netlify and operations runbooks**

`docs/deployment/netlify.md` lists the exact browser-safe and server-only variables above, sets both Supabase app URLs to the same exact managed origin and both publishable-key variables to the same value, sets `VITE_AUTH_PROVIDER_MODE=supabase`, proves `VITE_OAUTH_MOCK_ORIGIN` and `KONDATE_MAINTENANCE_ENV` are absent, sets `VERIFY_OPENROUTER_REMOTE=1` for production builds, requires the canonical `APP_ORIGIN`, and requires `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` exactly. It adds both `GENERATION_REQUEST_HMAC_KEY` and the same-project `SUPABASE_MAINTENANCE_DB_URL` only through Netlify's protected Functions runtime scope—not Builds, deploy logs, `netlify.toml`, repository files, preview contexts, or any `VITE_` key—and validates them without printing either value. Before deployment, a protected release runner injects the same secrets transiently into an environment-clean `npm run preflight:production` subprocess; only its exit status and closed check names enter release evidence, and the site build receives neither. The HMAC key is stable across MVP deploys because retained requests store only the HMAC: rotation requires a reviewed new HMAC version/keyring migration plus explicit pending-command handling, never an ad-hoc environment replacement. The runbook confirms the five-second provider/live-model verification separately in the deploy log and deploys the tagged commit. It obtains `PRODUCTION_DEPLOY_ID` and `PRODUCTION_ORIGIN` only from authoritative Netlify deploy/site metadata inside the protected runner, verifies them with `verify:production-deploy`, passes that unchanged verified origin to `smoke:production`, and verifies the deploy again afterward. An operator-typed smoke origin, example URL, artifact-supplied origin, or unverified environment override is forbidden. The local `oauth-mock` service/origin, local-mode marker, sample HMAC key, and local maintenance password/URL are never copied into a Netlify site variable. Maintenance-password rotation creates a new dedicated password, atomically replaces the protected variable, verifies one scheduled run, and then invalidates the old password without exposing either value.

`docs/runbooks/openrouter.md` instructs the operator to query the Models API for current `:free` IDs through the fixed five-second metadata deadline, require `structured_outputs` and `response_format`, run the fixed adversarial corpus in staging, order models explicitly, update only `OPENROUTER_MODELS`, redeploy, and confirm no paid or automatic model was added. It records the release-locked controls—exactly 5 successful generations per user/JST day, exactly 12 external sends per user/JST day, exactly 4 sends per fixed 600 seconds, 20-second per-attempt timeout, and 50-second total Function budget—and forbids operational tuning of 5/12/4/600 without a reviewed release. It also documents the `maintenance-cleanup` Scheduled Function: `@hourly`, published production only, 250 rows in each of four categories, exact 30-day generation/shopping retention, dedicated PostgreSQL login, role-default and transaction-local 20-second database bounds, 25-second client bound under the 30-second platform limit, idempotent reentry, mandatory connection cleanup, and four-count-only monitoring. Local diagnosis first provisions the ephemeral local login, starts `npm exec --offline netlify dev`, and then uses `npm exec --offline netlify functions:invoke maintenance-cleanup` from another terminal; no URL probe is attempted. A timeout requires checking only the closed failure metric and aggregate row counts, then reproducing against staging tests that assert SQLSTATE `57014`; never enable raw driver errors or print the maintenance URL. If no verified free model exists, keep AI unavailable and leave emergency menus enabled.

`docs/runbooks/account-deletion.md` explains the user-visible hard-delete flow, a safe support response that does not request allergy data or tokens, verification through aggregate counts rather than PII logs, and escalation when the Auth Admin API returns an error. It never instructs an operator to delete rows manually before deleting the Auth user.

- [ ] **Step 5: Run runbook automation and documentation checks**

Update `.github/workflows/ci.yml` so the role boundary is exercised rather than mocked. Immediately after `docker compose up -d --wait`, run `./scripts/provision-maintenance-role.sh`; run the five local-safe Node script tests shown below and the dedicated integration command before the ordinary test suite; and run `npm run verify:browser-secrets` after each browser build. The production-deploy verifier unit test uses injected metadata only and never contacts Netlify in CI. The generated `.env` supplies both local maintenance values and remains mode `0600`; neither value appears in workflow `env`, command arguments, uploaded artifacts, test names, failure output, or container diagnostics. Keep the existing `if: always()` teardown and `.env` removal. Update the root `ci` package script to include those Node tests, `npm run test:maintenance-db:integration` after unit tests, and `npm run verify:browser-secrets` after build, and document that its caller must have generated `.env`, started Compose, and provisioned the role first.

Run:

```bash
node --test scripts/provision-maintenance-role.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs
npm test -- --run netlify/functions/_shared/maintenance-env.test.ts netlify/functions/_shared/maintenance-db.test.ts netlify/functions/maintenance-cleanup.test.ts
npm run db:test -- supabase/tests/database/maintenance_cleanup.test.sql
npm run test:maintenance-db:integration
npm run verify:browser-secrets
npm run format:check
test "$(rg -n 'GENERATION_REQUEST_HMAC_KEY|SUPABASE_MAINTENANCE_DB_URL|MAINTENANCE_DB_PASSWORD' src | wc -l)" -eq 0
```

Before the focused database commands, generate `.env`, start the stack, and run `./scripts/provision-maintenance-role.sh`; use an `EXIT` trap to stop Compose and remove `.env` without printing either maintenance value. Expected: script tests pass, including a CLI subprocess whose `env` is a complete synthetic HTTPS production configuration built from an empty object and which accepts no inherited/local variables; removing each required key, changing either app project ref/key, or changing the maintenance project ref fails with a closed code. The migration privilege assertions and exact generation/shopping 30-day boundaries pass; the real login reports its 20-second default before `BEGIN`; both the `pg_sleep` and relation-lock paths return SQLSTATE `57014` around 20 seconds, roll back generation/shopping/continuation changes, and leave no maintenance connection. Unit tests prove four-count cleanup on all outcomes. The production deploy unit test rejects every SHA/tag/origin/current-published-deploy mismatch. Do not run `preflight:production` against the local mock `.env`, because production mode correctly rejects that environment. The real command runs only in the protected release runner with a complete secret-manager environment as required by `docs/deployment/netlify.md`; the Netlify site build does not receive the maintenance URL. Markdown formatting and browser-source secret-name scans pass.

- [ ] **Step 6: Commit deployment automation and runbooks**

```bash
git add .env.example .github/workflows/ci.yml supabase/migrations/20260711005100_maintenance_cleanup.sql supabase/tests/database/maintenance_cleanup.test.sql netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts netlify/functions/_shared/maintenance-env.ts netlify/functions/_shared/maintenance-env.test.ts netlify/functions/_shared/maintenance-db.ts netlify/functions/_shared/maintenance-db.test.ts netlify/functions/_shared/maintenance-db.integration.test.ts netlify/functions/maintenance-cleanup.ts netlify/functions/maintenance-cleanup.test.ts scripts/generate-local-secrets.sh scripts/generate-local-secrets.mjs scripts/provision-maintenance-role.sh scripts/provision-maintenance-role.test.mjs scripts/preflight-production.mjs scripts/preflight-production.test.mjs scripts/smoke-production.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.mjs scripts/verify-browser-secrets.test.mjs docs/deployment docs/runbooks package.json package-lock.json
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

Complete all 22 acceptance-matrix ownership/test-title rows. Create `release-checklist.md` as the immutable command/check template: required tool versions, every gate command, expected exit status, 22/22 rule, links to the four deployment/runbook documents, the four-category maintenance-login/default-timeout/privilege/retention checks, the external evidence location policy, the authoritative current-production-deploy checks before and after smoke, and the rule that the tested candidate is obtained with `git rev-parse HEAD`. Do not put a guessed/self-referential commit SHA, execution result, user value, database URL, credential, or raw log in the repository.

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
npm ci
./scripts/generate-local-secrets.sh
docker compose up -d --wait
./scripts/provision-maintenance-role.sh
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run db:test
npm run test:maintenance-db:integration
npm run db:types
git diff --exit-code -- src/shared/types/database.generated.ts
npm run e2e
npm audit --omit=dev --audit-level=high
OPENROUTER_MODELS=mock/kondate:free npm run build
npm run verify:browser-secrets
npm exec --offline netlify -- build --offline --context deploy-preview
npm run verify:browser-secrets
node --test scripts/provision-maintenance-role.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs scripts/verify-release-evidence.test.mjs
docker compose config --quiet
test "$(rg -n 'OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|GENERATION_REQUEST_HMAC_KEY|SUPABASE_MAINTENANCE_DB_URL|MAINTENANCE_DB_PASSWORD|NETLIFY_AUTH_TOKEN' dist src | wc -l)" -eq 0
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

The protected release record stores `candidateSha`, production deploy ID, UTC execution date, Node/npm/Compose versions, command exit statuses/counts, 22/22, and the verified external Google artifact reference—never its sensitive inputs, origin value, metadata body, or raw logs. Production preflight/live model metadata verification, migration `051`, tag, current Netlify `published_deploy`, both production metadata checks, and the intervening smoke must all resolve to `CANDIDATE_SHA` and the one verified origin. `PRODUCTION_ORIGIN` is populated only by the protected metadata-readback step and is immutable for the command block; typing or copying an example origin is forbidden. There is no post-evidence repository commit; if any gate, staging check, production metadata check, or smoke fails, fix it in a new commit, discard the stale artifact/tag candidate, capture the new HEAD, and repeat Steps 3–4.

## Plan Completion Gate

Before calling this plan complete, run the roadmap’s global verification gate plus the public/private type diff and offline Netlify build, confirm `docs/testing/acceptance-matrix.md` has 22 populated rows, confirm the account-deletion E2E proves Auth and all inventoried owned-row removal with a non-empty normalized safety-action producer fixture, and verify the unexpired external Google artifact against current HEAD and authoritative staging metadata. Run `npm run preflight:production` from an empty explicit environment containing one exact managed Supabase project across browser/server/maintenance, a fresh canonical 32-byte production HMAC key, and all other required values; then run `npm run verify:browser-secrets` with that protected complete environment to scan names and values. Run `rg -n "OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|GENERATION_REQUEST_HMAC_KEY|SUPABASE_MAINTENANCE_DB_URL|MAINTENANCE_DB_PASSWORD|NETLIFY_AUTH_TOKEN" dist src` expecting no matches. Confirm the dedicated maintenance login starts at `statement_timeout='20s'`, the executor's grants remain exact, generation and shopping mutation exact 30-day boundaries plus four-count readback pass, both SQLSTATE `57014` rollback tests pass, and `pg_stat_activity` has no leaked maintenance connection. Finally rerun the authoritative production deploy verifier around smoke, require current `published_deploy`, HEAD, tag, `commit_ref`, and verified smoke origin to equal the candidate contract, and confirm the worktree is clean. Then use `superpowers:verification-before-completion` and report the exact commands and outcomes without reproducing credentials, project refs, origins, metadata, or raw database errors.

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
