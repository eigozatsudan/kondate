# Kondate History and Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped menu history, favorites, current-safety revalidation, whole-menu and single-dish regeneration, duplicate rejection, and an explicit “chosen” version without consuming quota for invalid repeats.

**Architecture:** Extend Plan 2's `derivation_group_id` and `parent_menu_id` lineage with immutable version numbers, an explicit selected timestamp, and persisted revalidation results. Revalidation always loads the current household safety context before history reuse; regeneration passes a required reason and exclusions into the existing generation service, while the browser groups versions by derivation group and never treats historical safety snapshots as current authority.

**Tech Stack:** TypeScript strict mode, Zod 4, React 19.2.7, React Router 8, TanStack Query 5, Supabase PostgreSQL/RLS/RPC, Netlify Functions, Vitest, React Testing Library, pgTAP, Playwright.

## Global Constraints

- Implement after Plans 1–3 and preserve every shared name in `2026-07-11-kondate-mvp-00-roadmap.md`.
- Consume Plan 2 after it has removed every duplicate single-column relationship FK. PostgREST embeds and deletion checks use only the final named owner-composite constraints; Plan 4 must not rely on an inferred relationship or recreate a duplicate FK.
- All regeneration requests require one of `simpler`, `different_ingredient`, `child_friendly`, `different_flavor`, or `custom`.
- Historical preference snapshots may be reused; current allergies, age bands, mandatory safety constraints, unsupported-diet state, and safety-catalog versions always win.
- Revalidate the whole menu, including dishes that will remain unchanged, before either regeneration mode.
- An exact or materially equivalent result is invalid, is not persisted, and does not consume a successful user generation.
- Every accepted regeneration result is a new immutable version under the original `derivation_group_id`.
- A new version preserves retained user-visible recipe content, never retained database identity: every menu, dish, ingredient, step, timeline, adaptation, pantry-selection, action, and confirmation identity is freshly allocated and every cross-reference is remapped before persistence.
- History shows one card per derivation group and uses the explicitly selected version, otherwise the latest valid version.
- Do not expose “safe” or “allergy-complete” language; show changed-safety and unresolved-label warnings.
- Every user-owned row has RLS. Functions derive the user from the verified Supabase access token.
- All behavior is test-first and every task ends with a focused commit.

---

### Task 1: Persist immutable menu lineage and revalidation results

**Files:**
- Create: `supabase/migrations/20260711003000_history_regeneration.sql`
- Create: `supabase/tests/database/history_regeneration.test.sql`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Plan 2's `public.menus`, including `derivation_group_id`, `parent_menu_id`, `change_reason`, `is_selected`, and `is_favorite`; and Plan 3's sole canonical `GenerationRepository.reserve(command)` / `public.reserve_ai_generation(...)` path, which already owns success, per-user daily attempt, short-window attempt, and global reservations for every `GenerationCommand` variant.
- Produces: `public.accept_menu_version(p_menu_id uuid)`, `public.delete_menu_group(p_derivation_group_id uuid)`, automatic regeneration lineage, `public.menu_revalidations`, `version`, `selected_at`, and nullable historical references after deletion. Plan 4 must not add a regeneration-only reservation RPC or copy quota transitions.

- [ ] **Step 1: Write the failing pgTAP structure and RLS test**

```sql
begin;
select plan(27);

select has_column('public', 'menus', 'derivation_group_id');
select has_column('public', 'menus', 'parent_menu_id');
select has_column('public', 'menus', 'version');
select has_column('public', 'menus', 'change_reason');
select has_column('public', 'menus', 'selected_at');
select has_column('public', 'menus', 'is_selected');
select has_table('public', 'menu_revalidations');
select has_function('public', 'accept_menu_version', array['uuid']);
select has_function('public', 'delete_menu_group', array['uuid']);
select is_empty($$select 1 from information_schema.columns
  where table_schema='private' and table_name='ai_generation_requests'
    and column_name in ('change_reason','change_reason_custom')$$,
  'generation ledger stores only the canonical HMAC, never reason text');
select has_column('private', 'ai_generation_requests', 'replace_dish_id');
select ok(
  to_regprocedure('public.reserve_ai_regeneration(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,integer,integer,timestamptz)') is null,
  'regeneration has no parallel quota reservation RPC'
);
select has_function('private','assign_regeneration_lineage',
  array['uuid','uuid','uuid','text','text']);
select policies_are(
  'public',
  'menu_revalidations',
  array['menu_revalidations_select_own'],
  'browser users can only read their revalidation rows'
);
select has_unique('public','menu_revalidations','menu_revalidations_one_per_menu_owner',
  'repeated mount revalidation updates one latest row instead of growing without bound');
select ok(exists (
  select 1 from pg_constraint c
  where c.conname = 'menu_revalidations_menu_owner_fkey'
    and c.conrelid = 'public.menu_revalidations'::regclass
    and c.confrelid = 'public.menus'::regclass
    and c.confdeltype = 'c'
    and (select array_agg(a.attname order by key_column.ordinality)
      from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum)
      = array['menu_id','user_id']
    and (select array_agg(a.attname order by ref_column.ordinality)
      from unnest(c.confkey) with ordinality as ref_column(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.confrelid and a.attnum = ref_column.attnum)
      = array['id','user_id']
), 'a privileged writer cannot attach a revalidation to another owner menu');
select is(
  (select confdeltype::text from pg_constraint where conname='menus_parent_owner_fkey'),
  'n', 'the sole owner-composite parent reference sets only parent_menu_id null on delete'
);
select is_empty(
  $$select 1 from pg_constraint where conname = 'menus_parent_menu_id_fkey'$$,
  'Plan 2 removed the duplicate single-column parent relationship FK'
);
select is(
  (select confdeltype::text from pg_constraint
    where conname='menu_member_adaptations_branch_owner_fkey'),
  'c', 'deleting a recipe step cascades its adaptation branch'
);
select is(
  (select confdeltype::text from pg_constraint
    where conname='menu_safety_actions_ingredient_owner_fkey'),
  'c', 'deleting an ingredient cascades ingredient-bound safety actions'
);
select is(
  (select confdeltype::text from pg_constraint
    where conname='menu_safety_actions_step_owner_fkey'),
  'c', 'deleting a recipe step cascades step-bound safety actions'
);
select is(
  (select confdeltype::text from pg_constraint
    where conname='menu_safety_actions_adaptation_owner_fkey'),
  'c', 'deleting an adaptation cascades its safety actions'
);

insert into auth.users (id,instance_id,aud,role,email) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','delete-owner@example.test'),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-owner@example.test');
insert into public.menus (
  id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
  preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,
  food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,version
) values
  ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001',null,1),
  ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',2),
  ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',
    'dinner','japanese',2,30,'{}','{}',repeat('b',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001',null,1);
insert into public.menu_target_members (
  id,menu_id,user_id,household_member_id,household_member_user_id,
  anonymous_ref,member_display_name_snapshot
) values (
  'd1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001',null,null,'member_1','削除テスト'
);
insert into public.generation_pantry_selections (
  id,menu_id,user_id,pantry_item_id,pantry_name_snapshot,priority,idempotency_key,
  usage_status,planned_quantity,inventory_quantity_snapshot,shortage_quantity,unit
) values (
  'd2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001',null,'にんじん','prefer_use',
  'd2000000-0000-4000-8000-000000000002','used',1,1,0,'本'
);
insert into public.dishes (
  id,menu_id,user_id,role,position,name,description,cooking_time_minutes
) values (
  'd3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001','main',1,'煮物','削除契約用',20
);
insert into public.dish_ingredients (
  id,menu_id,dish_id,user_id,position,name,quantity_value,quantity_text,unit,
  store_section,pantry_selection_id
) values (
  'd4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  1,'にんじん',1,'1本','本','produce','d2000000-0000-4000-8000-000000000001'
);
insert into public.recipe_steps (
  id,menu_id,dish_id,user_id,position,instruction
) values (
  'd5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  1,'にんじんを柔らかく煮る'
);
insert into public.menu_timeline_steps (
  id,menu_id,user_id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id
) values (
  'd6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001',1,0,20,'煮物を作る',
  'd3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001'
);
insert into public.menu_member_adaptations (
  id,menu_id,dish_id,user_id,anonymous_member_ref,portion_text,
  branch_before_recipe_step_id,serving_check
) values (
  'd7000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'member_1','半量','d5000000-0000-4000-8000-000000000001','柔らかさを確認する'
);
insert into public.menu_safety_actions (
  id,menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,
  before_recipe_step_id,position,kind,instruction
) values (
  'd8000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','member_1',
  'd5000000-0000-4000-8000-000000000001',1,'cut_small','小さく切る'
);
insert into public.menu_revalidations (
  id,user_id,menu_id,safety_fingerprint,allergen_catalog_version,food_rule_version,status
) values (
  'd9000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',repeat('a',64),'allergens-v1','food-v1','valid'
);
select is(
  (select count(*)::integer from public.menus
    where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
      and derivation_group_id = 'c1000000-0000-4000-8000-000000000001'::uuid),
  2, 'delete fixture contains parent and child versions'
);
select ok(exists(
  select 1 from public.menu_safety_actions
  where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
), 'delete fixture contains an ingredient/step-bound safety action');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select is(
  public.delete_menu_group('c1000000-0000-4000-8000-000000000001'::uuid),
  2, 'owner can delete the complete parent/child derivation group'
);
reset role;

select is_empty($$
  select menu_id from public.menu_target_members where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.generation_pantry_selections where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.dishes where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.dish_ingredients where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.recipe_steps where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.menu_timeline_steps where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.menu_member_adaptations where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.menu_safety_actions where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.menu_label_confirmations where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
  union all select menu_id from public.menu_revalidations where user_id = 'a1000000-0000-4000-8000-000000000001'::uuid
$$, 'group deletion leaves no normalized child row');
select ok(exists(
  select 1 from public.menus
  where user_id = 'a2000000-0000-4000-8000-000000000002'::uuid
    and derivation_group_id = 'c1000000-0000-4000-8000-000000000001'::uuid
), 'same group UUID belonging to another owner is untouched');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the database test and verify it fails**

Run: `docker compose --profile test run --rm db-test supabase/tests/database/history_regeneration.test.sql`

Expected: FAIL because `version`, `menu_revalidations`, and regeneration lineage do not exist; the negative RPC assertion remains green because Plan 3's canonical reservation path is the only one allowed.

- [ ] **Step 3: Add the complete forward-only migration**

```sql
alter table public.menus
  add column version integer check (version > 0),
  add column selected_at timestamptz;

with ranked as (
  select id, row_number() over (
    partition by user_id, derivation_group_id order by created_at, id
  )::integer as calculated_version
  from public.menus
)
update public.menus as menu
set version = ranked.calculated_version,
    selected_at = case when menu.is_selected then menu.created_at else null end
from ranked
where ranked.id = menu.id;

alter table public.menus alter column version set not null;
alter table public.menus alter column version set default 1;
alter table public.menus add constraint menus_selected_timestamp_consistent
  check (is_selected = (selected_at is not null));
alter table public.menus
  drop constraint menus_parent_owner_fkey,
  add constraint menus_parent_owner_fkey
    foreign key (parent_menu_id,user_id) references public.menus(id,user_id)
    on delete set null (parent_menu_id);

-- 正規化子行、adaptation の分岐、ingredient/step に結び付く safety action の
-- 最終 owner-composite CASCADE 契約は Plan 2 が所有する。Plan 4 は上で契約を
-- 検査するだけで、該当する外部キーを削除・再作成しない。

create unique index menus_group_version_unique
  on public.menus(user_id, derivation_group_id, version);
create index menus_history_order
  on public.menus(user_id, created_at desc);

create table public.menu_revalidations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_id uuid not null,
  safety_fingerprint text not null,
  allergen_catalog_version text not null,
  food_rule_version text not null,
  status text not null check (status in ('valid', 'changed', 'invalid')),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now(),
  constraint menu_revalidations_one_per_menu_owner unique (menu_id,user_id),
  constraint menu_revalidations_menu_owner_fkey
    foreign key (menu_id,user_id) references public.menus(id,user_id) on delete cascade
);

alter table public.menu_revalidations enable row level security;
revoke all on public.menu_revalidations from anon, authenticated;
grant select on public.menu_revalidations to authenticated;

create policy menu_revalidations_select_own
  on public.menu_revalidations for select to authenticated
  using ((select auth.uid()) = user_id);
alter table private.ai_generation_requests
  add column replace_dish_id uuid references public.dishes(id) on delete set null;

-- reserve_ai_regeneration は作成しない。Plan 3 の canonical reservation RPC が完全な
-- GenerationCommand を受け取り、冪等性用には server-secret HMAC だけを保存し、success、
-- user daily attempt、short-window、global state を原子的に予約する。理由テキストは
-- finalization 成功までメモリ内だけに保持し、完了した menu にだけ保存する。

