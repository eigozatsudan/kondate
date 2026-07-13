# Plan 2 Task 2 Plan Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the Plan 2 Task 2 instructions so draft pantry selections are constrained to the declared JSON shape at the PostgreSQL boundary, pgTAP uses the correct count, and the example commit follows repository rules.

**Architecture:** Modify only the Task 2 section of the existing Plan 2 document. Specify a private immutable PL/pgSQL validator that safely validates PostgreSQL 15 UUID input, call it from the planned table CHECK constraint, and add six RPC-level pgTAP rejection cases.

**Tech Stack:** PostgreSQL 15.8, PL/pgSQL, pgTAP, Markdown

## Global Constraints

- Modify only `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` for the correction deliverable.
- Do not create the Task 2 production migration, pgTAP file, or generated database types in this correction.
- Preserve the Task 2 interfaces, existing 18 assertions, revision behavior, RLS behavior, 50-item limit, 32KiB limit, and expired-confirmation exclusion.
- The planned JSON shape has exactly `pantryItemId` and `priority`; `pantryItemId` must cast to PostgreSQL `uuid`, and `priority` must be `must_use` or `prefer_use`.
- Use PostgreSQL 15-compatible functions; do not use `pg_input_is_valid`.
- Code comments are Japanese, and commit messages use Japanese Conventional Commits.

---

### Task 1: Correct the Task 2 database-boundary plan

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md:429-678`
- Reference: `docs/superpowers/specs/2026-07-13-plan2-task2-draft-json-boundary-design.md`

**Interfaces:**
- Consumes: Task 2's existing `save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)` RPC and `generation_drafts.pantry_selections` JSONB column.
- Produces: exact planned function `private.is_valid_draft_pantry_selections(p_value jsonb) returns boolean`, a CHECK constraint that calls it, and a 24-assertion pgTAP plan.

- [ ] **Step 1: Expand the planned pgTAP contract from 18 to 24 assertions**

Change `select plan(18);` to `select plan(24);` in Task 2 Step 1. After the existing `checkedAt` rejection, append these six assertions, all using expected revision `2` because each failed statement rolls back without incrementing the stored revision:

```sql
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'',
    '[{"pantryItemId":"not-a-uuid","priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry item ID must be a UUID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"optional"}]'::jsonb)$$,
  '23514', null, 'pantry priority must be a declared value'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'','[{"priority":"must_use"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a pantry item ID'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001"}]'::jsonb)$$,
  '23514', null, 'pantry selection requires a priority'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'',
    '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","note":"x"}]'::jsonb)$$,
  '23514', null, 'pantry selection rejects undeclared keys'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'','["invalid"]'::jsonb)$$,
  '23514', null, 'pantry selection must be an object'
);
```

- [ ] **Step 2: Add the planned PostgreSQL 15-compatible validator**

Immediately before `create table public.generation_drafts`, add this complete planned function:

```sql
create or replace function private.is_valid_draft_pantry_selections(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;

  for v_item in
    select item from jsonb_array_elements(p_value) as items(item)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;

    if not (v_item ? 'pantryItemId')
      or not (v_item ? 'priority')
      or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'pantryItemId') <> 'string'
      or jsonb_typeof(v_item -> 'priority') <> 'string'
      or (v_item ->> 'priority') not in ('must_use', 'prefer_use') then
      return false;
    end if;

    begin
      perform (v_item ->> 'pantryItemId')::uuid;
    exception
      when invalid_text_representation then
        return false;
    end;
  end loop;

  return true;
end;
$function$;
revoke all on function private.is_valid_draft_pantry_selections(jsonb)
  from public, anon, authenticated;
```

Replace the planned table constraint:

```sql
check (jsonb_typeof(pantry_selections) = 'array'),
```

with:

```sql
check (private.is_valid_draft_pantry_selections(pantry_selections)),
```

Keep the existing array-length, byte-size, and forbidden-confirmation checks immediately after it.

- [ ] **Step 3: Correct Task 2 verification and commit instructions**

In Task 2 Step 4, change the expected pgTAP plan from `1..14` to `1..24`.

In Task 2 Step 5, replace:

```bash
git commit -m "feat: add pantry and planner draft storage"
```

with:

```bash
git commit -m "feat: パントリーと献立下書きの保存基盤を追加"
```

- [ ] **Step 4: Validate the planned function on PostgreSQL 15 without persisting state**

Create `/tmp/plan2-task2-validator-probe.sql` with the planned function body wrapped in a transaction, followed by these checks and `rollback;`:

```sql
begin;

create or replace function private.is_valid_draft_pantry_selections(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  for v_item in
    select item from jsonb_array_elements(p_value) as items(item)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if not (v_item ? 'pantryItemId')
      or not (v_item ? 'priority')
      or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'pantryItemId') <> 'string'
      or jsonb_typeof(v_item -> 'priority') <> 'string'
      or (v_item ->> 'priority') not in ('must_use', 'prefer_use') then
      return false;
    end if;
    begin
      perform (v_item ->> 'pantryItemId')::uuid;
    exception
      when invalid_text_representation then
        return false;
    end;
  end loop;
  return true;
end;
$function$;

select private.is_valid_draft_pantry_selections('[]'::jsonb) as empty_is_valid;
select private.is_valid_draft_pantry_selections(
  '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb
) as valid_row_is_valid;
select not private.is_valid_draft_pantry_selections(
  '[{"pantryItemId":"not-a-uuid","priority":"must_use"}]'::jsonb
) as invalid_uuid_is_rejected;
select not private.is_valid_draft_pantry_selections(
  '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use","note":"x"}]'::jsonb
) as extra_key_is_rejected;
select not private.is_valid_draft_pantry_selections('["invalid"]'::jsonb)
  as scalar_is_rejected;

rollback;
```

Run:

```bash
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f /tmp/plan2-task2-validator-probe.sql
```

If the container cannot read the host `/tmp` path, pipe the same file through standard input:

```bash
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /tmp/plan2-task2-validator-probe.sql
```

Expected: all five selected booleans are `t`, the transaction ends with `ROLLBACK`, and querying `to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)')` afterward returns null.

- [ ] **Step 5: Verify scope and commit**

Run:

```bash
git diff --check
git diff --name-only
rg -n "plan\(24\)|is_valid_draft_pantry_selections|1\.\.24|feat: パントリーと献立下書きの保存基盤を追加" \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
```

Expected: diff check exits 0; only the Plan 2 plan file changed; all four corrected contracts are present.

Commit:

```bash
git add docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md
git commit -m "docs: Plan 2 Task 2のDB境界を補正"
```
