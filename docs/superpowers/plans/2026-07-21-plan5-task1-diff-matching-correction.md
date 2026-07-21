# Plan 5 Task 1 Diff-Matching Plan Correction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct Plan 5 Task 1's literal `computeShoppingDiff` implementation so it can satisfy Plan 5 Task 1's own literal `diff.test.ts` assertion for a protected numeric row whose regenerated requirement becomes ambiguous, consistent with the design spec's two-stage protected-row rule.

**Architecture:** Modify only the protected-row branch of `computeShoppingDiff` in `shared/shopping/diff.ts` (as specified by Plan 5 Task 1 Step 4) to fall back to a normalized-name lookup across both numeric and ambiguous next-draft buckets when the protected row's own `diffKey` does not find a candidate. Non-protected replace/remove matching is unchanged.

**Tech Stack:** TypeScript strict mode, Vitest.

## Global Constraints

- Modify only `docs/superpowers/plans/2026-07-11-kondate-mvp-05-shopping-list.md` Task 1 Step 4's `shared/shopping/diff.ts` listing (the plan document) and, on implementation, `shared/shopping/diff.ts` itself. Do not touch Task 1's contracts, aggregation, or any other Task's files.
- Preserve every other Task 1 behavior: one-to-one ambiguous-row consumption, `resolveApprovedDiff` strict subset checking, `protectedItemIds` collection, and the `isManual` skip.
- Preserve `shared/shopping/diff.test.ts` exactly as transcribed from the plan; no test is weakened or removed to make this pass.
- Code comments in the corrected implementation are Japanese.

---

## Defect Found

Plan 5 Task 1 Step 1 (`shared/shopping/diff.test.ts`) contains this exact test (plan lines 272–280):

```ts
it("keeps a removed row and proposes its larger known delta or unknown review item",()=>{
  const removed=makeItem({quantityValue:1,quantityText:"1本",unit:"本",isRemovedByUser:true});
  const next=makeDraft();next.items[0]={...next.items[0]!,displayName:"にんじん",
    normalizedName:"にんじん",quantityValue:3,quantityText:"3本",unit:"本"};
  expect(computeShoppingDiff(makeShoppingList([removed]),next).add[0])
    .toMatchObject({quantityValue:2,quantityText:"2本"});
  next.items[0]={...next.items[0]!,quantityValue:null,quantityText:"適量",unit:null};
  expect(computeShoppingDiff(makeShoppingList([removed]),next).add[0])
    .toMatchObject({pantryCheckRequired:true});
});
```

The second assertion calls `computeShoppingDiff` again on the same protected `removed` row (numeric, `unit:"本"`), but with the next-draft candidate now ambiguous (`quantityValue:null,unit:null`).

Plan 5 Task 1 Step 4's literal `diff.ts` (plan lines 653–692) matches protected rows by calling `takeCandidate(diffKey(item))`, where `diffKey(item)` is computed from the *protected current row's own shape*. For `removed` (numeric, unit `"本"`), this always produces the numeric bucket key `["numeric","にんじん","本"]`, which never matches the ambiguous candidate's bucket key `["ambiguous","にんじん",null,"適量","produce"]`. The literal implementation therefore can never reach its own `else if (candidate !== undefined)` review branch for this case; the ambiguous candidate falls through untouched to the unconditional leftover flush (`add.push(...[...nextBuckets.values()].flat())`) and is emitted with the default `pantryCheckRequired:false`, not `true`.

Verified independently: running the plan's literal test against the plan's literal implementation reproduces exactly one failure (`pantryCheckRequired: false` vs. expected `true`); all other 9 Task 1 tests pass unmodified.

The design spec (`docs/superpowers/specs/2026-07-11-kondate-mvp-design.md:302`) requires: a protected row with a same-name, same-unit new requirement gets a safe delta; a same-name row whose new requirement cannot be safely subtracted (unit lost, becomes ambiguous, etc.) must produce a separate confirmation item rather than being silently dropped or emitted as a plain unchecked add. The literal `diffKey`-only lookup structurally cannot reach that second case for a protected row, contradicting the design spec.

## Correction

### Task 1: Fall back to normalized-name matching for protected rows only

**Files:**
- Modify: `shared/shopping/diff.ts` (Plan 5 Task 1 Step 4 listing, and the implementation file if already created)

**Interfaces:**
- No exported signature changes. `computeShoppingDiff(current,next): ShoppingDiff` and `resolveApprovedDiff` keep their exact Task 1 signatures and behavior for every other case.