create or replace function private.assign_regeneration_lineage(
  p_user_id uuid,p_source_menu_id uuid,p_completed_menu_id uuid,
  p_change_reason text,p_change_reason_custom text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_group_id uuid;
  v_next_version integer;
begin
  if p_source_menu_id is null and p_change_reason is null
     and p_change_reason_custom is null then
    return; -- Plan 3 new-menu finalization uses this same hook.
  end if;
  if p_source_menu_id is null then
    raise exception using errcode='22023',message='invalid_regeneration_lineage';
  end if;
  if p_change_reason is null or p_change_reason not in (
    'simpler','different_ingredient','child_friendly','different_flavor','custom'
  ) or ((p_change_reason='custom')<>(p_change_reason_custom is not null))
    or (p_change_reason_custom is not null and
      char_length(btrim(p_change_reason_custom)) not between 1 and 200) then
    raise exception using errcode='22023',message='invalid_change_reason';
  end if;

  select derivation_group_id into v_group_id
  from public.menus
  where id = p_source_menu_id and user_id = p_user_id
  for update;
  if v_group_id is null then
    raise exception using errcode = 'P0002', message = 'source_menu_not_found';
  end if;

  perform 1 from public.menus
  where user_id = p_user_id and derivation_group_id = v_group_id
  order by id for update;
  select coalesce(max(version), 0) + 1 into v_next_version
  from public.menus
  where user_id = p_user_id and derivation_group_id = v_group_id;

  update public.menus
  set derivation_group_id = v_group_id,
      parent_menu_id = p_source_menu_id,
      version = v_next_version,
      change_reason = p_change_reason,
      change_reason_custom = p_change_reason_custom,
      is_selected = false,
      selected_at = null
  where id = p_completed_menu_id and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'completed_menu_not_found';
  end if;
  return;
end;
$$;
revoke all on function private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;

create or replace function public.accept_menu_version(p_menu_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_group uuid;
begin
  select derivation_group_id into v_group
  from public.menus
  where id = p_menu_id and user_id = (select auth.uid())
  for update;

  if v_group is null then
    raise exception using errcode = 'P0002', message = 'menu_not_found';
  end if;

  perform 1
  from public.menus
  where user_id = (select auth.uid()) and derivation_group_id = v_group
  order by id
  for update;

  update public.menus
  set is_selected = false, selected_at = null
  where user_id = (select auth.uid()) and derivation_group_id = v_group and is_selected;

  update public.menus
  set is_selected = true, selected_at = now()
  where id = p_menu_id and user_id = (select auth.uid());
end;
$$;

revoke all on function public.accept_menu_version(uuid) from public, anon;
grant execute on function public.accept_menu_version(uuid) to authenticated;

create or replace function public.delete_menu_group(p_derivation_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.menus
  where user_id = (select auth.uid())
    and derivation_group_id = p_derivation_group_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_menu_group(uuid) from public, anon;
grant execute on function public.delete_menu_group(uuid) to authenticated;
```

- [ ] **Step 4: Run migration, pgTAP, and type generation**

Run:

```bash
docker compose run --rm app npm run db:push
docker compose --profile test run --rm db-test supabase/tests/database/history_regeneration.test.sql
docker compose run --rm app npm run db:types
```

Expected: pgTAP reports 27 successful assertions; repeated checks upsert one latest row, the owner-composite revalidation foreign key rejects a privileged cross-owner write, the sole parent FK uses partial-column `SET NULL`, and deleting a two-version group with ingredient/step-bound safety actions removes every owned normalized child while preserving another owner that reused the group UUID. Generated types contain the new columns, table, RPCs, and function-backed lineage fields without reason text in the generation ledger.

- [ ] **Step 5: Commit the migration**

```bash
git add supabase/migrations/20260711003000_history_regeneration.sql supabase/tests/database/history_regeneration.test.sql src/shared/types/database.generated.ts
git commit -m "feat: add menu version history schema"
```

### Task 2: Define regeneration, grouping, and duplicate contracts

**Files:**
- Create: `shared/contracts/regeneration.ts`
- Create: `shared/contracts/regeneration.test.ts`
- Create: `shared/safety/deduplicate.ts`
- Create: `shared/safety/deduplicate.test.ts`
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`

**Interfaces:**
- Consumes: Plan 3 Task 15's named `regenerateMenuRequestSchema`, `regenerateDishRequestSchema`, their inferred request types, and canonical three-variant `GenerationCommand`, plus Plan 2's generated dish/timeline/adaptation/pantry/label field schemas and `ValidatedMenu`.
- Produces: regeneration UI re-exports (not a second command union), `wholeRegenerationPromptSchema`, `retainedDishPromptSchema`, `dishRegenerationPromptSchema`, `dishRegenerationAiOutputSchema`, `RetainedDishPrompt`, `DishRegenerationPrompt`, `DishRegenerationAiOutput`, `createDishSignature`, `createMenuSignature`, material-duplicate helpers, and the closed generation failure codes `duplicate_output`, `idempotency_payload_mismatch`, `current_safety_revalidation_required`, `current_target_member_required`, `source_menu_not_found`, and `replace_dish_not_found`.

- [ ] **Step 1: Write failing request-schema and duplicate tests**

```ts
import { describe, expect, it } from "vitest";
import { regenerateDishRequestSchema } from "../contracts/regeneration";
import { dishRegenerationAiOutputSchema,retainedDishPromptSchema } from "../contracts/regeneration";
import { isMateriallySameDish, isMateriallySameMenu } from "./deduplicate";

describe("regeneration contracts", () => {
  it("requires a reason for dish regeneration", () => {
    const parsed = regenerateDishRequestSchema.safeParse({
      sourceMenuId: crypto.randomUUID(),
      dishId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts only request-local refs for the replacement and complete cross-menu sections", () => {
    const output=makeDishRegenerationAiOutput();
    expect(dishRegenerationAiOutputSchema.parse(output)).toEqual(output);
    expect(()=>dishRegenerationAiOutputSchema.parse({
      ...output,replacementDish:{...output.replacementDish,dishRef:crypto.randomUUID()},
    })).toThrow();
  });

  it("requires complete retained dish text without stable database IDs", () => {
    const retained=retainedDishPromptSchema.parse(makeRetainedDishPrompt());
    expect(JSON.stringify(retained)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
    expect(retained.steps).not.toHaveLength(0);
  });

  it("rejects dishes with the same role and materially same ingredients", () => {
    expect(isMateriallySameDish(
      { role: "main", name: "鶏肉と白菜の煮物", primaryIngredients: ["鶏もも肉", "白菜", "しょうゆ"] },
      { role: "main", name: "白菜と鶏肉の煮物", primaryIngredients: ["白菜", "鶏もも肉", "しょうゆ"] },
    )).toBe(true);
  });

  it("rejects a whole menu when every role is materially unchanged", () => {
    const first = { dishes: [
      { role: "main", name: "鶏肉と白菜の煮物", primaryIngredients: ["鶏もも肉", "白菜"] },
      { role: "side", name: "にんじんの和え物", primaryIngredients: ["にんじん"] },
    ] };
    const second = { dishes: [
      { role: "side", name: "人参の和え物", primaryIngredients: ["にんじん"] },
      { role: "main", name: "白菜と鶏肉の煮物", primaryIngredients: ["白菜", "鶏もも肉"] },
    ] };
    expect(isMateriallySameMenu(first, second)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `docker compose run --rm --no-deps app npm test -- --run shared/contracts/regeneration.test.ts shared/safety/deduplicate.test.ts`

Expected: FAIL because the dedicated local-ref regeneration output schema and duplicate helper do not exist.

- [ ] **Step 3: Implement the exact schemas and deterministic signature**

```ts
export {
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  type RegenerateDishRequest,
  type RegenerateMenuRequest,
} from "./generation";
```

Define one dish-regeneration wire contract in `shared/contracts/regeneration.ts`. `requestLocalRefSchema` is `z.string().regex(/^(dish|ingredient|step|timeline|adaptation|pantry|label)_[1-9][0-9]*$/u)`; UUIDs are rejected at every reference leaf. `retainedDishPromptSchema` contains `dishRef`, role, position, name, description, cooking time, every ingredient with `ingredientRef` and quantity fields, and every recipe step with `stepRef` and instruction. It contains no menu/dish/step/member/pantry database ID.

`dishRegenerationAiOutputSchema` is a strict object with exactly these sections. Define every helper immediately above the export; none is an implied implementation:

```ts
const requestLocalRefSchema=z.string().regex(
  /^(dish|ingredient|step|timeline|adaptation|pantry|label)_[1-9][0-9]*$/u,
);
const dishRefSchema=z.string().regex(/^dish_[1-9][0-9]*$/u);
const ingredientRefSchema=z.string().regex(/^ingredient_[1-9][0-9]*$/u);
const stepRefSchema=z.string().regex(/^step_[1-9][0-9]*$/u);
const timelineRefSchema=z.string().regex(/^timeline_[1-9][0-9]*$/u);
const adaptationRefSchema=z.string().regex(/^adaptation_[1-9][0-9]*$/u);
const pantryRefSchema=z.string().regex(/^pantry_[1-9][0-9]*$/u);
const labelRefSchema=z.string().regex(/^label_[1-9][0-9]*$/u);
const labelSourceRefSchema=z.union([
  dishRefSchema,ingredientRefSchema,stepRefSchema,timelineRefSchema,adaptationRefSchema,
]);
const localIngredientSchema=dishIngredientSchema
  .omit({id:true,pantrySelectionId:true})
  .extend({ingredientRef:ingredientRefSchema,pantryRef:pantryRefSchema.nullable()}).strict();
const localStepSchema=recipeStepSchema.omit({id:true})
  .extend({stepRef:stepRefSchema}).strict();
const localRefDishSchema=dishSchema.omit({id:true,ingredients:true,steps:true})
  .extend({dishRef:dishRefSchema,
    ingredients:z.array(localIngredientSchema).min(1).max(50),
    steps:z.array(localStepSchema).min(1).max(30)}).strict();
const localRefTimelineStepSchema=menuTimelineStepSchema
  .omit({id:true,dishId:true,recipeStepId:true})
  .extend({timelineRef:timelineRefSchema,dishRef:dishRefSchema.nullable(),
    stepRef:stepRefSchema.nullable()}).strict();
const localSafetyActionSchema=safetyActionSchema
  .omit({dishId:true,ingredientId:true,beforeRecipeStepId:true})
  .extend({dishRef:dishRefSchema,ingredientRef:ingredientRefSchema,
    beforeStepRef:stepRefSchema}).strict();
const localRefAdaptationSchema=menuMemberAdaptationSchema
  .omit({id:true,dishId:true,branchBeforeRecipeStepId:true,safetyActions:true})
  .extend({adaptationRef:adaptationRefSchema,dishRef:dishRefSchema,
    beforeStepRef:stepRefSchema,
    safetyActions:z.array(localSafetyActionSchema).max(20)}).strict();
const localRefPantryUsageSchema=pantryUsageSchema
  .omit({selectionId:true,pantryItemId:true,dishIds:true})
  .extend({pantryRef:pantryRefSchema,
    dishRefs:z.array(dishRefSchema).max(10)}).strict();
const localRefGeneratedLabelSchema=generatedLabelConfirmationSchema
  .omit({sourceId:true})
  .extend({labelRef:labelRefSchema,sourceRef:labelSourceRefSchema}).strict();
export const retainedDishPromptSchema=localRefDishSchema;
export const wholeRegenerationPromptSchema=z.object({
  mode:z.literal("whole"),reason:z.enum(changeReasons),
  changeReasonCustom:z.string().trim().min(1).max(200).nullable(),
  excludedDishSignatures:z.array(z.string().min(1).max(2000)).max(200),
}).strict();
export const dishRegenerationPromptSchema=z.object({
  mode:z.literal("dish"),reason:z.enum(changeReasons),
  changeReasonCustom:z.string().trim().min(1).max(200).nullable(),
  replaceDishRef:dishRefSchema,
  sourceDishToReplace:retainedDishPromptSchema,
  retainedDishes:z.array(retainedDishPromptSchema).min(1).max(9),
  sourceTimeline:z.array(localRefTimelineStepSchema).max(50),
  sourceAdaptations:z.array(localRefAdaptationSchema).max(100),
  sourcePantryUsage:z.array(localRefPantryUsageSchema).max(50),
  sourceLabelConfirmations:z.array(localRefGeneratedLabelSchema).max(200),
  excludedDishSignatures:z.array(z.string().min(1).max(2000)).max(200),
}).strict();
export const dishRegenerationAiOutputSchema = z.object({
  replacementDish: localRefDishSchema, // one replacement dish, ingredients, and steps
  timeline: z.array(localRefTimelineStepSchema).min(1).max(50),
  adaptations: z.array(localRefAdaptationSchema).max(100),
  pantryUsage: z.array(localRefPantryUsageSchema).max(50),
  labelConfirmations: z.array(localRefGeneratedLabelSchema).max(200),
}).strict();
export type RetainedDishPrompt = z.infer<typeof retainedDishPromptSchema>;
export type DishRegenerationPrompt = z.infer<typeof dishRegenerationPromptSchema>;
export type DishRegenerationAiOutput = z.infer<typeof dishRegenerationAiOutputSchema>;
```

The local schemas reuse Plan 2's field limits but replace every database UUID relation with a field-specific request-local ref schema. Timeline, adaptation, safety-action, pantry-use, and label rows may refer to retained `dish_N` / `ingredient_N` / `step_N` refs and the one replacement dish's refs. `retainedDishPromptSchema` is the same complete `localRefDishSchema` shape, excluding no text leaf. `assertUniqueLocalRefDeclarations` runs through prompt declarations and rejects duplicates; materialization unions those server-known declarations with the replacement declarations and rejects a collision, dangling ref, wrong-kind ref, or label source outside the allowed source namespaces before allocating any UUID. Tests exercise every failure. Label status is provider-only `pending`; server validation still discards and canonically re-derives it. Define the fixture builders used above in `regeneration.test.ts`; no `make*` helper is imported from an unspecified module.

Plan 3 defines both named request schemas first and uses those same objects inside `generationCommandSchema`; Plan 4 only re-exports them for feature-local imports. Their locked fields are `idempotencyKey`, `sourceMenuId`, `changeReason`, nullable `changeReasonCustom`, up to 50 `expiredPantryConfirmations`, and additionally `dishId` for dish regeneration. Conditional custom-reason validation remains in those canonical Plan 3 schemas.

Append the six produced codes to Plan 3's `generationFailureCodes` tuple and add a contract test that `generationStatusDataSchema` accepts a terminal `failed` response with `error.code: "duplicate_output"`, `quota.consumed: false`, and no `menuId`. Extend Plan 3's `failureCopy` with these exact messages: `duplicate_output` → “元の献立とほぼ同じ案だったため保存しませんでした。今回は回数に含まれません”, `idempotency_payload_mismatch` → “前回と異なる内容で再送できません。もう一度操作してください”, `current_safety_revalidation_required` → “現在の家族設定ではこの献立を利用できません”, `current_target_member_required` → “現在の家族を1人以上選んでください”, `source_menu_not_found` → “元の献立が見つかりません”, `replace_dish_not_found` → “変更する料理が見つかりません”. Do not widen the failure code to arbitrary strings.

```ts
export type DishSignatureInput = {
  role: string;
  name: string;
  primaryIngredients: readonly string[];
};

export type MenuSignatureInput = { dishes: readonly DishSignatureInput[] };

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s・、。()（）]/g, "");

export function normalizeDishSignature(dish: DishSignatureInput): {
  role: string;
  name: string;
  ingredients: ReadonlySet<string>;
} {
  return {
    role: dish.role,
    name: normalize(dish.name),
    ingredients: new Set(dish.primaryIngredients.map(normalize)),
  };
}

export function createDishSignature(dish:DishSignatureInput):string{
  const normalized=normalizeDishSignature(dish);
  return JSON.stringify([normalized.role,normalized.name,[...normalized.ingredients].toSorted()]);
}
export function createMenuSignature(menu:MenuSignatureInput):string{
  return JSON.stringify(menu.dishes.map(createDishSignature).toSorted());
}

export function isMateriallySameDish(left: DishSignatureInput, right: DishSignatureInput): boolean {
  const a = normalizeDishSignature(left);
  const b = normalizeDishSignature(right);
  if (a.role !== b.role) return false;
  if (a.name === b.name) return true;
  const intersection = [...a.ingredients].filter((item) => b.ingredients.has(item)).length;
  const union = new Set([...a.ingredients, ...b.ingredients]).size;
  return union > 0 && intersection / union >= 0.8;
}

export function isMateriallySameMenu(left: MenuSignatureInput, right: MenuSignatureInput): boolean {
  if (left.dishes.length !== right.dishes.length) return false;
  return left.dishes.every((dish) => {
    const counterpart = right.dishes.find((candidate) => candidate.role === dish.role);
    return counterpart !== undefined && isMateriallySameDish(dish, counterpart);
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `docker compose run --rm --no-deps app sh -lc 'npm test -- --run shared/contracts/regeneration.test.ts shared/safety/deduplicate.test.ts && npm run typecheck'`

Expected: the focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the contracts**

```bash
git add shared/contracts/regeneration.ts shared/contracts/regeneration.test.ts shared/contracts/generation.ts shared/contracts/generation.test.ts shared/safety/deduplicate.ts shared/safety/deduplicate.test.ts
git commit -m "feat: define regeneration contracts"
```

### Task 3: Revalidate stored menus with current household safety

**Files:**
- Create: `netlify/functions/_shared/revalidation-service.ts`
- Create: `netlify/functions/_shared/revalidation-service.test.ts`
- Create: `netlify/functions/_shared/revalidation-adapter.ts`
- Create: `netlify/functions/_shared/stored-menu-loader.ts`
- Create: `netlify/functions/_shared/stored-menu-loader.test.ts`
- Create: `netlify/functions/_shared/stored-menu-loader.types.test.ts`
- Create: `netlify/functions/revalidate-menu.ts`
- Create: `netlify/functions/revalidate-menu.test.ts`
- Modify: `supabase/migrations/20260711003000_history_regeneration.sql`
- Modify: `supabase/tests/database/history_regeneration.test.sql`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: Plan 2's `loadCurrentSafetyContext(admin,userId,targetMemberIds)`, nullable owner-composite `menu_target_members.(household_member_id,household_member_user_id)` link, immutable `member_display_name_snapshot`/`anonymous_ref`, normalized `menu_safety_actions`, immutable `menu_label_confirmations.source_text_snapshot`, `createCurrentSafetyFingerprint(context)`, distinct `validatedMenuSchema` / `generatedMenuSchema`, `ValidatedMenu` / `GeneratedMenu`, and Plan 3's `createUserScopedSupabase(accessToken)` plus sole three-argument confirmation RPC. This task owns its normalized server-side stored-menu loader and dedicated `validateStoredMenuCurrentSafety` subset validator; it never imports Plan 3's browser-only `getMenuResult()`, trusts a service-role query to establish ownership, or replaces Plan 3's confirmation RPC.
- Produces: `loadStoredMenu(client,userId,menuId)`, `toStoredRevalidationCandidate(menu,currentContext)`, `revalidateStoredMenu(deps,input)`, `createRevalidationDeps(user)`, and `POST /api/menus/:menuId/revalidate`. Stored confirmation snapshots and confirmed provenance remain display/audit data; only a current-canonical pending generated-shape projection enters the provider-output validator. Reconciliation persists every current canonical source snapshot and the response carries that exact saved human-readable label-warning projection so a newly added allergy cannot pass revalidation while remaining invisible on the result page.

- [ ] **Step 1: Write the failing service test**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  makeCurrentSafetyContext,makeGenerationContext,makeValidatedMenu,
} from "../../../shared/testing/factories";
import { revalidateStoredMenu } from "./revalidation-service";

it("validates historical dishes against current rather than snapshot safety", async () => {
  const validMenu = makeValidatedMenu();
  const currentSafety = makeCurrentSafetyContext();
  const save = vi.fn().mockResolvedValue(undefined);
  const result = await revalidateStoredMenu({
    loadMenu: vi.fn().mockResolvedValue({ menu: validMenu,userId:"user-1",
      safetyFingerprint:"previous",derivationGroupId:crypto.randomUUID(),version:1,
      preferenceSnapshot:{},targetMemberIds:["20000000-0000-4000-8000-000000000001"],
      targetMembers:[] }),
    loadCurrentSafety: vi.fn().mockResolvedValue({
      fingerprint: "current",
      allergenCatalogVersion: "allergens-v3",
      foodRuleVersion: "food-v2",
    }),
    validateStoredCurrentSafety: vi.fn().mockResolvedValue({ ok: false, candidate: validMenu,
      changedDetails:[], issues: [{ code: "allergen", path: "dishes.0", message: "くるみを含みます" }] }),
    reconcileCurrentLabelWarnings:vi.fn().mockResolvedValue([]),
    save,
  }, { userId: "user-1", menuId: "menu-1" });

  expect(result.status).toBe("invalid");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ safetyFingerprint: "current" }));
});

