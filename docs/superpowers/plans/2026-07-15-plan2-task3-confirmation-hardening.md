# Plan 2 Task 3 Confirmation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the prematurely exposed two-argument confirmation RPC, persist immutable human-readable label source snapshots, and synchronize the Plan 2/3/4 ownership contract.

**Architecture:** Plan 2 Task 3 remains the normalized storage and owner-isolation boundary and exposes no confirmation transition until the canonical database safety-fingerprint helper exists. Plan 3 creates the sole three-argument confirmation RPC in the same migration as that helper; Plan 4 reuses it while reconciling current warning rows. Every confirmation row stores a canonical immutable `source_text_snapshot` used for display and audit.

**Tech Stack:** PostgreSQL 17, Supabase migrations and generated TypeScript types, pgTAP, Docker Compose, Markdown implementation plans.

## Global Constraints

- Use Node 24 and the repository Docker Compose stack.
- SQL and TypeScript use 2-space indentation where applicable; new code comments must be Japanese.
- Do not create a compatibility two-argument confirmation RPC.
- Do not hand-edit generated database types; regenerate them with `npm run db:types`.
- Modify the existing `20260711001100_menu_core.sql`; this Task 3 migration has not been released from the current local branch.
- Preserve all existing owner-composite foreign keys, RLS policies, and delete behavior.

---

### Task 1: Lock the Task 3 schema contract with failing pgTAP