- [ ] **Step 1: Change only the protected-row candidate lookup**

Within the `for (const item of current.items)` loop, inside the `if (protectedItem(item))` branch, after the `if (item.isManual) continue;` line, replace the single `takeCandidate(diffKey(item))` lookup with: try the exact `diffKey(item)` match first (preserves current delta behavior when shapes match exactly), and only if that misses, fall back to a normalized-name scan across the remaining `nextBuckets` entries — taking the first item (in bucket-insertion order) whose `normalizedName` equals `item.normalizedName`, regardless of numeric/ambiguous shape. This fallback applies only inside the protected branch; non-protected replace/remove matching keeps its exact `diffKey` equality with no name fallback.

```ts
// protected row（購入済み・手動・編集済み・削除済み）は、まず完全一致キーで候補を探す。
// 完全一致がなければ、同じ正規化名の候補を numeric/ambiguous を問わず探す
// （設計仕様: 同単位なら安全な差分、そうでなければ別項目で確認を求める）。
const exactCandidate = takeCandidate(diffKey(item));
const candidate = exactCandidate ?? takeCandidateByName(item.normalizedName);
```

Add a helper adjacent to `takeCandidate` that scans `nextBuckets` values for the first entry matching by `normalizedName`, removes it from its bucket (preserving one-to-one consumption for the ambiguous-row test), and returns it:

```ts
const takeCandidateByName=(normalizedName:string):ShoppingDraftItem|undefined=>{
  for(const [key,bucket] of nextBuckets){
    const index=bucket.findIndex((entry)=>entry.normalizedName===normalizedName);
    if(index===-1)continue;
    const [candidate]=bucket.splice(index,1);
    if(bucket.length===0)nextBuckets.delete(key);
    return candidate;
  }
  return undefined;
};
```

Note the known limitation: because `current.items` is iterated in array order, an earlier protected row's name-fallback lookup can consume a candidate that a later non-protected or protected row of the same name would also have matched. This is not exercised by Plan 5 Task 1's tests (each test uses at most one row per name) and is acceptable for this correction's scope; a future Task touching multi-row same-name protected reconciliation must re-examine this ordering dependency.

- [ ] **Step 2: Re-run Task 1's exact tests and verify full GREEN**

Run: `npm test -- --run shared/shopping/aggregate.test.ts shared/shopping/diff.test.ts`

Expected: all 10 tests pass, including both assertions in `"keeps a removed row and proposes its larger known delta or unknown review item"`.

- [ ] **Step 3: Typecheck and commit as part of Task 1's commit**

This correction is folded into Plan 5 Task 1's own commit (`feat: define exact shopping contracts`); it is not a separate commit, since Task 1 has not yet been committed. Record this correction file's existence in the commit body only if the repository convention requires citing corrections (see Plan 2 Task 2 correction precedent); otherwise the correction document itself is the durable record.


---

## Addendum: Plan 5 Task 2 pgTAP API Defect (found during Task 2 RED)

**Defect:** Plan 5 Task 2 Step 1's literal pgTAP assertions call:

```sql
select has_unique('public','dish_ingredients','dish_ingredients_id_user_unique',
  'shopping source owner FK has an exact referenced unique key');
select has_unique('public','menu_label_confirmations','menu_label_confirmations_id_user_unique',
  'shopping label owner FK has an exact referenced unique key');
```

pgTAP's real `has_unique(...)` (installed in the `extensions` schema in this project, confirmed via `\df extensions.has_unique`) only accepts 1–3 arguments — `(table)`, `(table,description)`, or `(schema,table,description)` — and asserts that a table *has at least one* unique constraint. It has no 4-argument overload and cannot check for a *specific named* unique constraint/index. Running the plan's literal 4-argument call against the local Postgres/pgTAP install fails with `function has_unique(unknown, unknown, unknown, unknown) does not exist`, confirmed independently against this repository's actual `db-test` stack (not a transcription error — the literal plan text was copied verbatim and reproduces the same error).

**Correct replacement:** pgTAP's `has_index(schema, table, index_name [, description])` is the function that asserts a specific named index/unique-constraint exists on a table. Both assertions are corrected to:

```sql
select has_index('public','dish_ingredients','dish_ingredients_id_user_unique',
  'shopping source owner FK has an exact referenced unique key');
select has_index('public','menu_label_confirmations','menu_label_confirmations_id_user_unique',
  'shopping label owner FK has an exact referenced unique key');
```