it("keeps confirmed provenance in storage but revalidates a pending generated projection",async()=>{
  const stored=makeValidatedMenu({labelConfirmation:{confirmationStatus:"confirmed",
    confirmedAt:"2026-07-11T01:00:00.000Z",confirmedBy:crypto.randomUUID()}});
  const validate=vi.fn().mockResolvedValue({ok:true,candidate:makeValidatedMenu(),changedDetails:[],issues:[]});
  await revalidateStoredMenu({
    loadMenu:vi.fn().mockResolvedValue({menu:stored,userId:"user-1",safetyFingerprint:"old",
      derivationGroupId:crypto.randomUUID(),version:1,preferenceSnapshot:{},targetMemberIds:[],
      targetMembers:[]}),
    loadCurrentSafety:vi.fn().mockResolvedValue({fingerprint:"current",
      allergenCatalogVersion:"allergens-v3",foodRuleVersion:"food-v2"}),
    validateStoredCurrentSafety:validate,reconcileCurrentLabelWarnings:vi.fn().mockResolvedValue([]),
    save:vi.fn().mockResolvedValue(undefined),
  },{userId:"user-1",menuId:stored.menuId});
  expect(validate).toHaveBeenCalledWith(expect.objectContaining({stored}),expect.anything());
  expect(stored.labelConfirmations[0]).toMatchObject({confirmationStatus:"confirmed",
    confirmedAt:"2026-07-11T01:00:00.000Z"});
});
```

- [ ] **Step 2: Run it and verify the missing-module failure**

Run: `docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/revalidation-service.test.ts`

Expected: FAIL because `revalidation-service.ts` does not exist.

- [ ] **Step 3: Implement the dependency-injected service and HTTP function**

```ts
import type {
  GeneratedMenu, ValidatedMenu, MenuValidationResult, MenuValidationIssue,
} from "../../../shared/contracts/generation";
import { toStoredRevalidationCandidate } from "./stored-menu-loader";
import type { GenerationContext } from "../../../shared/safety/generation-context";
import type { StoredMenuAggregate } from "./stored-menu-loader";

export type RevalidationStatus = "valid" | "changed" | "invalid";

export type CurrentMenuLabelWarning = {
  confirmationId: string;
  sourceType: GeneratedMenu["labelConfirmations"][number]["sourceType"];
  sourceId: string;
  sourcePath: string;
  sourceText: string;
  allergenId: string;
  allergenName: string;
  anonymousMemberRef: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
};

export type RevalidationResult = {
  status: RevalidationStatus;
  safetyFingerprint: string;
  allergenCatalogVersion: string;
  foodRuleVersion: string;
  issues: readonly MenuValidationIssue[];
  changedDetails: readonly ("pantry_item_removed" | "pantry_quantity_changed" | "preference_changed")[];
  currentLabelWarnings: readonly CurrentMenuLabelWarning[];
};

export type RevalidationDeps = {
  loadMenu(userId: string, menuId: string): Promise<StoredMenuAggregate>;
  loadCurrentSafety(userId: string, stored: StoredMenuAggregate): Promise<{
    fingerprint: string;
    allergenCatalogVersion: string;
    foodRuleVersion: string;
  }>;
  validateStoredCurrentSafety(input: {stored: StoredMenuAggregate; userId: string}): Promise<{
    ok: boolean; candidate: GeneratedMenu; issues: readonly MenuValidationIssue[];
    changedDetails: RevalidationResult["changedDetails"];
  }>;
  reconcileCurrentLabelWarnings(input: {
    stored: StoredMenuAggregate;
    candidate: GeneratedMenu;
    safetyFingerprint:string;
  }): Promise<readonly CurrentMenuLabelWarning[]>;
  save(input: RevalidationResult & { userId: string; menuId: string }): Promise<void>;
};

export async function revalidateStoredMenu(
  deps: RevalidationDeps,
  input: { userId: string; menuId: string },
): Promise<RevalidationResult> {
  const menu = await deps.loadMenu(input.userId, input.menuId);
  const current = await deps.loadCurrentSafety(input.userId, menu);
  const validation = await deps.validateStoredCurrentSafety({stored:menu,userId:input.userId});
  const currentLabelWarnings=validation.ok
    ? await deps.reconcileCurrentLabelWarnings({stored:menu,candidate:validation.candidate,
        safetyFingerprint:current.fingerprint})
    : [];
  const persisted: RevalidationResult = {
    status: validation.ok
      ? menu.safetyFingerprint === current.fingerprint && validation.changedDetails.length===0 ? "valid" : "changed"
      : "invalid",
    safetyFingerprint: current.fingerprint,
    allergenCatalogVersion: current.allergenCatalogVersion,
    foodRuleVersion: current.foodRuleVersion,
    issues: validation.ok ? [] : validation.issues,
    changedDetails: validation.changedDetails,
    currentLabelWarnings,
  };
  await deps.save({ ...persisted, ...input });
  return persisted;
}
```

```ts
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http";
import { createRevalidationDeps } from "./_shared/revalidation-adapter";
import { revalidateStoredMenu } from "./_shared/revalidation-service";

const menuIdSchema = z.string().uuid();

export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const menuId = menuIdSchema.safeParse(context.params.menuId);
    if (!menuId.success) throw new HttpError(400, "invalid_menu_id", "献立を確認できませんでした");
    const result = await revalidateStoredMenu(createRevalidationDeps(user), {
      userId: user.userId,
      menuId: menuId.data,
    });
    return json(200, { ok: true, data: result });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/menus/:menuId/revalidate" };
```

`CurrentMenuLabelWarning.sourceText` is always the reconciliation row's saved `source_text_snapshot`; it is never derived from a mutable or reconstructed aggregate after the RPC returns.

Create `stored-menu-loader.ts` as the only server normalized-menu loader. Its query is executed with `createUserScopedSupabase(user.accessToken)`, includes `.eq("id",menuId).eq("user_id",userId).maybeSingle()`, and selects the Plan 3 normalized result fields plus `user_id,safety_fingerprint,derivation_group_id,version,preference_snapshot`, normalized `menu_safety_actions`, `menu_label_confirmations.source_text_snapshot`, and `menu_target_members(household_member_id,member_display_name_snapshot,anonymous_ref)`. Every PostgREST embed is pinned with an explicit `!constraint` hint using Plan 2's final owner-composite FK name. Because adaptations have only a dish-owner relationship, load them under `dishes!dishes_menu_owner_fkey`, and load safety actions under each adaptation; do not assume a direct menu-to-adaptation relationship. A nullable live member link is never reconstructed from a snapshot. Move the pure snake-case-to-`ValidatedMenu` mapping from Plan 3's result loader into this server file without changing field names; its `ValidatedMenu.labelConfirmations[].sourceText` type is populated only from `source_text_snapshot`. Finish with `validatedMenuSchema.parse(...)` and return this closed result:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {generatedMenuSchema,validatedMenuSchema,
  type GeneratedMenu,type ValidatedMenu} from "../../../shared/contracts/generation";
import {deriveCurrentGeneratedLabelConfirmations} from "../../../shared/safety/allergens";
import type { Database } from "../../../src/shared/types/database.generated";
import { HttpError } from "./http";

export type StoredMenuAggregate = {
  menu: ValidatedMenu;
  userId: string;
  safetyFingerprint: string;
  derivationGroupId: string;
  version: number;
  preferenceSnapshot: unknown;
  targetMemberIds: readonly string[];
  targetMembers: readonly { householdMemberId: string | null; anonymousMemberRef: string;
    displayNameSnapshot: string; displayName: string }[];
};

export const STORED_MENU_SELECT = `
  id,user_id,safety_fingerprint,derivation_group_id,version,preference_snapshot,
  meal_type,cuisine_genre,servings,total_elapsed_minutes,output_schema_version,
  menu_target_members!menu_target_members_menu_owner_fkey(
    household_member_id,member_display_name_snapshot,anonymous_ref,
    current_member:household_members!menu_target_members_member_owner_fkey(display_name)),
  dishes!dishes_menu_owner_fkey(id,role,position,name,description,cooking_time_minutes,
    dish_ingredients!dish_ingredients_dish_owner_fkey(
      id,position,name,quantity_value,quantity_text,unit,store_section,
      pantry_selection_id,label_confirmation_required),
    recipe_steps!recipe_steps_dish_owner_fkey(id,position,instruction),
    menu_member_adaptations!menu_member_adaptations_dish_owner_fkey(
      id,dish_id,anonymous_member_ref,portion_text,branch_before_recipe_step_id,
      additional_cutting,additional_heating,additional_seasoning,serving_check,safety_tags,
      menu_safety_actions!menu_safety_actions_adaptation_owner_fkey(
        id,dish_id,ingredient_id,anonymous_member_ref,before_recipe_step_id,
        position,kind,instruction))),
  menu_timeline_steps!menu_timeline_steps_menu_owner_fkey(
    id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id),
  generation_pantry_selections!generation_pantry_selections_menu_owner_fkey(
    id,pantry_item_id,pantry_name_snapshot,priority,
    usage_status,planned_quantity,inventory_quantity_snapshot,shortage_quantity,unit,unused_reason),
  menu_label_confirmations!menu_label_confirmations_menu_owner_fkey(
    source_type,source_id,source_path,source_text_snapshot,allergen_id,
    anonymous_member_ref,dictionary_version,confirmation_status,confirmed_at,confirmed_by)