**Files:**
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/tests/database/04a_menu_core_hardening.test.sql`

**Interfaces:**
- Consumes: the current Task 3 schema and `tests.create_supabase_user` fixture helper.
- Produces: a failing proof that `source_text_snapshot` is missing and the unsafe two-argument RPC is still exposed.

- [ ] **Step 1: Add the schema-level failing assertions**

Change `04_menu_core.test.sql` to `select plan(42);`, add the snapshot column assertion, and replace the executable-RPC assertion with absence assertions:

```sql
select has_column(
  'public', 'menu_label_confirmations', 'source_text_snapshot',
  'label confirmations preserve a human-readable source snapshot'
);
select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null
  and to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid,text)') is null,
  'Task 3 exposes no confirmation transition before current-safety locking exists'
);
```

In `04a_menu_core_hardening.test.sql`, replace the anonymous-RPC privilege assertion with the same two-overload absence assertion. Extend every confirmation fixture insert with `source_text_snapshot`; use the exact corresponding source text such as `卵焼き`, `卵`, `卵を焼く`, `中心まで確認`, and `卵を焼く` for owner 1, with owner 2 equivalents.

Add snapshot boundary tests before the role changes:

```sql
select throws_ok(
  $$insert into public.menu_label_confirmations (
    menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,
    allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint
  ) values (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001','dish',
    '42000000-0000-0000-0000-000000000001','dishes.0.name',' ',
    'egg','member_1','dict-v1',repeat('a',64)
  )$$,
  '23514', null, 'source snapshot rejects blank text'
);
select throws_ok(
  $$insert into public.menu_label_confirmations (
    menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,
    allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint
  ) values (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001','dish',
    '42000000-0000-0000-0000-000000000001','dishes.0.name',' 卵焼き',
    'egg','member_1','dict-v1',repeat('a',64)
  )$$,
  '23514', null, 'source snapshot rejects non-canonical surrounding whitespace'
);
select throws_ok(
  format(
    'insert into public.menu_label_confirmations '
    '(menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,'
    'allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint) '
    'values (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001','dish',
    '42000000-0000-0000-0000-000000000001','dishes.0.name',repeat('あ',501),
    'egg','member_1','dict-v1',repeat('a',64)
  ),
  '23514', null, 'source snapshot rejects text longer than 500 characters'
);
```

Delete the old null-auth/wrong-menu/foreign/unknown/success/replay RPC behavior block. Task 3 must no longer claim behavior for a function it does not safely own.

- [ ] **Step 2: Run the focused schema test and verify RED**

Run:

```bash
docker compose --profile test run --rm db-test supabase/tests/database/04_menu_core.test.sql
```

Expected: FAIL because `source_text_snapshot` does not exist and the two-argument RPC still resolves.

- [ ] **Step 3: Keep the failing test changes uncommitted for Task 2**

Run:

```bash
git diff --check
git status --short
```

Expected: only the two pgTAP files are modified in addition to the already committed design and implementation-plan work.

---

### Task 2: Implement the fail-closed Task 3 schema

**Files:**
- Modify: `supabase/migrations/20260711001100_menu_core.sql`
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/tests/database/04a_menu_core_hardening.test.sql`
- Modify (generated): `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Task 1's failing pgTAP contract.
- Produces: `menu_label_confirmations.source_text_snapshot: string`; no `confirm_menu_label_confirmation` RPC in Task 3 generated types.

- [ ] **Step 1: Add the immutable snapshot column**

Insert the column immediately after `source_path`:

```sql
  source_text_snapshot text not null check (
    source_text_snapshot = btrim(
      source_text_snapshot,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    and char_length(source_text_snapshot) between 1 and 500
  ),
```

Do not add the snapshot to either uniqueness key. It is immutable provenance, not source identity.

- [ ] **Step 2: Remove the unsafe Task 3 transition**

Delete the complete `public.confirm_menu_label_confirmation(uuid,uuid)` function, its `REVOKE`, and its `GRANT`. Leave direct table UPDATE revoked. Do not add a stub or a three-argument implementation because the canonical current-safety helper is not available until Plan 3.

- [ ] **Step 3: Reset the database and verify GREEN pgTAP**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/04_menu_core.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/04a_menu_core_hardening.test.sql
```

Expected: `04` reports 42 passing assertions; `04a` reports PASS with snapshot boundary, ACL/RLS, graph, unlink, and cascade assertions.

- [ ] **Step 4: Regenerate database types**

Run:

```bash
docker compose run --rm app npm run db:types
```

Expected: `source_text_snapshot` appears in `menu_label_confirmations.Row/Insert/Update`; `confirm_menu_label_confirmation` is absent from `Database["public"]["Functions"]`.

- [ ] **Step 5: Run type and diff checks**

Run:

```bash
docker compose run --rm --no-deps app npm run typecheck
git diff --check
git diff --stat
```

Expected: typecheck exits 0; only the migration, two pgTAP files, and generated types are implementation changes.

- [ ] **Step 6: Commit the Task 3 implementation correction**

```bash
git add supabase/migrations/20260711001100_menu_core.sql \
  supabase/tests/database/04_menu_core.test.sql \
  supabase/tests/database/04a_menu_core_hardening.test.sql \
  src/shared/types/database.generated.ts
git commit -m "fix: ラベル確認の保存境界を強化"
```

---

### Task 3: Synchronize Plan 2 with the corrected Task 3 boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md`

**Interfaces:**
- Consumes: Task 2's actual migration and generated type contract.
- Produces: a Plan 2 specification that assigns confirmation transition ownership to Plan 3 and requires `source_text_snapshot`.

- [ ] **Step 1: Correct the Task 3 interface and schema snippets**

Update the Task 3 `Produces` contract to state:

```markdown
Plan 2 stores immutable canonical `source_text_snapshot` provenance but exposes no confirmation transition. Plan 3 creates the sole fingerprint-aware three-argument RPC in the same migration as the canonical current-safety locking helper.
```

Add `source_text_snapshot` with the exact migration constraint from Task 2 to the table snippet. Replace every two-argument RPC privilege/test instruction with assertions that neither two- nor three-argument overload exists in Task 3.

- [ ] **Step 2: Correct the Task 3 hardening and completion text**

Replace RPC success/replay cases with snapshot blank/non-canonical/overlength rejection and RPC-absence coverage. Update the Task 3 summary and correction gate so they no longer claim that Plan 2 owns or exposes confirmation mutation.

- [ ] **Step 3: Prove stale Plan 2 contracts are gone**

Run:

```bash
if rg -n 'Plan 2 owns only.*confirm_menu_label_confirmation|confirm_menu_label_confirmation\(menu_id, ?confirmation_id\)|has_function_privilege.*confirm_menu_label_confirmation' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md; then exit 1; fi
rg -n 'source_text_snapshot|exposes no confirmation transition|three-argument' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
```

Expected: the stale-contract check exits 0 and the corrected contracts are present.

---

### Task 4: Synchronize Plan 3 persistence, display, and RPC ownership

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md`

**Interfaces:**
- Consumes: Plan 2 `source_text_snapshot`, Plan 3 `private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)`.
- Produces: the sole `confirm_menu_label_confirmation(uuid,uuid,text)` owner and snapshot-based result display contract.

- [ ] **Step 1: Update persistence SQL and tests**

Add `source_text_snapshot` to every `menu_label_confirmations` insert/select fixture. In the persistence loop, store `v_label->>'sourceText'` beside `source_path`. Require pgTAP to prove exact source snapshot persistence and rejection of missing/non-canonical snapshots.

- [ ] **Step 2: Move the safe RPC creation beside the fingerprint helper**

Immediately after Plan 3 defines and revokes its two private fingerprint helpers, specify the sole public RPC:

```sql
create or replace function public.confirm_menu_label_confirmation(
  p_menu_id uuid,
  p_confirmation_id uuid,
  p_expected_safety_fingerprint text
) returns setof public.menu_label_confirmations
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_target_member_ids uuid[];
begin
  if v_user_id is null then return; end if;
  select array_agg(target.household_member_id order by target.anonymous_ref)
    into v_target_member_ids
  from public.menu_target_members target
  where target.menu_id = p_menu_id and target.user_id = v_user_id
    and target.household_member_id is not null;
  if coalesce(cardinality(v_target_member_ids), 0) = 0 then return; end if;
  begin
    perform private.lock_and_assert_current_safety_fingerprint(
      v_user_id, v_target_member_ids, p_expected_safety_fingerprint
    );
  exception
    when sqlstate 'P0001' then return;
  end;
  return query
    update public.menu_label_confirmations confirmation
    set confirmation_status = 'confirmed',
        confirmed_at = statement_timestamp(),
        confirmed_by = v_user_id
    where confirmation.id = p_confirmation_id
      and confirmation.menu_id = p_menu_id
      and confirmation.user_id = v_user_id
      and confirmation.is_current
      and confirmation.confirmation_status = 'pending'
      and confirmation.requirement_safety_fingerprint = p_expected_safety_fingerprint
    returning confirmation.*;