This preserves the exact same test intent (assert Task 2's two prerequisite `(id,user_id)` unique constraints exist before dependent FKs reference them) and changes no other assertion, plan count, or migration content.

Applied directly to `supabase/tests/database/shopping_lists.test.sql` (implementation) since this is a plan-test tooling-API defect, not a design/behavior contradiction — no design spec section addresses pgTAP function names, so there is no ambiguity to escalate; the fix is mechanical and verifiable by running the corrected assertion against the real pgTAP installation.


---

## Addendum 2: Plan 5 Task 2 pgTAP `row_security_is` Does Not Exist

**Defect:** Plan 5 Task 2 Step 1's literal pgTAP assertions call `row_security_is('public','shopping_lists',true)` (and five more tables). This function does not exist in this repository's installed pgTAP extension (`\df extensions.row_security_is` returns zero rows); running it raises `function row_security_is(unknown, unknown, boolean) does not exist`, confirmed independently against the real `db-test` stack.

**Correct replacement:** This repository's established, working convention (used in `03_pantry_and_planner_drafts.test.sql`, `003_catalog_grants.test.sql`, `04_menu_core.test.sql`) checks `pg_class.relrowsecurity` directly:

```sql
select ok((select relrowsecurity from pg_class where oid = 'public.shopping_lists'::regclass),
  'shopping_lists has RLS enabled');
```

All six `row_security_is(...)` calls are replaced with this exact repository-convention form, one per table, preserving the same six assertions and the same total plan count of 41.


---

## Addendum 3: Plan 5 Task 2 pgTAP `ok(not has_function(...))` Type Error

**Defect:** Plan 5 Task 2 Step 1's literal assertion:

```sql
select ok(not has_function('private','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb']),
  'callable draft RPC is not hidden in private');
```

`has_function(...)` returns pgTAP's TAP-formatted `text` result, not `boolean`; wrapping it in `not` fails with `argument of NOT must be type boolean, not type text`, confirmed independently against the real `db-test` stack.

**Correct replacement:** pgTAP's dedicated negation function `hasnt_function(schema, function_name, args[], description)` asserts the function does not exist and returns a proper TAP result on its own (no `ok(not ...)` wrapper needed):

```sql
select hasnt_function('private','apply_shopping_draft',
  array['uuid','uuid','text','uuid','integer','text','uuid','text','jsonb'],
  'callable draft RPC is not hidden in private');
```

Applied to the single occurrence of this pattern in the test file; same assertion intent, same plan count.


---

## Addendum 4: Plan 5 Task 2 pgTAP `has_table` Two-Untyped-Literal Overload Ambiguity

**Defect:** Plan 5 Task 2 Step 1's literal calls `select has_table('public','shopping_lists');` (six occurrences, plus `select has_table('private','shopping_mutations');`) pass two bare untyped string literals with no third description argument.

pgTAP defines two 2-argument overloads: `has_table(schema name, table name)` and `has_table(table name, description text)`. With two untyped string literals, PostgreSQL's overload resolution picks the `(name, text)` "table + description" form rather than `(name, name)` "schema + table", so `has_table('public','shopping_lists')` is interpreted as "check that a table named `public` exists, with description `shopping_lists`" — which fails because no table named `public` exists. Confirmed independently: `select has_table('public','shopping_lists');` under an active plan fails with `not ok`, while `select has_table('public'::name,'shopping_lists'::name);` (explicit casts forcing the schema+table overload) passes.

This repository's existing test suite never calls the bare 2-untyped-literal form; every existing call either supplies a third description argument (`has_table('public','menus','menus exists')`) or explicit `::name` casts (`has_table('private'::name,'ai_generation_requests'::name)`), both of which disambiguate to the schema+table overload.

**Correct replacement:** add a description string as the third argument to all seven `has_table` calls, matching the established repository convention:

```sql
select has_table('public','shopping_lists','shopping_lists exists');
select has_table('public','shopping_items','shopping_items exists');
select has_table('public','shopping_list_sources','shopping_list_sources exists');
select has_table('public','shopping_item_sources','shopping_item_sources exists');
select has_table('public','shopping_label_confirmations','shopping_label_confirmations exists');
select has_table('public','shopping_current_label_warnings','shopping_current_label_warnings exists');
...
select has_table('private','shopping_mutations','shopping_mutations exists');
```

Same assertion intent (table existence), same plan count; only the description argument is added.



---

## Addendum 5: Plan 5 Task 2 dblink Concurrency Gap (found while implementing Step 1's two race tests)

**Defect 1 — dblink extension not installed, and password required regardless of `pg_hba.conf`:** Plan 5 Task 2 Step 1 requires "two concurrent tests using `dblink`" to open a real second backend session. This repository's migrations never installed the `dblink` extension (confirmed: `create extension if not exists dblink` was absent from every existing migration). After adding it, connecting as any role available to this environment (`postgres`, `service_role`) still fails with `password or GSSAPI delegated credentials required`, even against `pg_hba.conf` lines using `trust`/`peer`. This is `dblink`'s own fixed security policy (`dblink_security_check`), independent of `pg_hba.conf`: dblink refuses a non-superuser caller unless the connection string supplies a password (or GSSAPI credentials) *and* the resulting connection actually used password authentication — a `trust`-authenticated loopback connection is rejected even when a password is supplied, because no password was actually checked. Neither `postgres` nor `service_role` is a Postgres superuser in this environment (`rolsuper=false` for both, confirmed via `pg_roles`), so this applies to every role otherwise available.

Escalated to the user (this is a design/infrastructure decision, not a mechanical API-name fix like Addenda 1–4). User selected: create a dedicated, low-privilege, pgTAP-test-only login role with a fixed non-secret password, granted only the minimal privileges the two race tests need.

**Applied to `supabase/migrations/20260711004000_shopping_lists.sql`:**

```sql
create extension if not exists dblink with schema extensions;

do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'shopping_pgtap_dblink_test') then
    create role shopping_pgtap_dblink_test with login password 'shopping_pgtap_dblink_test_only'
      nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
end;
$block$;
revoke all on schema public from shopping_pgtap_dblink_test;
grant usage on schema public to shopping_pgtap_dblink_test;
grant select, insert, update on public.household_members, public.member_allergies
  to shopping_pgtap_dblink_test;
```

This role is never referenced by any production code path (adapter, service, handler, or RPC); it exists solely so `supabase/tests/database/shopping_lists_races.test.sql` can open a real second backend connection via `host=db port=5432 ... user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only`. `host=db` (the Docker Compose service DNS name, not `127.0.0.1`) is required — connecting via `127.0.0.1` or the local Unix socket both hit `pg_hba.conf` `trust`/`peer` lines, which `dblink_security_check` rejects for a non-superuser exactly as above; `host=db` resolves to the container's routable network address and hits the `scram-sha-256` line, which dblink accepts once a correct password is supplied.

**Defect 2 — the repository's "one file = one `begin;...plan();...finish();rollback;`" convention structurally cannot host true cross-session concurrency tests:** Every existing `*.test.sql` (and `pg_prove`'s invocation via `scripts/run-pgtap.sh`, which treats each file as one TAP stream) wraps all fixture setup and assertions in a single outer transaction that is always rolled back at the end. A `dblink`-opened session is a genuinely separate backend process; under read-committed isolation it cannot see fixture rows inserted by an outer transaction that has not yet committed. Verified independently: inside `begin; insert ...; select dblink_exec(...'update ...'); rollback;`, the dblink-issued `UPDATE` reports `UPDATE 0` because the target row is invisible to the second session.