` as const;

export function buildStoredMenuQuery(
  client: SupabaseClient<Database>, userId: string, menuId: string,
) {
  return client.from("menus").select(STORED_MENU_SELECT)
    .eq("id", menuId).eq("user_id", userId).maybeSingle();
}

export async function loadStoredMenu(
  client: SupabaseClient<Database>,
  userId: string,
  menuId: string,
): Promise<StoredMenuAggregate> {
  const { data, error } = await buildStoredMenuQuery(client, userId, menuId);
  if (error !== null) throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
  if (data === null) throw new HttpError(404, "menu_not_found", "献立が見つかりません");
  const dishes = data.dishes.toSorted((a, b) => a.position - b.position).map((dish) => ({
    id: dish.id, role: dish.role, position: dish.position, name: dish.name,
    description: dish.description, cookingTimeMinutes: dish.cooking_time_minutes,
    ingredients: dish.dish_ingredients.toSorted((a, b) => a.position - b.position).map((item) => ({
      id: item.id, position: item.position, name: item.name, quantityValue: item.quantity_value,
      quantityText: item.quantity_text, unit: item.unit, storeSection: item.store_section,
      pantrySelectionId: item.pantry_selection_id,
      labelConfirmationRequired: item.label_confirmation_required,
    })),
    steps: dish.recipe_steps.toSorted((a, b) => a.position - b.position).map((step) => ({
      id: step.id, position: step.position, instruction: step.instruction,
    })),
  }));
  const pantryDishIds = new Map<string, Set<string>>();
  for (const dish of dishes) for (const ingredient of dish.ingredients) {
    if (ingredient.pantrySelectionId === null) continue;
    const ids = pantryDishIds.get(ingredient.pantrySelectionId) ?? new Set<string>();
    ids.add(dish.id); pantryDishIds.set(ingredient.pantrySelectionId, ids);
  }
  const adaptations = data.dishes.flatMap((dishRow) =>
    dishRow.menu_member_adaptations.map((item) => ({
    id: item.id, dishId: item.dish_id, anonymousMemberRef: item.anonymous_member_ref,
    portionText: item.portion_text, branchBeforeRecipeStepId: item.branch_before_recipe_step_id,
    additionalCutting: item.additional_cutting, additionalHeating: item.additional_heating,
    additionalSeasoning: item.additional_seasoning, servingCheck: item.serving_check,
    safetyTags: item.safety_tags,
    safetyActions: item.menu_safety_actions
      .toSorted((a,b) => a.position-b.position)
      .map((action) => ({kind:action.kind,dishId:action.dish_id,
        ingredientId:action.ingredient_id,anonymousMemberRef:action.anonymous_member_ref,
        beforeRecipeStepId:action.before_recipe_step_id,instruction:action.instruction})),
  })));
  const menu = validatedMenuSchema.parse({
    schemaVersion: data.output_schema_version, menuId: data.id, mealType: data.meal_type,
    cuisineGenre: data.cuisine_genre, servings: data.servings,
    totalElapsedMinutes: data.total_elapsed_minutes,
    safetyTags: [...new Set(adaptations.flatMap((item) => item.safetyTags))], dishes,
    timeline: data.menu_timeline_steps.toSorted((a, b) => a.position - b.position).map((item) => ({
      id: item.id, position: item.position, startMinute: item.start_minute,
      durationMinutes: item.duration_minutes, instruction: item.instruction,
      dishId: item.dish_id, recipeStepId: item.recipe_step_id,
    })), adaptations,
    pantryUsage: data.generation_pantry_selections.map((item) => ({
      selectionId: item.id, pantryItemId: item.pantry_item_id,
      pantryItemName: item.pantry_name_snapshot, priority: item.priority,
      usageStatus: item.usage_status, plannedQuantity: item.planned_quantity,
      inventoryQuantity: item.inventory_quantity_snapshot, shortageQuantity: item.shortage_quantity,
      unit: item.unit, dishIds: [...(pantryDishIds.get(item.id) ?? new Set<string>())],
      unusedReason: item.unused_reason,
    })),
      labelConfirmations: data.menu_label_confirmations.map((item) => ({
        sourceType: item.source_type, sourceId: item.source_id, sourcePath: item.source_path,
        sourceText: item.source_text_snapshot,
        allergenId: item.allergen_id, anonymousMemberRef: item.anonymous_member_ref,
        dictionaryVersion: item.dictionary_version, confirmationStatus: item.confirmation_status,
        confirmedAt: item.confirmed_at, confirmedBy: item.confirmed_by,
      })),
  });
  const targetMembers=data.menu_target_members
    .toSorted((left,right)=>
      Number(left.anonymous_ref.slice("member_".length))-
      Number(right.anonymous_ref.slice("member_".length)))
    .map((item)=>({
    householdMemberId:item.household_member_id,
    anonymousMemberRef:item.anonymous_ref,
    displayNameSnapshot:item.member_display_name_snapshot,
    displayName:item.current_member?.display_name ?? item.member_display_name_snapshot,
  }));
  return { menu, userId: data.user_id, safetyFingerprint: data.safety_fingerprint,
    derivationGroupId: data.derivation_group_id, version: data.version,
    preferenceSnapshot: data.preference_snapshot,
    targetMembers,
    targetMemberIds: targetMembers.flatMap((item) =>
      item.householdMemberId === null ? [] : [item.householdMemberId]) };
}

export function toStoredRevalidationCandidate(
  menu:ValidatedMenu, context:GenerationContext,
):GeneratedMenu{
  return generatedMenuSchema.parse({
    ...menu,
    labelConfirmations:deriveCurrentGeneratedLabelConfirmations(menu,context.safety),
  });
}
```

`stored-menu-loader.test.ts` supplies the complete normalized row from Plan 3 in the exact nested PostgREST shape and asserts exact reconstruction of dishes, ingredients, steps, timeline, adaptations by flattening each dish's adaptations and each adaptation's `menu_safety_actions`, pantry usage, label confirmations including exact `source_text_snapshot` → `sourceText` mapping and `confirmedAt/confirmedBy`, target IDs, preference snapshot, fingerprint, group, and version. Its fixture deliberately makes a reconstructed current menu text differ from `source_text_snapshot` and proves the stored `ValidatedMenu` retains the persisted snapshot. A deleted-member fixture has null `household_member_id`/owner link but retains `anonymous_ref`, safety actions, and `member_display_name_snapshot`; it is absent from `targetMemberIds`, uses the snapshot only for display, and is never sent to `loadCurrentSafetyContext`. A live target displays its current name with snapshot fallback. A multi-member fixture returns rows in reverse insertion order with `member_10` before `member_2` and proves the loader numerically sorts the regex-constrained suffix before producing both `targetMembers` and fingerprint input `targetMemberIds`; PostgREST/DB return order and string order are never authoritative. The test separately proves `toStoredRevalidationCandidate(menu,currentContext)` preserves all recipe/safety-action text, discards the historical confirmation set as validator evidence, derives the exact current pending set with each canonical `sourceText`, and does not mutate the stored `ValidatedMenu`. Removing a current allergy removes its formerly required confirmation without an `extra_label_confirmation`; adding an allergy or updating aliases adds the newly required confirmation before validation. It also asserts `.eq("user_id",userId)` is applied and a missing/foreign row is indistinguishable as `404 menu_not_found`.

Add a compile-time query-shape regression test in `stored-menu-loader.types.test.ts`; do not cast the query result or duplicate a handwritten database-row interface:

```ts
import type { QueryData } from "@supabase/supabase-js";
import { describe, expectTypeOf, it } from "vitest";
import { buildStoredMenuQuery } from "./stored-menu-loader";

type StoredMenuSelectRow = NonNullable<
  QueryData<ReturnType<typeof buildStoredMenuQuery>>
>;
type DishRow = StoredMenuSelectRow["dishes"][number];
type AdaptationRow = DishRow["menu_member_adaptations"][number];

describe("stored menu PostgREST query types", () => {
  it("resolves every named owner-composite embed with the required cardinality", () => {
    expectTypeOf<StoredMenuSelectRow>().not.toMatchTypeOf<{ error: true }>();
    expectTypeOf<StoredMenuSelectRow["menu_target_members"]>()
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["dish_ingredients"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["recipe_steps"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<DishRow["menu_member_adaptations"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<AdaptationRow["menu_safety_actions"]>()
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["menu_timeline_steps"]>()
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["generation_pantry_selections"]>()
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["menu_label_confirmations"]>()
      .toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<StoredMenuSelectRow["menu_label_confirmations"][number]
      ["source_text_snapshot"]>().toEqualTypeOf<string>();
  });
});
```

This file must fail typechecking if a hint is misspelled, a duplicate FK makes a relation ambiguous again, or an embed's inferred cardinality changes. The runtime loader test additionally asserts the emitted select string contains every exact `!constraint` token and contains no bare embedded relation.

Append the exact reconciliation RPC correction to migration `030`. `public.reconcile_menu_label_confirmations(p_user_id uuid,p_menu_id uuid,p_expected_safety_fingerprint text,p_requirements jsonb)` is service-role-only. It locks the owner menu and its live target rows, builds `target_member_ids` with `ORDER BY substring(anonymous_ref from '^member_([1-9][0-9]*)$')::integer`, and calls Plan 3's `private.lock_and_assert_current_safety_fingerprint(user_id,target_member_ids,expected)`. The Plan 2 regex constraint makes integer extraction total for persisted rows; lexical `anonymous_ref` ordering and unordered aggregation are forbidden. The RPC validates an array of at most the generated-confirmation cap and rejects duplicate/unknown keys. Every requirement is the closed exact shape `{sourceType,sourceId,sourcePath,sourceTextSnapshot,allergenId,anonymousMemberRef,dictionaryVersion}`; `sourceTextSnapshot` must satisfy the same canonical nonblank 1–500-character contract as Plan 2's column. In one transaction it marks the menu's prior `is_current` rows false, then upserts the exact current canonical requirements by `(menu,sourceType,sourceId,sourcePath,allergen,member,dictionaryVersion,fingerprint)`, inserting `sourceTextSnapshot` into `source_text_snapshot`. On a same-fingerprint conflict it preserves both the user's confirmed provenance and that row's immutable `source_text_snapshot`; every new fingerprint/dictionary/requirement gets a fresh UUID, the submitted snapshot, and `pending`. It returns only the resulting current rows, including `source_text_snapshot`. No raw requirement JSON is retained outside the normalized table.

Plan 4 reuses and tests Plan 3's existing three-argument function `public.confirm_menu_label_confirmation(p_menu_id uuid,p_confirmation_id uuid,p_expected_safety_fingerprint text)`; migration `030` neither drops, recreates, overloads, nor grants it. The existing function locks/recomputes current safety through Plan 3's private helper and updates only an owner row with `is_current`, `requirement_safety_fingerprint = p_expected_safety_fingerprint`, and `pending`; stale/foreign/already-confirmed IDs remain the same empty result. Plan 4 pgTAP proves a settings change makes the old ID unconfirmable, reconciliation creates new pending IDs with their exact snapshots, same-fingerprint replay preserves a confirmed row and its immutable snapshot, a concurrent fingerprint change rolls back reconciliation/confirmation, another owner is indistinguishable, and `pg_proc` still contains exactly Plan 3's sole three-argument overload and no two-argument overload. Its multi-member fixture inserts `member_10` before `member_2` and verifies both reconciliation and confirmation use numeric suffix order and the same canonical fingerprint regardless of insertion/query order.

Implement exact helper `reconcileCurrentMenuLabelWarnings(admin,user,input)` in `revalidation-adapter.ts` from the already validated `candidate.labelConfirmations`, and bind it as the dependency's `reconcileCurrentLabelWarnings`. Send only the closed exact fields to that RPC, mapping each canonical `candidate.labelConfirmations[].sourceText` to `sourceTextSnapshot`; parse its returned IDs/status/fingerprint and `source_text_snapshot`, and map that saved snapshot directly to `CurrentMenuLabelWarning.sourceText`. Do not reconstruct or dynamically resolve display text from `candidate`. Resolve allergen names through the current catalog and member names by live name→immutable snapshot→`家族N`. Every returned current warning therefore has a non-null `confirmationId` and a persisted immutable source snapshot. Cap and sort by source path, allergen ID, and anonymous member ref. Tests cover two leaves sharing one normalized source ID with distinct snapshots, an added allergy creating a confirmable pending warning, a removed allergy archiving the obsolete warning, exact returned `source_text_snapshot` display even when candidate text differs, same-fingerprint confirmed provenance/snapshot preservation, deleted-member snapshot fallback, and no raw UUID/catalog ID/source path in displayed copy. Historical rows and their immutable snapshots remain available for audit but never enter validator evidence merely because they remain stored.

The adapter's `save` uses owner/menu-conflict upsert on `menu_revalidations`, replacing status/fingerprint/versions/issues/`created_at` for that one latest row. Ten repeated mount/event calls for the same menu leave exactly one row; pgTAP and a Function abuse test prove no unbounded append path.

Implement the adapter with the authenticated user object, not a bare browser-provided ID:

```ts
export function createRevalidationDeps(user: AuthenticatedUser): RevalidationDeps {
  const ownerClient = createUserScopedSupabase(user.accessToken);
  const admin = getSupabaseAdmin();
  return {
    loadMenu: async (userId, menuId) => {
      return loadStoredMenu(ownerClient, userId, menuId);
    },
    loadCurrentSafety: async (userId, stored) => {
      const safety = await loadCurrentSafetyContext(admin, userId, stored.targetMemberIds);
      return { fingerprint: createCurrentSafetyFingerprint(safety),
        allergenCatalogVersion: safety.dictionaryVersion,
        foodRuleVersion: safety.foodRuleVersion };
    },
    validateStoredCurrentSafety: async ({stored,userId}) =>
      validateStoredMenuCurrentSafety({ownerClient,admin,stored,userId}),
    reconcileCurrentLabelWarnings: (input) =>
      reconcileCurrentMenuLabelWarnings(admin,user,input),
    save: async (value) => {
      const { error } = await admin.from("menu_revalidations").upsert({
        user_id: value.userId, menu_id: value.menuId,
        safety_fingerprint: value.safetyFingerprint,
        allergen_catalog_version: value.allergenCatalogVersion,
        food_rule_version: value.foodRuleVersion, status: value.status,
        issues: value.issues,created_at:new Date().toISOString(),
      },{onConflict:"menu_id,user_id"});
      if (error !== null) throw new HttpError(503, "revalidation_unavailable", "現在の家族設定で確認できませんでした");
    },
  };
}
```

Define `validateStoredMenuCurrentSafety` as a dedicated history/result validator; do not pass a mutable generation `GenerationContext` to it. It scans the immutable stored menu text, recipe steps, timeline, adaptations, structured safety actions, and stored pantry-name snapshot against the current owner-proven target members, allergies, catalog aliases, food rules, and current label requirements. Current pantry deletion/quantity changes and current preference changes are returned as bounded non-blocking `changedDetails` codes (`pantry_item_removed`, `pantry_quantity_changed`, `preference_changed`), never as unsafe/invalid issues. It restores only owner-proven, non-null `stored.targetMemberIds`; deleted-member snapshots are display provenance only and can never become current validator members. Mount-time revalidation uses this subset validator and derives current pending label warnings; regeneration separately calls `buildStoredGenerationContext`, which reloads current pantry/preferences and performs full generation validation only after the user has confirmed the current inputs. Its tests change current portion preference and pantry quantity, null one deleted target link, and prove the stored result is `changed` with details while only the surviving member and current values reach regeneration.