end;
$function$;
revoke all on function public.confirm_menu_label_confirmation(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_menu_label_confirmation(uuid,uuid,text)
  to authenticated;
```

The implementation plan must state that pgTAP covers null auth, wrong menu/owner, unknown, archived, replay, stale stored fingerprint, changed current safety, and a successful current owner transition. No two-argument overload may exist.

- [ ] **Step 3: Make result display snapshot-based**

Add `source_text_snapshot` to the PostgREST select and map `sourceText: item.source_text_snapshot`. Remove the `collectMenuTextSources(menu)` map and its fallback from confirmation display. Preserve source type/ID/path as identity fields.

- [ ] **Step 4: Check the Plan 3 contract**

Run:

```bash
rg -n 'source_text_snapshot|confirm_menu_label_confirmation\(uuid,uuid,text\)|lock_and_assert_current_safety_fingerprint' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
if rg -n 'sourceText\.get\(canonical\.sourcePath\)|confirm_menu_label_confirmation\(uuid,uuid\)' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md; then exit 1; fi
```

Expected: the corrected producer/consumer contracts exist and stale dynamic/two-argument paths are absent.

---

### Task 5: Synchronize Plan 4 reconciliation and reuse

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-04-history-regeneration.md`

**Interfaces:**
- Consumes: Plan 3's sole three-argument confirmation RPC and `source_text_snapshot` storage.
- Produces: reconciliation that writes/returns snapshots without replacing the confirmation RPC.

- [ ] **Step 1: Remove deferred RPC replacement ownership**

Replace the instruction to drop Plan 2's two-argument RPC and create a three-argument RPC with an explicit statement that Plan 4 reuses and tests Plan 3's existing three-argument function. Retain stale/foreign/replay/concurrency pgTAP requirements.

- [ ] **Step 2: Add snapshot to reconciliation and stored-menu loading**

Require reconciliation input validation and upserts to include `sourceTextSnapshot`, stored as `source_text_snapshot`. Add the column to stored-menu/current-warning selects and return `sourceText` from the saved snapshot. Remove instructions to resolve it through `collectMenuTextSources(candidate)`.

- [ ] **Step 3: Check the Plan 4 contract**

Run:

```bash
rg -n 'source_text_snapshot|reuses.*three-argument|sourceTextSnapshot' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-04-history-regeneration.md
if rg -n "Drop/revoke Plan 2's two-argument|resolve .*sourceText through .*collectMenuTextSources" \
  docs/superpowers/plans/2026-07-11-kondate-mvp-04-history-regeneration.md; then exit 1; fi
```

Expected: Plan 4 no longer owns RPC replacement or dynamic source display.

- [ ] **Step 4: Commit synchronized plans**

```bash
git add docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-04-history-regeneration.md
git commit -m "docs: ラベル確認境界を後続計画へ同期"
```

---

### Task 6: Final adversarial verification

**Files:**
- Verify only; modify candidate files only if a validated review finding requires it.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: evidence that the original stale-confirmation path and missing-snapshot contract no longer reproduce.

- [ ] **Step 1: Run focused database and type verification**

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/04_menu_core.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/04a_menu_core_hardening.test.sql
docker compose run --rm --no-deps app npm run typecheck
```

Expected: both pgTAP files and typecheck PASS.

- [ ] **Step 2: Run repository quality checks**

```bash
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npx vitest run
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Prove the original findings are closed**

```bash
if rg -n 'confirm_menu_label_confirmation\(uuid, ?uuid\)' \
  supabase/migrations/20260711001100_menu_core.sql \
  src/shared/types/database.generated.ts; then exit 1; fi
rg -n 'source_text_snapshot' \
  supabase/migrations/20260711001100_menu_core.sql \
  supabase/tests/database/04_menu_core.test.sql \
  supabase/tests/database/04a_menu_core_hardening.test.sql \
  src/shared/types/database.generated.ts
```

Expected: no Task 3 two-argument RPC exists and snapshot coverage is present across schema, tests, and generated types.

- [ ] **Step 4: Review final scope**

```bash
git status --short
git log --oneline -4
git diff HEAD~3..HEAD --stat
```

Expected: only the approved design, implementation plan, Task 3 implementation files, and synchronized Plan 2/3/4 documents changed.