Escalated to the user with three options (extend the shared file to `commit` instead of `rollback` for the race section only; simulate concurrency within one session without true multi-process blocking, which would not satisfy the plan's literal requirement; or split the two race tests into their own file with an explicit `commit`-based structure). User selected: split into a new file.

**Applied:** created `supabase/tests/database/shopping_lists_races.test.sql` as a second, independent pgTAP file. It does not use `begin;...rollback;`; each fixture statement autocommits individually (this file never opens an explicit transaction beyond the two `do $test$` blocks' own implicit transaction boundaries and one explicit `begin;/commit;` used only for teardown), so `dblink`-opened sessions can see committed fixture rows. Because there is no rollback safety net, the file (a) deletes any leftover rows matching its own fixed test UUIDs at the very start (self-healing after a previous failed run — verified idempotent across 5 consecutive runs and a full `db:reset`), and (b) deletes every row it created at the end via `auth.users` cascade delete plus an explicit `shopping_lists` delete (`shopping_lists`/`shopping_items`/etc. use `on delete set null`, not cascade, from `menus`, so they do not disappear automatically and must be deleted explicitly; `household_members`/`member_allergies` do cascade from `auth.users` and must **not** be deleted directly first, since deleting `member_allergies` directly for a `status='complete'`/`allergy_status='registered'` member trips the `private.prevent_last_registered_member_allergy_removal` trigger — cascading through `auth.users` bypasses this correctly).

This split changes no assertion count or content in `shopping_lists.test.sql` itself (which returns to exactly the structural/RLS/grant assertions plus the non-concurrent behavioral assertions covered by Addendum 6 below); it only relocates the two dblink race tests plan-wide from "inside the main file" (never actually implemented that way) to a sibling file. `scripts/run-pgtap.sh`'s glob (`supabase/tests/database/*.test.sql`) picks up the new file automatically with no script changes; `docker compose --profile test run --rm db-test` runs both files and reports a combined 626-test total (verified across a full `db:reset` plus repeated runs).

**Known limitation carried forward:** the two race tests use short `pg_sleep`-bounded polling loops (up to 20 iterations × 50ms) to observe `pg_stat_activity.wait_event`/`dblink_is_busy` state transitions deterministically under normal load. This is inherently timing-based, unlike the rest of the suite's fully deterministic assertions; if CI/local hardware is under extreme load such that a lock-wait fails to appear within 1 second, the test raises an explicit exception naming the specific expectation that was not observed (not a silent pass), so a flake would be visibly diagnosable rather than silently green. No production code path is affected by this timing sensitivity.

---

## Addendum 6: Plan 5 Task 2 Step 1 Behavioral Tests — Fingerprint Level Mismatch and Fixture Gaps

While implementing the (non-concurrency) behavioral assertions Task 2 Step 1 describes (immutable provenance persistence, current-projection A→B switch, history-deletion cascade, failed-refresh rollback, 30-day retention boundary, and item-mutation idempotency/two-tab version conflict), two mechanical gaps were found and fixed without escalation (same category as Addenda 1–4: no design-spec ambiguity, purely a matter of calling the already-correctly-designed RPCs with the right arguments):

1. `refresh_shopping_list_safety`'s `p_expected_fingerprint` parameter compares against `public.shopping_list_safety_fingerprint(user_id, list_id)` (the **list-level** fingerprint, hashing every distinct live source menu's fingerprint together), not `public.shopping_safety_fingerprint(user_id, menu_id)` (the **menu-level** fingerprint used by `apply_shopping_draft`/`apply_shopping_reconciliation`). Passing the menu-level fingerprint to `refresh_shopping_list_safety` always raises `shopping_safety_fingerprint_changed`, confirmed independently by running the test with each fingerprint function and observing the RPC accept only the list-level one.
2. `private.write_shopping_items` (called by `apply_shopping_draft`) inserts into `shopping_item_sources` with a real FK to `dish_ingredients(id,user_id)`; fixture menus need actual `dishes`/`dish_ingredients` rows (not just a bare `menus` row) for draft creation to succeed. The household member referenced by a draft's label warnings must be inserted as `status='draft'` and promoted to `status='complete'` only *after* its `member_allergies` row exists, or `private.enforce_registered_member_allergy` raises `member_registered_allergy_required` (a Plan 1/2 hardening trigger, not a Plan 5 concern, but its precondition must be satisfied by any fixture that creates a `status='complete'`/`allergy_status='registered'` household member).

Both are fixture-construction details with no bearing on any RPC's design or the design spec; applied directly to `supabase/tests/database/shopping_lists.test.sql`.

The retention boundary test seeds 150 expired rows for user A (`created_at = now() - interval '31 days' - (i seconds)`, so **larger `i` is older**), 2 fresh rows for user A, and 1 expired row for user B, matching Task 2 Step 1's literal scenario. The row explicitly requested in the first `get_shopping_mutation_replay` call is chosen at `i=50` — the 101st-oldest expired row, i.e. one position outside the 100 rows `private.cleanup_expired_shopping_mutations(user_id, 100)` deletes by itself — so the assertion exercises both the bounded-cleanup deletion path (which removes the 100 oldest, `i=51..150`) and the separate "delete the specifically requested key if expired" deletion (which removes `i=50`) in the same call, leaving exactly 49 A-owned expired rows (`i=1..49`) for a second lookup to remove. Both fresh A rows and the B row are asserted untouched at every step, and a row exactly 30 days old (not 30 days + 1 second) is asserted to survive (`created_at < now() - interval '30 days'` is strict).