`RevalidationDeps.loadMenu` returns the complete `StoredMenuAggregate`; pass only its filtered, exact owner-proven non-null target IDs to `loadCurrentSafetyContext`, and call `createRevalidationDeps(user)` in the handler. No admin menu lookup may precede the owner-scoped load. The focused adapter test asserts a deleted member ID is never passed, pantry/preference drift produces `changedDetails` rather than an invalid gate, and the sole history validator is `validateStoredMenuCurrentSafety`. A confirmed historical row remains confirmed in the returned aggregate for provenance display; revalidation never interprets that prior user action as current provider evidence.

- [ ] **Step 4: Run service, function, and type tests**

Run: `docker compose run --rm --no-deps app sh -lc 'npm test -- --run netlify/functions/_shared/stored-menu-loader.test.ts netlify/functions/_shared/stored-menu-loader.types.test.ts netlify/functions/_shared/revalidation-service.test.ts netlify/functions/revalidate-menu.test.ts && npm run typecheck'`

Expected: both suites pass with no PII in logged errors.

- [ ] **Step 5: Commit the revalidation boundary**

```bash
git add netlify/functions/_shared/stored-menu-loader.ts netlify/functions/_shared/stored-menu-loader.test.ts netlify/functions/_shared/stored-menu-loader.types.test.ts netlify/functions/_shared/revalidation-service.ts netlify/functions/_shared/revalidation-service.test.ts netlify/functions/_shared/revalidation-adapter.ts netlify/functions/revalidate-menu.ts netlify/functions/revalidate-menu.test.ts
git commit -m "feat: revalidate history with current safety"
```

### Task 4: Extend generation for whole-menu and dish regeneration

**Files:**
- Create: `netlify/functions/_shared/regeneration-context.ts`
- Create: `netlify/functions/_shared/regeneration-context.test.ts`
- Create: `netlify/functions/_shared/regeneration-adapter.ts`
- Create: `netlify/functions/_shared/regeneration-prompt.test.ts`
- Create: `netlify/functions/generate-dish.ts`
- Create: `netlify/functions/generate-dish.test.ts`
- Modify: `netlify/functions/generate-menu.ts`
- Modify: `netlify/functions/generate-menu.test.ts`
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/openrouter.ts`
- Modify: `netlify/functions/_shared/openrouter.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`

**Interfaces:**
- Consumes: Plan 3's canonical `GenerationCommand`, `GenerationExecutionContext`, `GenerationDependencies`, one `runGeneration(deps,command)`, quota/idempotency repository, `buildGenerationMessages`, context-selected OpenRouter response schema, repair, Plan 2's `validateGeneratedMenu`, and `repository.succeed` finalizer; Task 2's `DishRegenerationAiOutput`; Task 3's owner-scoped `loadStoredMenu`, `toStoredRevalidationCandidate`, and `buildStoredGenerationContext`.
- Produces: regeneration context loaders and dispatcher branches for the already-defined command union, `toRetainedDishPrompt`, `buildDishRegenerationPrompt`, `materializeDishRegenerationCandidate`, reason/current-safety prompt composition, whole regeneration through `POST /api/generations/menu`, and dish regeneration through `POST /api/generations/dish`. No second command union, generation service, quota path, or persistence path is allowed.

- [ ] **Step 1: Write failing context and duplicate-result tests**

```ts
it("loads current safety and excludes every dish in the root group", async () => {
  const context=await loadRegenerationExecutionContext(deps,user,{
    kind:"regenerate_dish",request:{sourceMenuId:"menu-2",dishId:"dish-2",
      idempotencyKey:"request-1",changeReason:"simpler",changeReasonCustom:null,
      expiredPantryConfirmations:[]},
  },"request-row-1",50_000);
  expect(context.expectedSafetyFingerprint).toBe("current-v3");
  expect(context.regeneration.existingDerivationMenus.flatMap((menu)=>menu.dishSignatures))
    .toEqual(expect.arrayContaining([teriyakiSignature,sweetSoySignature]));
  expect(context.regeneration.retainedDishIds).not.toContain("dish-2");
});

it("requires at least one surviving current target member",async()=>{
  deps.loadSource.mockResolvedValue(makeStoredMenu({targetMembers:[{
    householdMemberId:null,anonymousMemberRef:"member_1",
    displayNameSnapshot:"削除済みの家族",displayName:"削除済みの家族",
  }],targetMemberIds:[]}));
  await expect(loadRegenerationExecutionContext(deps,user,dishCommand,"request-row-1",50_000))
    .rejects.toMatchObject({code:"current_target_member_required"});
  expect(deps.buildCurrentContext).not.toHaveBeenCalled();
});

it("returns duplicate_output without finalizing user success", async () => {
  const result = await runGeneration(depsWithDuplicateOutput, wholeRegenerationCommand);
  expect(result).toMatchObject({
    status: "failed",
    error: { code: "duplicate_output" },
    quota: { consumed: false },
  });
});

it("materializes one replacement plus complete local-ref sections into one full candidate",()=>{
  const execution=makeDishRegenerationExecutionContext();
  const candidate=materializeDishRegenerationCandidate(execution,makeDishRegenerationAiOutput());
  expect(candidate.dishes.filter((dish)=>dish.id===execution.regeneration.replaceDishId)).toHaveLength(0);
  const retained=candidate.dishes.find((dish)=>dish.name==="保持する副菜");
  const sourceRetained=execution.regeneration.sourceMenu.dishes
    .find((dish)=>dish.name==="保持する副菜");
  expect(retained).toBeDefined();expect(sourceRetained).toBeDefined();
  if(retained===undefined||sourceRetained===undefined)throw new Error("retained fixture missing");
  expect({role:retained.role,position:retained.position,name:retained.name,
    description:retained.description,cookingTimeMinutes:retained.cookingTimeMinutes,
    ingredientText:retained.ingredients.map(({name,quantityValue,quantityText,unit,storeSection})=>
      ({name,quantityValue,quantityText,unit,storeSection})),
    stepText:retained.steps.map(({position,instruction})=>({position,instruction}))})
    .toEqual({role:sourceRetained.role,position:sourceRetained.position,name:sourceRetained.name,
      description:sourceRetained.description,cookingTimeMinutes:sourceRetained.cookingTimeMinutes,
      ingredientText:sourceRetained.ingredients.map(({name,quantityValue,quantityText,unit,storeSection})=>
        ({name,quantityValue,quantityText,unit,storeSection})),
      stepText:sourceRetained.steps.map(({position,instruction})=>({position,instruction}))});
  expect(retained.id).not.toBe(sourceRetained.id);
  expect(retained.ingredients.map((item)=>item.id))
    .not.toEqual(sourceRetained.ingredients.map((item)=>item.id));
  expect(retained.steps.map((item)=>item.id))
    .not.toEqual(sourceRetained.steps.map((item)=>item.id));
  expect(candidate.timeline.every((row)=>candidate.dishes.some((dish)=>dish.id===row.dishId))).toBe(true);
  expect(validateGeneratedMenu(candidate,execution.generationContext).ok).toBe(true);
});
```

- [ ] **Step 2: Run and verify both tests fail**

Run: `docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-prompt.test.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/generation-service.test.ts`

Expected: FAIL because regeneration context, dedicated replacement-output parsing/materialization, and duplicate enforcement are absent.

- [ ] **Step 3: Fill Plan 3's canonical execution context without a parallel type**

Import `GenerationExecutionContext` and `RegenerationExecutionPayload` from Plan 3. `regeneration-context.ts` exports only this loader; it does not define another execution union:

```ts
import { z } from "zod";
import type { GenerationCommand,ValidatedMenu } from "../../../shared/contracts/generation";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint";
import type { GenerationContext } from "../../../shared/safety/generation-context";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu";
import { createDishSignature,createMenuSignature } from "../../../shared/safety/deduplicate";
import type { AuthenticatedUser,GenerationExecutionContext } from "./generation-service";
import { HttpError } from "./http";
import {toStoredRevalidationCandidate,type StoredMenuAggregate} from "./stored-menu-loader";

type RegenerationCommand=Extract<GenerationCommand,
  {kind:"regenerate_menu"|"regenerate_dish"}>;
const preferenceSnapshotSchema=z.record(z.string(),z.unknown()).readonly();
const dishSignatureInput=(dish:ValidatedMenu["dishes"][number])=>({
  role:dish.role,name:dish.name,primaryIngredients:dish.ingredients.map((item)=>item.name),
});
type RetainedPromptResult={
  dto:readonly RetainedDishPrompt[];
  replaceTarget:RetainedDishPrompt|null;
  refMap:ReadonlyMap<string,string>;
};
export function toRetainedDishPrompt(menu:ValidatedMenu,replaceDishId:string|null):RetainedPromptResult{
  const refMap=new Map<string,string>();
  const ordered=menu.dishes.toSorted((left,right)=>left.position-right.position);
  const all=ordered.map((dish,dishIndex)=>{
      const dishRef=`dish_${dishIndex+1}`;refMap.set(dishRef,dish.id);
      return {dishRef,role:dish.role,position:dish.position,name:dish.name,
        description:dish.description,cookingTimeMinutes:dish.cookingTimeMinutes,
        ingredients:dish.ingredients.toSorted((left,right)=>left.position-right.position)
          .map((item,itemIndex)=>{const ingredientRef=`ingredient_${dishIndex*50+itemIndex+1}`;
            refMap.set(ingredientRef,item.id);return {ingredientRef,position:item.position,
              name:item.name,quantityValue:item.quantityValue,quantityText:item.quantityText,
              unit:item.unit,storeSection:item.storeSection,pantryRef:null,
              labelConfirmationRequired:item.labelConfirmationRequired};}),
        steps:dish.steps.toSorted((left,right)=>left.position-right.position)
          .map((step,stepIndex)=>{const stepRef=`step_${dishIndex*30+stepIndex+1}`;
            refMap.set(stepRef,step.id);return {stepRef,position:step.position,
              instruction:step.instruction};})};
    });
  const replaceIndex=replaceDishId===null?-1:ordered.findIndex((dish)=>dish.id===replaceDishId);
  const replaceTarget=replaceIndex<0?null:all[replaceIndex]??null;
  const dto=all.filter((_,index)=>index!==replaceIndex);
  return {dto,replaceTarget,refMap};
}
type LoaderDeps={
  loadSource(user:AuthenticatedUser,menuId:string):Promise<StoredMenuAggregate>;
  loadGroup(user:AuthenticatedUser,groupId:string):Promise<readonly StoredMenuAggregate[]>;
  loadRecent(user:AuthenticatedUser,limit:number):Promise<readonly StoredMenuAggregate[]>;
  buildCurrentContext(input:{user:AuthenticatedUser;stored:StoredMenuAggregate;
    idempotencyKey:string;expiredPantryConfirmations:RegenerationCommand["request"]["expiredPantryConfirmations"];
    now:Date}):Promise<GenerationContext>;
  requestStartedAtMonotonicMs:number;
  now():Date;monotonicNow():number;
};

export async function loadRegenerationExecutionContext(
  deps:LoaderDeps,user:AuthenticatedUser,command:RegenerationCommand,
  requestId:string,deadlineAtMonotonicMs:number,
):Promise<GenerationExecutionContext>{
  const source=await deps.loadSource(user,command.request.sourceMenuId); // owner query first
  if(source.targetMemberIds.length===0){
    throw new HttpError(422,"current_target_member_required",
      "現在の家族を1人以上選んでください");
  }
  const replaceDishId=command.kind==="regenerate_dish"?command.request.dishId:null;
  if(replaceDishId!==null&&!source.menu.dishes.some((dish)=>dish.id===replaceDishId)){
    throw new HttpError(404,"replace_dish_not_found","変更する料理が見つかりません");
  }
  const [group,recent,generationContext]=await Promise.all([
    deps.loadGroup(user,source.derivationGroupId),deps.loadRecent(user,20),
    deps.buildCurrentContext({user,stored:source,idempotencyKey:command.request.idempotencyKey,
      expiredPantryConfirmations:command.request.expiredPantryConfirmations,now:deps.now()}),
  ]);
  const validation=validateGeneratedMenu(
    toStoredRevalidationCandidate(source.menu,generationContext),generationContext,
  );
  if(!validation.ok)throw new HttpError(422,"current_safety_revalidation_required",
    "現在の家族設定ではこの献立を利用できません");
  const versions=new Map([...group,...recent].map((item)=>[item.menu.menuId,item]));
  const existingDerivationMenus=[...versions.values()].map((item)=>({
    menuId:item.menu.menuId,
    menuSignature:createMenuSignature({dishes:item.menu.dishes.map(dishSignatureInput)}),
    dishSignatures:item.menu.dishes.map((dish)=>createDishSignature(dishSignatureInput(dish))),
  }));
  const retained=toRetainedDishPrompt(source.menu,replaceDishId);
  const promptDto=command.kind==="regenerate_dish"
    ?buildDishRegenerationPrompt({command,source,generationContext,retained})
    :null;
  const regenerationBase={
    sourceMenuId:source.menu.menuId,sourceMenu:source.menu,
    derivationGroupId:source.derivationGroupId,
    retainedDishIds:source.menu.dishes.filter((dish)=>dish.id!==replaceDishId).map((dish)=>dish.id),
    excludedDishIds:[...versions.values()].flatMap((item)=>item.menu.dishes.map((dish)=>dish.id)),
    sourceSafetyFingerprint:source.safetyFingerprint,
    sourcePreferenceSnapshot:preferenceSnapshotSchema.parse(source.preferenceSnapshot),
    existingDerivationMenus,artifacts:{retainedDishes:retained.dto,
      sourceDishToReplace:retained.replaceTarget,promptDto,retainedRefMap:retained.refMap},
  };
  const executionBase={requestId,generationContext,
    expectedSafetyFingerprint:createCurrentSafetyFingerprint(generationContext.safety),
    startedAtMonotonicMs:deps.requestStartedAtMonotonicMs,deadlineAtMonotonicMs};
  if(command.kind==="regenerate_menu")return {...executionBase,kind:command.kind,command,
    regeneration:{...regenerationBase,replaceDishId:null}};
  return {...executionBase,kind:command.kind,command,
    regeneration:{...regenerationBase,replaceDishId:command.request.dishId}};
}
```

Plan 3's canonical `RegenerationExecutionPayload` deliberately owns only `artifacts: unknown` for future Plan 4 data, avoiding a backwards type dependency. Plan 4 defines one non-exported `RegenerationArtifacts` with exact fields `retainedDishes: readonly RetainedDishPrompt[]`, `sourceDishToReplace: RetainedDishPrompt | null`, `promptDto: DishRegenerationPrompt | null`, and `retainedRefMap: ReadonlyMap<string,string>`, plus `requireRegenerationArtifacts(value:unknown)`. The guard parses the three serializable fields with Task 2's Zod schemas, requires a real read-only map whose keys/values match the prompt ref registry, and returns the closed type. Every prompt/materialization access calls the guard first; malformed/missing artifacts fail before OpenRouter or persistence. This is a narrowing view of Plan 3's execution union, not a second command/context union or declaration merge. The map is server-only and never serialized; whole regeneration uses null for the dish-only fields. `regeneration-prompt.test.ts` recursively rejects UUIDs and proves every retained ingredient and step text is present. Adaptations, safety actions, source timeline, pantry use, and label source text are converted through the same ref registry into `sourceTimeline`, `sourceAdaptations`, `sourcePantryUsage`, and `sourceLabelConfirmations` fields of the strict `dishRegenerationPromptSchema`; these fields are complete, not summaries, and none contains prior confirmation provenance.

`regeneration-adapter.ts` implements all three menu loads with the same JWT-scoped client and explicit `.eq("user_id",user.userId)` filters. Only `buildCurrentContext`, after `loadSource` proves ownership and at least one non-null current target link survives, uses admin access for `loadCurrentSafetyContext`; it delegates pantry/preferences to Task 3's owner-scoped `buildStoredGenerationContext`. If every historical target member was deleted, regeneration fails before current-context construction or `markSent` with `current_target_member_required`; the immutable snapshot remains display-only. Tests prove a foreign source returns 404 before any admin call and that no stable menu/dish/member UUID enters the prompt DTO.

- [ ] **Step 4: Add handlers and generation-service duplicate gating**

```ts
export default async (request: Request): Promise<Response> => {
  const requestStartedAtMonotonicMs=performance.now();
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const body = await parseJson(request, regenerateDishRequestSchema);
    const result = await runGeneration(createGenerationDeps(user,{requestStartedAtMonotonicMs}), {
      kind: "regenerate_dish",
      request: body,
    });
    return generationResponse(result);
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/generations/dish" };
```

Import `GenerationCommand`, `GenerationExecutionContext`, and `GenerationDependencies` from Plan 3's canonical generation modules. Do not redeclare or augment either union in Plan 4. Replace only Plan 3's temporary `regeneration_not_implemented` branches in `createGenerationDeps(user,timing).loadExecutionContext`; the `new_menu` branch, original request-entry timing, and every other dependency stay unchanged.

```ts
export function createGenerationDeps(
  user:AuthenticatedUser,timing:{requestStartedAtMonotonicMs:number},
):GenerationDependencies{
  const base=createBaseGenerationDeps(user,timing);
  return {...base,loadExecutionContext:async(command,requestId,deadlineAtMonotonicMs)=>{
    if(command.kind==="new_menu"){
      return base.loadExecutionContext(command,requestId,deadlineAtMonotonicMs);
    }
    return loadRegenerationExecutionContext(
      createRegenerationLoaderDeps(user,{
        requestStartedAtMonotonicMs:timing.requestStartedAtMonotonicMs,
      }),user,command,requestId,deadlineAtMonotonicMs,
    );
  }};
}
```

Rename Plan 3's existing factory implementation to private `createBaseGenerationDeps`; its returned object and `new_menu` loader remain byte-for-byte unchanged. The exported `createGenerationDeps` above is the only wrapper and replaces only the two deliberate regeneration stubs. `createRegenerationLoaderDeps(user,timing)` requires the same timing object and copies `requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs` into `LoaderDeps`; it never calls `performance.now()` to synthesize a second start. A type test constructs the exact `LoaderDeps`, and the handler/factory test asserts the loader's `startedAtMonotonicMs` equals the handler-entry timestamp.

`loadRegenerationExecutionContext` uses `loadStoredMenu(createUserScopedSupabase(user.accessToken),user.userId,sourceMenuId)` for source, group, and recent versions; only after the source owner query succeeds and `stored.targetMemberIds` contains at least one surviving live member does its current-context dependency call `loadCurrentSafetyContext(admin,user.userId,stored.targetMemberIds)`. It parses `stored.preferenceSnapshot` with this closed schema, combines it with only those owner-proven live member IDs, reloads referenced pantry/preference rows with the same user-scoped client, performs the current JST expiry check against the command key, and creates the canonical `generationContext`:

```ts
const savedPreferenceSchema = plannerSubmissionSchema.omit({ targetMemberIds: true }).strict();
const submission = plannerSubmissionSchema.parse({
  ...savedPreferenceSchema.parse(stored.preferenceSnapshot),
  targetMemberIds: stored.targetMemberIds,
});
```

Never copy `safety_snapshot`, a deleted member's snapshot/link, member UUIDs, stale label decisions, or old expiry confirmations into validator input. `regeneration-context.test.ts` proves that a foreign source is 404 before any admin query, a deleted target is filtered, zero surviving targets fail before send, current member rows and current catalog versions win, retained dishes are still revalidated, and a current invalid result fails before `markSent`.

Extend `buildGenerationMessages` without creating another prompt client:

```ts
export function buildGenerationMessages(context: GenerationExecutionContext): readonly OpenRouterMessage[] {
  const base = buildBaseGenerationMessages(context.generationContext);
  if (context.kind === "new_menu") return base;
  const artifacts=requireRegenerationArtifacts(context.regeneration.artifacts);
  const regeneration = context.kind === "regenerate_dish"
    ? dishRegenerationPromptSchema.parse(artifacts.promptDto)
    : wholeRegenerationPromptSchema.parse({mode:"whole",
        reason:context.command.request.changeReason,
        changeReasonCustom:context.command.request.changeReasonCustom,
        excludedDishSignatures:context.regeneration.existingDerivationMenus
          .flatMap((menu)=>menu.dishSignatures)});
  return [...base, { role: "user", content:
    `<regeneration_constraints>\n${JSON.stringify(regeneration)}\n</regeneration_constraints>` }];
}
```

Rename Plan 3's original body to private `buildBaseGenerationMessages(context: GenerationContext)` in the same file. `loadRegenerationExecutionContext` builds `promptDto` once from the full stored source aggregate and a request-local registry: all retained dishes and the target dish contain full ingredient/step text; `sourceTimeline`, `sourceAdaptations` including structured safety actions, `sourcePantryUsage`, and `sourceLabelConfirmations` contain only local refs; saved `confirmedAt/confirmedBy/status` are omitted. `regeneration-prompt.test.ts` recursively asserts the reason, custom text, every retained text leaf, target dish, source cross-menu sections, and exclusion set are present while UUIDs, user/member IDs, email, saved safety snapshot, and free-form household names are absent.

Extend Plan 3's one OpenRouter adapter with a response-schema discriminator rather than adding a second client:

```ts
type GenerationWireRequest =
  | {mode:"full_menu";messages:readonly OpenRouterMessage[]}
  | {mode:"replacement_dish";messages:readonly OpenRouterMessage[]};
type GenerationWireResult =
  | {mode:"full_menu";output:AiGenerationResponse;modelId:string}
  | {mode:"replacement_dish";output:DishRegenerationAiOutput;modelId:string};
```

`sendMenuGeneration` selects Plan 3's full-menu response format for `full_menu` and `dishRegenerationAiOutputSchema`'s JSON Schema for `replacement_dish`; both modes retain the same model allowlist, 20-second attempt timeout, actual-model capture, repair eligibility, and attempt/global accounting. Tests reject a full-menu body in replacement mode, a replacement body in full-menu mode, a UUID at any local-ref leaf, an unknown ref, and an incomplete timeline/adaptation/pantry/label section.

Before validation, `composeCandidate` branches on the top-level `AiGenerationResponse`: `constraint_conflict` is returned without materialization; a `success.menu` payload for both new and whole regeneration is passed through Plan 3's `materializeAiGeneratedMenu(success.menu,context.generationContext,deps.randomUUID)`. It never returns provider output unchanged. For dish regeneration, `materializeDishRegenerationCandidate(context,output,deps.randomUUID)` performs this deterministic order:

1. Parse `DishRegenerationAiOutput`; require exactly one replacement dish with the same role and position as `sourceDishToReplace`.
2. Preserve every non-target dish's user-visible recipe fields byte-for-byte, but allocate a fresh menu ID and fresh IDs for every retained and replacement dish, ingredient, recipe step, timeline step, adaptation, pantry selection, safety action identity, and label-confirmation identity. Keep only current live pantry/member references where the schema deliberately points outside the immutable menu aggregate.
3. Build a complete old/local-ref to fresh-ID registry, then resolve every timeline, adaptation, safety-action, pantry, and label source ref through it. Reject unknown refs, refs to the removed target, duplicate refs, missing retained-dish coverage, a reused source aggregate ID, or a member/pantry ref outside the current `GenerationContext`.
4. Build the full generated aggregate using source meal/genre/servings/schema metadata, the retained recipe content plus replacement, the complete freshly remapped cross-menu sections, and `totalElapsedMinutes = max(startMinute + durationMinutes)`. Convert all label candidates to generated `pending`; do not copy stored confirmation status, provenance, or database identity.
5. Parse with `generatedMenuSchema`, then call the single `validateGeneratedMenu(fullCandidate,currentContext)`. Only `checked.menu` from that validator may reach persistence.

`generation-service.test.ts` first persists a three-dish source aggregate, then materializes and persists a one-dish regeneration beside it. It proves retained user-visible recipe bytes survive, the candidate shares no aggregate-owned UUID with the source, every retained/replacement cross-ref resolves to a fresh row, both versions coexist without a primary-key collision, canonical safety actions remain member/dish/step bound, stored confirmed labels become newly derived pending rows, and `repository.succeed` receives exactly one full validated aggregate. The handler/factory test also proves both generation endpoints capture one entry timestamp before method/auth/body work and pass it unchanged through the two-argument factory into the 50-second deadline. This removes the former contradictory “one returned dish” plus “AI returns a full menu” contract.

In `runGeneration`, reserve with the complete command, load the canonical execution context, build the prompt, compose the full candidate, then validate. Convert candidates with the same `createMenuSignature`/`createDishSignature` helpers used by `existingDerivationMenus`: whole regeneration rejects a matching menu signature; dish regeneration rejects a replacement matching any stored dish signature. Route a duplicate through Plan 3's existing single repair helper. If the repaired candidate is also duplicate, call the existing `repository.fail(requestId,"duplicate_output",null)`; never call `repository.succeed` and never consume user success. Both sends remain in external-attempt and global-call accounting.

The only persistence call remains Plan 3's `repository.succeed({requestId,menu:checked.menu,command,...})`. Migration `020` already calls `private.assign_regeneration_lineage(user,source,completed,reason,custom)` inside `finalize_ai_generation_success`; migration `030` above replaces that exact no-op stub with the lineage body and does not rewrite an applied migration or duplicate the public finalizer. The hook returns for Plan 3's all-null new-menu arguments. For regeneration, only the completed menu stores `change_reason`/`change_reason_custom`; `private.ai_generation_requests`, terminal details, and logs retain only the versioned command HMAC and non-text execution metadata. pgTAP calls the real finalizer and proves hook failure rolls back the just-inserted aggregate, quota/request transition, and lineage together; concurrent versions remain serialized. Tests assert `repository.succeed` receives current `safetySnapshot`, saved preference snapshot, current label confirmations, command, and the composed full menu exactly once, and that no Plan 4 code inserts `menus` directly.

The already-canonical `GenerationRepository.reserve(command)` replaces only its two regeneration stubs and calls Plan 3's same `reserve_ai_generation` command path for all three variants. There is no `reserve_ai_regeneration` RPC and no Plan 4-local hash. Plan 3's server-secret, versioned command HMAC covers `kind`, `sourceMenuId`, `dishId ?? null`, `changeReason`, `changeReasonCustom`, and the sorted newly collected expiry confirmations; it is compared before replay or quota/state work. The same transaction persists only the approved lineage columns plus that non-reversible HMAC and reserves success, user daily attempt, short-window, and global state—never the custom reason in a generic ledger JSON or raw command body. Existing `markSent` and `reserveRepairAttempt` are reused unchanged. Tests run new/whole/dish commands through one mocked RPC, assert identical replay, reject any changed source/dish/reason/expiry payload before another reservation, and prove the 12/day and 4/600-second limits also stop regeneration.

- [ ] **Step 5: Run focused server tests**

Run: `docker compose run --rm --no-deps app sh -lc 'npm test -- --run shared/contracts/regeneration.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-prompt.test.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/generate-menu.test.ts netlify/functions/generate-dish.test.ts && npm run typecheck'`

Expected: current-safety, canonical execution payload, full retained prompt DTO, local-ref replacement output, deterministic full-candidate materialization, exclusion signatures, whole/dish request, duplicate repair, and non-consumption cases pass. A source search finds no Plan 4-local command/execution-union declaration, `reserve_ai_regeneration`, stored-menu direct generated-validator call, stable UUID in a prompt, or alternate request field.

- [ ] **Step 6: Commit regeneration services**

```bash
git add netlify/functions/_shared/regeneration-context.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-adapter.ts netlify/functions/_shared/regeneration-prompt.test.ts netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/openrouter.ts netlify/functions/_shared/openrouter.test.ts netlify/functions/_shared/generation-repository.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/generate-menu.ts netlify/functions/generate-menu.test.ts netlify/functions/generate-dish.ts netlify/functions/generate-dish.test.ts
git commit -m "feat: regenerate menu versions safely"
```

### Task 5: Build grouped history, favorites, and version selection

**Files:**
- Create: `src/features/history/api/history-api.ts`
- Create: `src/features/history/model/group-history.ts`
- Create: `src/features/history/model/group-history.test.ts`
- Create: `src/features/history/hooks/use-history.ts`
- Create: `src/features/history/components/history-card.tsx`
- Create: `src/features/history/pages/history-page.tsx`
- Create: `src/features/history/pages/history-page.test.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: generated database types, current session, menu result route, `accept_menu_version`, and `delete_menu_group` RPCs.
- Produces: `/history`, `useHistoryGroups()`, `useToggleFavorite()`, `useAcceptMenuVersion()`, and confirmed group deletion.

- [ ] **Step 1: Write the failing grouped-history component test**

```tsx
it("renders one card per derivation group and prefers the selected version", async () => {
  renderHistoryPage({
    groups: [{
      derivationGroupId: "group-1",
      versionCount: 3,
      representative: { id: "menu-2", title: "採用した献立", selectedAt: "2026-07-11T10:00:00Z", isFavorite: true },
    }],
  });
  expect(await screen.findByText("採用した献立")).toBeVisible();
  expect(screen.getByText("3案")).toBeVisible();
  expect(screen.getByText("利用前に現在の家族設定で確認します")).toBeVisible();
  expect(screen.queryByText("menu-1")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify the route/component failure**

Run: `docker compose run --rm --no-deps app npm test -- --run src/features/history/pages/history-page.test.tsx`

Expected: FAIL because the history feature does not exist.

- [ ] **Step 3: Implement API grouping and mutations**

```ts
export type HistoryGroup = {
  derivationGroupId: string;
  versionCount: number;
  representative: { id: string; title: string; createdAt: string; selectedAt: string | null; isFavorite: boolean };
};

export type HistoryMenuRow = {
  id: string;
  derivation_group_id: string;
  version: number;
  created_at: string;
  is_selected: boolean;
  selected_at: string | null;
  is_favorite: boolean;
  dishes: Array<{ name: string; position: number }>;
};

export function groupMenuRows(rows: readonly HistoryMenuRow[]): HistoryGroup[] {
  const grouped = new Map<string, HistoryMenuRow[]>();
  for (const row of rows) grouped.set(row.derivation_group_id, [...(grouped.get(row.derivation_group_id) ?? []), row]);
  return [...grouped.entries()].map(([derivationGroupId, versions]) => {
    const newestFirst = versions.toSorted((left, right) => right.version - left.version);
    const chosen = newestFirst.find((row) => row.is_selected) ?? newestFirst[0];
    const title = chosen.dishes.toSorted((left, right) => left.position - right.position).map((dish) => dish.name).join("・");
    return {
      derivationGroupId,
      versionCount: versions.length,
      representative: {
        id: chosen.id,
        title,
        createdAt: chosen.created_at,
        selectedAt: chosen.selected_at,
        isFavorite: chosen.is_favorite,
      },
    };
  }).toSorted((left, right) => right.representative.createdAt.localeCompare(left.representative.createdAt));
}

export async function listHistoryGroups(): Promise<HistoryGroup[]> {
  const { data, error } = await supabase
    .from("menus")
    .select("id,derivation_group_id,version,created_at,is_selected,selected_at,is_favorite,dishes(name,position)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return groupMenuRows(data);
}

export async function acceptMenuVersion(menuId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_menu_version", { p_menu_id: menuId });
  if (error) throw error;
}

export async function deleteMenuGroup(derivationGroupId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_menu_group", { p_derivation_group_id: derivationGroupId });
  if (error) throw error;
}
```

- [ ] **Step 4: Implement the page and route**

```tsx
export function HistoryPage() {
  const { data = [], isPending } = useHistoryGroups();
  if (isPending) return <main className="page-frame"><p role="status">履歴を読み込んでいます</p></main>;
  if (data.length === 0) return (
    <main className="page-frame stack">
      <h1>履歴・お気に入り</h1><p>まだ献立がありません</p>
      <Link className="min-h-11 inline-flex items-center" to="/planner">献立を作る</Link>
    </main>
  );
  return (
    <main className="page-frame stack">
      <h1>履歴・お気に入り</h1>
      <ul className="grid gap-4">
        {data.map((group) => <HistoryCard key={group.derivationGroupId} group={group} />)}
      </ul>
    </main>
  );
}
```

Import `Link` from `react-router`. `HistoryCard` uses native `<article>`, `<Link>`, and `<button className="min-h-11">` only; no undefined design-system primitive is introduced. It always shows “開くと現在の家族設定で再確認します”, provides a 44-pixel favorite control, and opens a native `<dialog>` destructive confirmation before calling `deleteMenuGroup`; deletion failure leaves the card and offers retry. Its test imports and renders the real component rather than an undefined `renderHistoryPage` helper; define a local `renderHistoryPage(props)` wrapper in the test file if dependency injection is needed.

- [ ] **Step 5: Run component tests and typecheck**

Run: `docker compose run --rm --no-deps app sh -lc 'npm test -- --run src/features/history && npm run typecheck'`

Expected: grouped, selected, favorite, confirmed delete, empty, loading, and current-safety-reminder states pass.

- [ ] **Step 6: Commit history UI**

```bash
git add src/features/history src/app/router.tsx
git commit -m "feat: add grouped menu history"
```

### Task 6: Add regeneration controls and safety-gated history detail

**Files:**
- Create: `src/features/history/pages/history-detail-page.tsx`
- Create: `src/features/history/pages/history-detail-page.test.tsx`
- Create: `src/features/history/components/regeneration-sheet.tsx`
- Create: `src/features/history/components/regeneration-sheet.test.tsx`
- Create: `src/features/history/hooks/use-menu-revalidation.ts`
- Create: `src/features/history/hooks/use-menu-revalidation.test.tsx`
- Create: `src/features/history/api/revalidation-api.ts`
- Create: `src/features/history/api/revalidation-api.test.ts`
- Create: `src/features/history/hooks/use-regeneration.ts`
- Create: `src/features/history/hooks/use-regeneration.test.tsx`
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `src/features/generation/components/menu-result.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`
- Modify: `netlify/functions/confirm-label-confirmation.ts`
- Modify: `netlify/functions/confirm-label-confirmation.test.ts`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: revalidation endpoint, Plan 1's exact household-safety event/revision exports, Plan 3's three-kind pending-command/status recovery contract, and regeneration schemas from Task 2.
- Produces: one safety-gating `useMenuRevalidation(menuId)` shared by `/menus/:menuId` and `/history/:menuId`, whole/dish regeneration actions, interruption-safe three-kind browser recovery, and “これに決めた”.

- [ ] **Step 1: Write failing safety-gate and copy tests**

```tsx
function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
const validRevalidation: RevalidationResult = {
  status: "valid", safetyFingerprint: "current", allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2", issues: [], changedDetails: [], currentLabelWarnings: [],
};

it("revalidates on mount and blocks actions while current safety is loading", async () => {
  const revalidate = deferredPromise<RevalidationResult>();
  renderHistoryDetail({ revalidate: vi.fn(() => revalidate.promise) });
  expect(await screen.findByRole("status")).toHaveTextContent("現在の家族設定で確認しています");
  expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();
  revalidate.resolve(validRevalidation);
  expect(await screen.findByText("現在の家族設定で確認しました")).toBeVisible();
});

it("allows regeneration after a changed but valid current-safety result", async () => {
  renderHistoryDetail({ revalidation: { phase: "checked", result: { status: "changed", issues: [], changedDetails:["preference_changed"] } } });
  expect(screen.getByText("現在の家族設定で確認しました。作成時から条件が変わっています")).toBeVisible();
  expect(screen.getByRole("button", { name: "献立をまるごと別案にする" })).toBeEnabled();
});

it("explains conditional quota use before regeneration", async () => {
  renderRegenerationSheet();
  expect(screen.getByText("別の献立が完成した場合に1回使用・現在残り3回")).toBeVisible();
});

it("hides an already open result immediately when safety changes in another tab",async()=>{
  const revalidate=deferredPromise<RevalidationResult>();
  renderMenuResultPage({initialRevalidation:validRevalidation,nextRevalidation:revalidate.promise});
  expect(await screen.findByRole("heading",{name:/献立/u})).toBeVisible();
  dispatchHouseholdSafetyStorageEvent();
  expect(screen.getByRole("status")).toHaveTextContent("現在の家族設定で確認しています");
  expect(screen.queryByRole("heading",{name:"材料"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"冷蔵庫へ反映"})).toBeDisabled();
});

it.each(["focus","visible-visibilitychange","online","realtime-household-member","realtime-member-allergy","sixty-second-poll"] as const)(
  "fails closed and starts a fresh current-safety check for %s",async(signal)=>{
    const revalidate=deferredPromise<RevalidationResult>();
    renderMenuResultPage({initialRevalidation:validRevalidation,nextRevalidation:revalidate.promise});
    fireSafetySignal(signal);
    expect(screen.getByRole("status")).toHaveTextContent("現在の家族設定で確認しています");
    expect(screen.getByRole("button",{name:"冷蔵庫へ反映"})).toBeDisabled();
    revalidate.resolve(validRevalidation);
    expect(await screen.findByRole("button",{name:"冷蔵庫へ反映"})).toBeEnabled();
  },
);

// test専用helper。DOM eventのdispatch、mock Realtime callbackの呼出し、または
// 注入clockの60_000 msまでの進行を行う。productionにglobal helperは置かない。
function fireSafetySignal(signal:string):void { /* test fixture dispatches the selected signal */ }

it.each(["regenerate_menu","regenerate_dish"] as const)(
  "recovers %s with the exact endpoint, body, and key after response loss",
  async(kind)=>{await expectRegenerationRecovery({kind,firstResponse:"lost",
    serverStatus:"not_started",reopenTab:true,sameBody:true,sameIdempotencyKey:true});},
);
```

`history-detail-page.test.tsx` locally defines `renderHistoryDetail` and `renderMenuResultPage` with a real `QueryClientProvider`; `dispatchHouseholdSafetyStorageEvent` dispatches Plan 1's exported revision key; `expectRegenerationRecovery` uses the real pending schema, API selector, reducer, and hook with only fetch/storage/clock injected. None is a production or undeclared global helper.

- [ ] **Step 2: Run and verify both tests fail**

Run: `docker compose run --rm --no-deps app npm test -- --run src/features/history/pages/history-detail-page.test.tsx src/features/history/components/regeneration-sheet.test.tsx`

Expected: FAIL because detail and regeneration controls are absent.

- [ ] **Step 3: Implement the required-reason sheet**

```tsx
const reasons = [
  ["simpler", "もっと簡単に"],
  ["different_ingredient", "別の食材で"],
  ["child_friendly", "子どもが食べやすく"],
  ["different_flavor", "別の味に"],
  ["custom", "その他"],
] as const;

const regenerationReasonSchema = z.object({
  changeReason: z.enum(changeReasons),
  changeReasonCustom: z.string().trim().min(1).max(200).nullable().default(null),
}).superRefine((value, context) => {
  if (value.changeReason === "custom" && !value.changeReasonCustom) {
    context.addIssue({ code: "custom", path: ["changeReasonCustom"], message: "内容を入力してください" });
  }
  if (value.changeReason !== "custom" && value.changeReasonCustom !== null) {
    context.addIssue({ code: "custom", path: ["changeReasonCustom"], message: "その他を選んだ場合だけ入力できます" });
  }
});

type RegenerationReasonInput = z.infer<typeof regenerationReasonSchema>;
type RegenerationSheetProps = {
  remaining: number;
  onSubmit: (value: RegenerationReasonInput) => Promise<void>;
};

export function RegenerationSheet({ remaining, onSubmit }: RegenerationSheetProps) {
  const form = useForm<RegenerationReasonInput>({ resolver: zodResolver(regenerationReasonSchema) });
  const selectedReason = form.watch("changeReason");
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <fieldset><legend>どのように変えますか？</legend>
        {reasons.map(([value, label]) => (
          <label key={value} className="min-h-11 flex items-center gap-3">
            <input type="radio" value={value} {...form.register("changeReason")} />{label}
          </label>
        ))}
      </fieldset>
      {selectedReason === "custom" ? (
        <label className="mt-4 block">
          どのように変えたいですか？
          <textarea className="mt-2 min-h-24 w-full rounded-xl border p-3" {...form.register("changeReasonCustom")} />
          <span role="alert">{form.formState.errors.changeReasonCustom?.message}</span>
        </label>
      ) : null}
      <p>別の献立が完成した場合に1回使用・現在残り{remaining}回</p>
      <button className="min-h-11 rounded-xl bg-slate-900 px-4 text-white"
        type="submit" disabled={form.formState.isSubmitting}>別案を作る</button>
    </form>
  );
}
```

- [ ] **Step 4: Wire mount-time current-safety revalidation and both mutation modes**

Implement a hook with no manual-success escape hatch:

```ts
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrowserSupabaseClient } from "../../../shared/lib/supabase";
import { householdSafetyChangedEvent, householdSafetyRevisionStorageKey } from "../household/household-queries";

export type RevalidationPhase =
  | { phase: "checking" }
  | { phase: "checked"; result: RevalidationResult }
  | { phase: "error"; message: string };

export function useMenuRevalidation(menuId: string) {
  const cache=useQueryClient();
  const [forcedChecking,setForcedChecking]=useState(false);
  const query=useQuery({
    queryKey: ["menu-revalidation", menuId],
    queryFn: async () => {const result=await revalidateMenu(menuId);setForcedChecking(false);return result;},
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  useEffect(()=>{
    const changed=()=>{setForcedChecking(true);
      void cache.invalidateQueries({queryKey:["menu-revalidation",menuId],exact:true,refetchType:"active"});};
    const stored=(event:StorageEvent)=>{
      if(event.key===householdSafetyRevisionStorageKey)changed();
    };
    const onFocus=()=>{if(document.visibilityState==="visible")changed();};
    const onOnline=()=>changed();
    const onOffline=()=>{setForcedChecking(true);};
    // 認証済みRealtime channelはRLSでこのuserに限定し、browserからowner IDを直接送らない。
    const channel=getBrowserSupabaseClient().channel(`menu-safety:${menuId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"household_members"},changed)
      .on("postgres_changes",{event:"*",schema:"public",table:"member_allergies"},changed)
      .subscribe();
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine)changed();},60_000);
    window.addEventListener(householdSafetyChangedEvent,changed);
    window.addEventListener("storage",stored);window.addEventListener("focus",onFocus);
    window.addEventListener("online",onOnline);window.addEventListener("offline",onOffline);document.addEventListener("visibilitychange",onFocus);
    return()=>{window.removeEventListener(householdSafetyChangedEvent,changed);
      window.removeEventListener("storage",stored);window.removeEventListener("focus",onFocus);
      window.removeEventListener("online",onOnline);window.removeEventListener("offline",onOffline);document.removeEventListener("visibilitychange",onFocus);
      window.clearInterval(timer);void channel.unsubscribe();};
  },[cache,menuId]);
  const phase:RevalidationPhase["phase"] = forcedChecking||query.isPending
    ? "checking" : query.isError ? "error" : "checked";
  return {...query,phase};
}
```

Create `revalidation-api.ts` as the sole browser boundary. It gets Plan 1's current access token, POSTs `/api/menus/:menuId/revalidate`, parses the standard envelope with a strict Zod `revalidationResultSchema` including bounded `currentLabelWarnings` and the closed `changedDetails` codes, and throws closed typed errors; its tests cover auth, invalid envelope, unknown fields, pantry/preference drift as non-blocking `changed`, and all status variants. The hook imports this exact `revalidateMenu`—no undeclared helper or direct Supabase call.

Import `householdSafetyChangedEvent` and `householdSafetyRevisionStorageKey` from Plan 1's sole owner; do not copy either string. The hook must enter a visible checking state in the same event turn, then issue a fresh POST. Both the ordinary generated-result route and history-detail route call this exact hook. While pending, `/menus/:menuId` does not render stale ingredients, recipe steps, timeline, adaptations, label-confirmation controls, pantry actions, regeneration, accept, or shopping actions; it renders `role="status"` with “現在の家族設定で確認しています”. Both pages enable recipe/action content only for `valid`, or `changed` with zero issues. When open, `MenuResult` receives `result.currentLabelWarnings` from this just-completed gate as its sole actionable/current warning list; it must not render Plan 3's stored list as current authority. Every warning has a current canonical `confirmationId`, and its `sourceText` is the reconciliation RPC's returned `source_text_snapshot`, never a dynamic aggregate-text lookup. Pending rows render `本人が商品の原材料表示を確認しました`; the POST body includes `expectedSafetyFingerprint: result.safetyFingerprint`, and the Function invokes only Plan 3's existing three-argument RPC. Success invalidates both result and revalidation queries. A stale fingerprint/archived row returns the same closed conflict/not-found response, immediately recloses the gate, and cannot confirm an old warning. The generic disclaimer remains visible. Tests add an allergy after menu creation and prove the new saved human source/allergen/member warning and confirmation action are visible before recipe actions enable, while the obsolete old-only warning is absent and its old direct POST fails. They also prove a warning renders the RPC-returned snapshot when reconstructed candidate text differs. `invalid` lists current issue messages and keeps content/actions closed. Network failure keeps them closed and shows a “もう一度確認” button that calls `refetch`; there is no manual-success escape hatch. Every mount refetches, and same-tab custom events plus other-tab storage events invalidate active queries, so a prior browser cache cannot authorize use after household changes.

`useRegeneration()` creates a Plan 3 `PendingGeneration` discriminated variant and persists its new idempotency key plus complete canonical request body before POST. `regenerate_menu` derives `/api/generations/menu`; `regenerate_dish` derives `/api/generations/dish`; the endpoint is never stored or accepted independently from `kind`. The persisted request includes `sourceMenuId`, `changeReason`, nullable `changeReasonCustom`, newly collected `expiredPantryConfirmations`, and `dishId` only for dish regeneration. Plan 3's updated controller parses all three variants, posts by kind, and on initial response loss, `not_started`, reload, online, visibility, or auth return reuses the exact saved body and key; `processing` only polls the common status endpoint. Consent is checked from current server state, so no parallel client-supplied consent-version field is added. Expiry confirmations from the source menu are never copied forward. The hook refuses to build a command unless the current mount's revalidation query is successful.

- [ ] **Step 5: Run feature tests and accessibility assertions**

Run: `docker compose run --rm --no-deps app sh -lc 'npm test -- --run src/features/history src/features/generation/model/pending-generation.test.ts src/features/generation/api/generation-api.test.ts src/features/generation/hooks/use-generation-recovery.test.tsx src/features/generation/pages/menu-result-page.test.tsx && npm run typecheck'`

Expected: mount/same-tab/other-tab current-safety blocking on both result routes, valid revalidation, required reason, custom reason, quota copy, whole/dish exact endpoint and byte-identical response-loss recovery, favorite, and accept-version cases pass.

- [ ] **Step 6: Commit history detail and regeneration UI**

```bash
git add src/features/history src/features/generation/pages/menu-result-page.tsx \
  src/features/generation/pages/menu-result-page.test.tsx \
  src/features/generation/components/menu-result.tsx \
  src/features/generation/components/menu-result.test.tsx \
  netlify/functions/confirm-label-confirmation.ts \
  netlify/functions/confirm-label-confirmation.test.ts src/app/router.tsx
git commit -m "feat: add safe regeneration controls"
```

### Task 7: Verify complete history and regeneration journeys

**Files:**
- Create: `e2e/fixtures/local-supabase.ts`
- Create: `e2e/fixtures/history.ts`
- Create: `e2e/specs/history-regeneration.spec.ts`
- Create: `e2e/specs/history-safety-change.spec.ts`
- Modify: `tools/openrouter-mock/fixtures/duplicate-menu.json`
- Modify: `netlify/functions/generate-menu.ts`
- Modify: `netlify/functions/generate-dish.ts`

**Interfaces:**
- Consumes: all outputs from Tasks 1–6.
- Produces: fully defined `historyPage`, `seedGeneratedMenu`, `setMockScenario`, `readRemainingQuota`, `requestWholeRegeneration`, `changeFirstMemberSafety`, and a release gate for the History and Regeneration increment. The scenario request header is honored only when `OPENROUTER_BASE_URL` is exactly the Compose mock URL.

- [ ] **Step 1: Create the local authenticated fixtures before any journey imports them**

Create `e2e/fixtures/local-supabase.ts`:

```ts
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { ownedAuthStoragePrefixes } from "../../src/features/auth/auth-flow";

export async function readLocalPublishableKey(): Promise<string> {
  const value = /^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/mu
    .exec(await readFile(".env", "utf8"))?.[1]?.trim();
  return z.string().min(20).parse(value);
}
export async function accessTokenFromPage(page: Page): Promise<string> {
  const storageKey=ownedAuthStoragePrefixes.find((prefix)=>prefix==="kondate.auth.supabase");
  if(storageKey===undefined)throw new Error("Supabase auth storage prefix is not configured");
  const value: unknown = await page.evaluate((key) => {
    const raw=localStorage.getItem(key);if(raw===null)return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && "access_token" in parsed
      ? parsed.access_token:null;
  },storageKey);
  return z.string().min(20).parse(value);
}
export async function localRestHeaders(page: Page): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await accessTokenFromPage(page)}`,
    apikey: await readLocalPublishableKey(), "content-type": "application/json" };
}
```

Create `e2e/fixtures/history.ts`:

```ts
import type { Page } from "@playwright/test";
import { z } from "zod";
import { completeMinimumOnboarding, expect, test as authTest } from "./auth";
import { accessTokenFromPage, localRestHeaders } from "./local-supabase";

type HistoryFixtures = { historyPage: Page };
export const test = authTest.extend<HistoryFixtures>({
  historyPage: async ({ authenticatedPage: page }, use) => {
    await completeMinimumOnboarding(page);
    await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
    await page.getByRole("button", { name: "確認して進む" }).click();
    await expect(page).toHaveURL(/\/planner$/u);
    await use(page);
  },
});
export { expect };

export async function setMockScenario(page: Page, scenario: string): Promise<void> {
  await page.route("**/api/generations/*", async (route) => {
    await route.continue({ headers: { ...route.request().headers(),
      "x-kondate-mock-scenario": scenario } });
  }, { times: 1 });
}
export async function seedGeneratedMenu(page: Page): Promise<string> {
  await page.goto("/planner");
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("radio", { name: "和食" }).check();
  await page.getByRole("button", { name: "献立を作る" }).click();
  await expect(page.getByRole("heading", { name: "献立ができました" }))
    .toBeVisible({ timeout: 30_000 });
  return z.string().uuid().parse(/\/menus\/([0-9a-f-]+)$/u.exec(new URL(page.url()).pathname)?.[1]);
}
export async function readRemainingQuota(page: Page): Promise<number> {
  const response = await page.request.get("/api/usage/today", { headers: {
    authorization: `Bearer ${await accessTokenFromPage(page)}` } });
  const body = z.object({ ok: z.literal(true), data: z.object({
    success:z.object({remaining:z.number().int().nonnegative()}),
  }).passthrough() })
    .parse(await response.json());
  return body.data.success.remaining;
}
export async function requestWholeRegeneration(page: Page, menuId: string,
  reason: "simpler" | "different_ingredient" | "child_friendly" | "different_flavor"): Promise<void> {
  await page.goto(`/history/${menuId}`);
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible();
  await page.getByRole("button", { name: "献立をまるごと別案にする" }).click();
  await page.getByLabel({ simpler: "もっと簡単に", different_ingredient: "別の食材で",
    child_friendly: "子どもが食べやすく", different_flavor: "別の味に" }[reason]).check();
  await page.getByRole("button", { name: "別案を作る" }).click();
}
export async function changeFirstMemberSafety(page: Page): Promise<void> {
  const headers = await localRestHeaders(page);
  const rows = z.array(z.object({ id: z.string().uuid() })).parse(await (await page.request.get(
    "http://127.0.0.1:8000/rest/v1/household_members?status=eq.complete&select=id&limit=1",
    { headers })).json());
  const id = z.string().uuid().parse(rows[0]?.id);
  const response = await page.request.patch(
    `http://127.0.0.1:8000/rest/v1/household_members?id=eq.${id}`,
    { headers, data: { allergy_status: "unconfirmed" } });
  if (!response.ok()) throw new Error(`member safety update failed: ${response.status()}`);
}
```

In both generation handlers, read `x-kondate-mock-scenario` only when the parsed server base URL equals `http://openrouter-mock:8787/api/v1`; otherwise ignore it. Pass it to `createGenerationDeps` as the local test scenario. Add a Function test proving the same header is ignored for `https://openrouter.ai/api/v1`.

- [ ] **Step 2: Add failing Playwright journeys using only fixture exports**

```ts
import { expect, readRemainingQuota, requestWholeRegeneration,
  seedGeneratedMenu, setMockScenario, test } from "../fixtures/history";

test("regenerates one dish, groups versions, and marks the chosen menu", async ({ historyPage: page }) => {
  await seedGeneratedMenu(page);
  await page.goto("/history");
  await page.getByRole("link", { name: /鶏肉/u }).first().click();
  await expect(page.getByText(/現在の家族設定で確認しました/u)).toBeVisible();
  await page.getByRole("button", { name: "この一品だけ別案にする" }).click();
  await page.getByLabel("もっと簡単に").check();
  await page.getByRole("button", { name: "別案を作る" }).click();
  await expect(page.getByText("献立ができました")).toBeVisible();
  await page.getByRole("button", { name: "これに決めた" }).click();
  await page.goto("/history");
  await expect(page.getByText("2案")).toBeVisible();
});

test("does not consume a success for duplicate output", async ({ historyPage: page }) => {
  const menuId = await seedGeneratedMenu(page);
  await setMockScenario(page, "duplicate-menu");
  const before = await readRemainingQuota(page);
  await requestWholeRegeneration(page, menuId, "different_flavor");
  await expect(page.getByText("別の案を作れませんでした")).toBeVisible();
  await expect.poll(() => readRemainingQuota(page)).toBe(before);
});
```

Create `history-safety-change.spec.ts`:

```ts
import { changeFirstMemberSafety, expect, seedGeneratedMenu, test } from "../fixtures/history";

test("automatically revalidates on mount and blocks stale history after safety changes",
  async ({ historyPage: page }) => {
    const menuId = await seedGeneratedMenu(page);
    await changeFirstMemberSafety(page);
    await page.goto(`/history/${menuId}`);
    await expect(page.getByRole("alert")).toContainText("現在の家族設定");
    await expect(page.getByRole("button", { name: "献立をまるごと別案にする" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "買い物リストを作る" })).toBeDisabled();
  });
```

- [ ] **Step 3: Run and verify the new E2E tests fail at the first missing product behavior**

Run: `docker compose run --rm app npm run e2e -- e2e/specs/history-regeneration.spec.ts e2e/specs/history-safety-change.spec.ts`

Expected: fixture modules compile and authentication/onboarding completes; FAIL at missing automatic revalidation, regeneration action, or duplicate handling, never at an undefined helper or invalid API key.

- [ ] **Step 4: Implement the exact fixture-backed integration behavior**

The duplicate fixture returns the same role and primary ingredient set twice so both the initial response and repair are rejected. Use only `runGeneration`, the Task 3 loader, and the Task 4 canonical dependencies; do not add alternate persistence paths. The history-detail query mounts with revalidation enabled, invalidates its revalidation query after member changes or regeneration, and navigates to the returned `/menus/:menuId` after success.

- [ ] **Step 5: Run the plan verification gate**

Run:

```bash
set -e
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm test -- --run
docker compose --profile test run --rm db-test
docker compose run --rm app npm run e2e -- e2e/specs/history-regeneration.spec.ts e2e/specs/history-safety-change.spec.ts
docker compose run --rm --no-deps app npm run build
rg -n "'sourceTextSnapshot'" supabase/migrations/20260711003000_history_regeneration.sql
rg -n -U 'insert into public\.menu_label_confirmations\([\s\S]{0,1000}source_text_snapshot' \
  supabase/migrations/20260711003000_history_regeneration.sql
rg -n -U '(return query|returning)[\s\S]{0,1000}source_text_snapshot' \
  supabase/migrations/20260711003000_history_regeneration.sql
rg -n 'sourceTextSnapshot\s*:\s*[^,]*\.sourceText' \
  netlify/functions/_shared/revalidation-adapter.ts
rg -n 'sourceText\s*:\s*[^,]*\.source_text_snapshot' \
  netlify/functions/_shared/revalidation-adapter.ts
rg -n 'source_type,source_id,source_path,source_text_snapshot,allergen_id' \
  netlify/functions/_shared/stored-menu-loader.ts
rg -n 'sourceText\s*:\s*[^,]*\.source_text_snapshot' \
  netlify/functions/_shared/stored-menu-loader.ts
rg -n -U 'expect\([^)]*sourceText\)\.toBe\([^)]*source_text_snapshot\)' \
  netlify/functions/_shared/stored-menu-loader.test.ts
rg -n "'sourceTextSnapshot'" supabase/tests/database/history_regeneration.test.sql
rg -n -U '(is|results_eq)\([\s\S]{0,500}source_text_snapshot' \
  supabase/tests/database/history_regeneration.test.sql
if rg -n 'collectMenuTextSources|create or replace function public\.confirm_menu_label_confirmation|drop function.*confirm_menu_label_confirmation' \
  netlify/functions/_shared/revalidation-adapter.ts \
  supabase/migrations/20260711003000_history_regeneration.sql; then exit 1; fi
```

Expected: the gate runs fail-fast under `set -e`; every command exits 0 and all history/regeneration tests report zero failures. Any failed positive search immediately makes the whole gate nonzero, so the independent source-snapshot searches fail the gate if any one of reconciliation input parsing, SQL insert, SQL return projection, adapter request/response mapping, stored-menu select/mapping, loader assertion, or pgTAP input/saved-value assertion is absent. The forbidden search proves Plan 4 neither dynamically reconstructs warning text nor replaces Plan 3's confirmation RPC.

- [ ] **Step 6: Commit the verified increment**

```bash
git add e2e/fixtures/local-supabase.ts e2e/fixtures/history.ts e2e/specs/history-regeneration.spec.ts e2e/specs/history-safety-change.spec.ts tools/openrouter-mock/fixtures netlify/functions/generate-menu.ts netlify/functions/generate-dish.ts
git commit -m "test: cover history regeneration journeys"
```
