# Plan 2 Task 2 保存境界強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 2 Task 2の保存境界を、削除後も単調増加するrevision、Zodと一致するDB制約、実効性のあるRLSテスト、nullable RPC型で強化する。

**Architecture:** 未配備の既存migrationを直接修正し、`generation_drafts`はRLSで隠すソフト削除へ変更する。DB生成型は再生成可能な成果物として維持し、Postgres Metaが表現できないnullable RPC引数だけをアプリ所有の型overlayで補正する。

**Tech Stack:** PostgreSQL 17、Supabase/PostgREST、pgTAP、TypeScript 5.9、Vitest、Docker Compose

## Global Constraints

- Node 24を使用する。
- SQL migrationとRLSは本番影響を持つものとして、ローカルDocker stackで検証する。
- `20260711001000_pantry_and_planner_drafts.sql`は破棄可能なローカル環境以外へ未適用なので、追補migrationを作らず直接修正する。
- `database.generated.ts`は手編集せず、`docker compose run --rm app npm run db:types`で再生成する。
- Node/npm/npxコマンドは必ず`docker compose ... app`内で実行する。DB reset/testのnpm wrapperはcontainer内から呼ばず、reset scriptと`db-test` serviceを直接使う。
- コード内コメントを追加する場合は日本語で背景・意図・制約を書く。
- コミットメッセージは日本語のConventional Commits形式にする。

---

### Task 1: DB保存境界とrevision lifecycleを修正する

**Files:**
- Modify: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Create: `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`
- Modify: `supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: `auth.uid()`、既存`save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)`。
- Produces: `private.is_valid_draft_text_array(text[],integer,integer)`、`private.is_valid_draft_uuid_array(uuid[],integer)`、`private.soft_delete_generation_draft(uuid,uuid,bigint)`、`public.delete_generation_draft(bigint)`、`generation_drafts.deleted_at`、単調増加revision。

- [ ] **Step 1: 既存smoke testへ2 assertionを追加する**

`supabase/tests/database/03_pantry_and_planner_drafts.test.sql`の`select plan(24);`を`select plan(26);`へ置換し、`revision`の`has_column`直後へ次の完全な2 assertionを挿入する。それ以外の24 assertionは変更しない。

```sql
select has_column('public', 'generation_drafts', 'deleted_at',
  'generation draft has a deletion tombstone');
select has_function('public', 'delete_generation_draft', array['bigint']);
```

- [ ] **Step 2: 完全な敵対的pgTAPを追加する**

`supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`を次の内容で作る。`no_plan()`、全setup、role/JWT切替、ACL assertion、`finish()`、`rollback`を含むため、そのまま`psql -f`で実行できる。

```sql
begin;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email)
values
  ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-owner1@example.invalid'),
  ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hardening-owner2@example.invalid');

select has_function('private', 'is_canonical_bounded_text', array['text','integer','integer']);
select has_function('private', 'is_valid_draft_pantry_selections', array['jsonb']);
select has_function('private', 'is_valid_draft_text_array', array['text[]','integer','integer']);
select has_function('private', 'is_valid_draft_uuid_array', array['uuid[]','integer']);
select has_function('private', 'touch_updated_at', array[]::text[]);
select has_function('private', 'soft_delete_generation_draft', array['uuid','uuid','bigint']);

select ok(
  to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'), 'EXECUTE'), false),
  'canonical text helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'), 'EXECUTE'), false),
  'draft text-array helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'), 'EXECUTE'), false),
  'draft UUID-array helper is private'
);
select ok(
  to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)'), 'EXECUTE'), false),
  'soft-delete helper is private'
);
select ok(
  to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'), 'EXECUTE'), false),
  'draft pantry-selection helper is private'
);
select ok(
  to_regprocedure('private.touch_updated_at()') is not null
  and not coalesce(has_function_privilege('anon', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('authenticated', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('private.touch_updated_at()'), 'EXECUTE'), false),
  'updated-at trigger helper is private'
);
select ok(
  6 = (
    select count(*)
    from pg_proc as p
    where p.oid = any (array_remove(array[
      to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'),
      to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'),
      to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'),
      to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'),
      to_regprocedure('private.touch_updated_at()'),
      to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)')
    ], null))
  ) and not exists (
    select 1
    from pg_proc as p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
    where p.oid = any (array_remove(array[
      to_regprocedure('private.is_canonical_bounded_text(text,integer,integer)'),
      to_regprocedure('private.is_valid_draft_pantry_selections(jsonb)'),
      to_regprocedure('private.is_valid_draft_text_array(text[],integer,integer)'),
      to_regprocedure('private.is_valid_draft_uuid_array(uuid[],integer)'),
      to_regprocedure('private.touch_updated_at()'),
      to_regprocedure('private.soft_delete_generation_draft(uuid,uuid,bigint)')
    ], null)) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execute grant on private draft helpers'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)'), 'EXECUTE'), false),
  'only authenticated can execute the save RPC'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('public.delete_generation_draft(bigint)'), 'EXECUTE'), false),
  'only authenticated can execute the delete RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000012', true);
insert into public.pantry_items (id, user_id, name, quantity, unit)
values ('11000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000012', '所有者2の食材', 1, '個');
select public.save_generation_draft(
  0, 'lunch', array['所有者2の食材'], 'western', array[]::uuid[],
  15::smallint, 'economy', array[]::text[], '', '[]'::jsonb
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000011', true);
insert into public.pantry_items (id, user_id, name, quantity, unit)
values
  ('11000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', '所有者1の食材', 1.234, '個'),
  ('11000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000011', repeat('🍳', 80), 1.2300, repeat('🍳', 24)),
  ('11000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000011', '数量上限', 999999, 'g');
select is((select count(*)::integer from public.pantry_items), 3, 'owner sees only own pantry rows');
select is(
  (select quantity from public.pantry_items where id = '11000000-0000-0000-0000-000000000013'),
  1.23::numeric,
  'equivalent trailing-zero precision round-trips without rejection'
);
select is((select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000012'), 0, 'foreign pantry row is hidden');
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000012','越境追加')$$,
  '42501', null, 'authenticated cannot insert a pantry row for another owner'
);
with changed as (
  update public.pantry_items set name = '侵害' where id = '11000000-0000-0000-0000-000000000012' returning 1
) select is((select count(*)::integer from changed), 0, 'foreign pantry update affects zero rows');
with removed as (
  delete from public.pantry_items where id = '11000000-0000-0000-0000-000000000012' returning 1
) select is((select count(*)::integer from removed), 0, 'foreign pantry delete affects zero rows');
update public.pantry_items set name = '所有者1の更新' where id = '11000000-0000-0000-0000-000000000011';
select is((select name from public.pantry_items where id = '11000000-0000-0000-0000-000000000011'), '所有者1の更新', 'owner can update own pantry row');
select throws_ok(
  $$update public.pantry_items set user_id = '10000000-0000-0000-0000-000000000012' where id = '11000000-0000-0000-0000-000000000013'$$,
  '42501', null, 'owner cannot transfer a pantry row to another user'
);
delete from public.pantry_items where id = '11000000-0000-0000-0000-000000000011';
select is((select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000011'), 0, 'owner can delete own pantry row');
select is((select count(*)::integer from public.generation_drafts), 0, 'foreign active draft is hidden');

select throws_ok(
  $$insert into public.generation_drafts(user_id) values ('10000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'authenticated cannot directly insert own draft'
);
select throws_ok(
  $$insert into public.generation_drafts(user_id) values ('10000000-0000-0000-0000-000000000012')$$,
  '42501', null, 'authenticated cannot directly insert foreign draft'
);
select throws_ok(
  $$update public.generation_drafts set memo = '侵害' where user_id = '10000000-0000-0000-0000-000000000011'$$,
  '42501', null, 'authenticated cannot directly update own draft'
);
select throws_ok(
  $$update public.generation_drafts set memo = '侵害' where user_id = '10000000-0000-0000-0000-000000000012'$$,
  '42501', null, 'authenticated cannot directly update foreign draft'
);
select throws_ok(
  $$delete from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000011'$$,
  '42501', null, 'authenticated cannot directly delete own draft'
);
select throws_ok(
  $$delete from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000012'$$,
  '42501', null, 'authenticated cannot directly delete foreign draft'
);

select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','NaN','NaN'::numeric,'g')$$,
  '23514', null, 'quantity rejects numeric NaN'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','上限超過',1000000,'g')$$,
  '23514', null, 'quantity rejects values above 999999'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','小数4桁',1.2345,'g')$$,
  '23514', null, 'quantity rejects more than three decimal places'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000011',U&'\00A0padding\FEFF')$$,
  '23514', null, 'pantry name rejects ECMAScript Unicode padding'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','単位',1,U&'\FEFFg\00A0')$$,
  '23514', null, 'pantry unit rejects ECMAScript Unicode padding'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values ('10000000-0000-0000-0000-000000000011',repeat('🍳',81))$$,
  '23514', null, 'pantry name counts astral characters as code points'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values ('10000000-0000-0000-0000-000000000011','単位超過',1,repeat('🍳',25))$$,
  '23514', null, 'pantry unit counts astral characters as code points'
);

select throws_ok(
  $$select public.save_generation_draft(null,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '22023', 'invalid_draft_save', 'NULL expected revision is invalid'
);
select throws_ok(
  $$select public.save_generation_draft(-1,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '22023', 'invalid_draft_save', 'negative expected revision is invalid'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[null::text],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[['鶏肉']]::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array['   ']::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject blank elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[U&'\00A0鶏肉\FEFF']::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject Unicode padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[repeat('🍳',81)]::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredients reject elements above 80 code points'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[null::uuid],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target members reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[['20000000-0000-0000-0000-000000000001'::uuid]],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target members reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[null::text],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject NULL elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[['乳']]::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject multidimensional arrays'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[U&'\2028乳']::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject Unicode padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[repeat('x',81)]::text[],'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredients reject overlong elements'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],U&'\FEFFmemo','[]'::jsonb)$$,
  '23514', null, 'memo rejects non-canonical padding'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],repeat('🍳',201),'[]'::jsonb)$$,
  '23514', null, 'memo rejects more than 200 code points'
);

select is(
  (public.save_generation_draft(
    0, null, array_fill(repeat('🍳',80), array[8]), null,
    array(select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,20) as values_(i)),
    null, null, array(select '避ける' || i from generate_series(1,20) as values_(i)), repeat('🍳',200),
    (select jsonb_agg(jsonb_build_object('pantryItemId',('21000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','prefer_use')) from generate_series(1,50) as values_(i))
  )).revision,
  1::bigint,
  'all declared count and code-point maxima are accepted'
);
select is(
  (select jsonb_build_object(
    'mealType',meal_type,'mainIngredients',main_ingredients,'cuisineGenre',cuisine_genre,
    'targetMemberIds',target_member_ids,'timeLimitMinutes',time_limit_minutes,
    'budgetPreference',budget_preference,'avoidIngredients',avoid_ingredients,
    'memo',memo,'pantrySelections',pantry_selections,'revision',revision
  ) from public.generation_drafts),
  jsonb_build_object(
    'mealType',null,'mainIngredients',array_fill(repeat('🍳',80), array[8]),'cuisineGenre',null,
    'targetMemberIds',array(select ('20000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,20) as values_(i)),
    'timeLimitMinutes',null,'budgetPreference',null,
    'avoidIngredients',array(select '避ける' || i from generate_series(1,20) as values_(i)),
    'memo',repeat('🍳',200),
    'pantrySelections',(select jsonb_agg(jsonb_build_object('pantryItemId',('21000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','prefer_use')) from generate_series(1,50) as values_(i)),
    'revision',1
  ),
  'create round-trips every nullable and collection payload field'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array(select '食材' || i from generate_series(1,9) as values_(i)),null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'main ingredient count rejects nine'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,array(select ('22000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid from generate_series(1,21) as values_(i)),null,null,array[]::text[],'','[]'::jsonb)$$,
  '23514', null, 'target member count rejects twenty-one'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,array[]::uuid[],null,null,array(select '回避' || i from generate_series(1,21) as values_(i)),'','[]'::jsonb)$$,
  '23514', null, 'avoid ingredient count rejects twenty-one'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],'', (select jsonb_agg(jsonb_build_object('pantryItemId',('23000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'priority','must_use')) from generate_series(1,51) as values_(i)))$$,
  '23514', null, 'pantry selection count rejects fifty-one'
);

select is(
  (public.save_generation_draft(
    1, 'dinner', array['鶏肉','白菜'], 'japanese',
    array['20000000-0000-0000-0000-000000000001'::uuid], 30::smallint,
    'standard', array['乳'], '更新',
    '[{"pantryItemId":"21000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb
  )).revision,
  2::bigint,
  'valid update increments revision'
);
select is(
  (select jsonb_build_object(
    'mealType',meal_type,'mainIngredients',main_ingredients,'cuisineGenre',cuisine_genre,
    'targetMemberIds',target_member_ids,'timeLimitMinutes',time_limit_minutes,
    'budgetPreference',budget_preference,'avoidIngredients',avoid_ingredients,
    'memo',memo,'pantrySelections',pantry_selections,'revision',revision
  ) from public.generation_drafts),
  jsonb_build_object(
    'mealType','dinner','mainIngredients',array['鶏肉','白菜'],'cuisineGenre','japanese',
    'targetMemberIds',array['20000000-0000-0000-0000-000000000001'::uuid],
    'timeLimitMinutes',30,'budgetPreference','standard','avoidIngredients',array['乳'],
    'memo','更新','pantrySelections','[{"pantryItemId":"21000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb,
    'revision',2
  ),
  'update round-trips the complete payload'
);
select throws_ok(
  $$select public.save_generation_draft(0,null,null,null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict',
  'expected revision zero conflicts with an active draft before payload validation'
);
select throws_ok(
  $$select public.save_generation_draft(1,null,array[]::text[],null,array[]::uuid[],null,null,array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict', 'stale save is rejected'
);
select is(public.delete_generation_draft(2), 3::bigint, 'delete increments the authoritative revision');
select is((select count(*)::integer from public.generation_drafts), 0, 'soft-deleted draft is hidden from its owner');
select throws_ok(
  $$select public.delete_generation_draft(2)$$,
  'P0001', 'draft_revision_conflict', 'stale delete is rejected'
);
select throws_ok(
  $$select public.delete_generation_draft(null)$$,
  '22023', 'invalid_draft_save', 'NULL delete revision is invalid'
);
select throws_ok(
  $$select public.delete_generation_draft(-1)$$,
  '22023', 'invalid_draft_save', 'negative delete revision is invalid'
);
select is(
  (public.save_generation_draft(0,'dinner',array['再作成'],'japanese',array[]::uuid[],30::smallint,'standard',array[]::text[],'','[]'::jsonb)).revision,
  4::bigint,
  'recreation continues the tombstone revision'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['古い画面'],'japanese',array[]::uuid[],30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict', 'pre-delete revision cannot overwrite recreation'
);

reset role;
select is(
  (select count(*)::integer from public.pantry_items where id = '11000000-0000-0000-0000-000000000012' and name = '所有者2の食材'),
  1,
  'foreign pantry mutation attempts leave the row unchanged'
);
select is(
  (select revision from public.generation_drafts where user_id = '10000000-0000-0000-0000-000000000011'),
  4::bigint,
  'tombstone lineage remains monotonic after recreation'
);

select * from finish();
rollback;
```

- [ ] **Step 3: REDを確認する**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql
```

Expected: `deleted_at`/`delete_generation_draft`不在、およびNaN・不正配列・ABA反例の少なくとも一つを理由としてFAILする。構文エラーやplan件数不一致だけの失敗はREDとして受け入れない。

- [ ] **Step 4: migrationを完全置換する**

`supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`全体を次で置換する。部分的に旧policyや旧grantを残さない。

```sql
create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (
    name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    and char_length(name) between 1 and 80
  ),
  quantity numeric check (
    quantity > 0 and quantity <= 999999 and quantity = round(quantity, 3)
  ),
  unit text check (
    unit = btrim(unit, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    and char_length(unit) between 1 and 24
  ),
  expires_on date,
  expiration_type text check (expiration_type in ('use_by', 'best_before', 'other', 'unknown')),
  opened_state text check (opened_state in ('unopened', 'opened', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check ((quantity is null and unit is null) or (quantity is not null and unit is not null))
);

create index pantry_items_owner_expiry_idx
  on public.pantry_items (user_id, expires_on nulls last, created_at desc);

create or replace function private.is_canonical_bounded_text(
  p_value text, p_min_length integer, p_max_length integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is null or (
    pg_catalog.char_length(p_value) between p_min_length and p_max_length
    and p_value = pg_catalog.btrim(
      p_value,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
  );
$function$;

create or replace function private.is_valid_draft_pantry_selections(p_value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  for v_item in select item from jsonb_array_elements(p_value) as items(item) loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'pantryItemId')
      or not (v_item ? 'priority')
      or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'pantryItemId') <> 'string'
      or jsonb_typeof(v_item -> 'priority') <> 'string'
      or (v_item ->> 'priority') not in ('must_use', 'prefer_use') then
      return false;
    end if;
    begin
      perform (v_item ->> 'pantryItemId')::uuid;
    exception when invalid_text_representation then
      return false;
    end;
  end loop;
  return true;
end;
$function$;

create or replace function private.is_valid_draft_text_array(
  p_value text[], p_max_count integer, p_max_length integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is not null
    and pg_catalog.cardinality(p_value) <= p_max_count
    and (pg_catalog.cardinality(p_value) = 0 or pg_catalog.array_ndims(p_value) = 1)
    and not exists (
      select 1
      from pg_catalog.unnest(p_value) as values_(value)
      where value is null
        or not private.is_canonical_bounded_text(value, 1, p_max_length)
    );
$function$;

create or replace function private.is_valid_draft_uuid_array(
  p_value uuid[], p_max_count integer
) returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_value is not null
    and pg_catalog.cardinality(p_value) <= p_max_count
    and (pg_catalog.cardinality(p_value) = 0 or pg_catalog.array_ndims(p_value) = 1)
    and not exists (
      select 1
      from pg_catalog.unnest(p_value) as values_(value)
      where value is null
    );
$function$;

revoke all on function private.is_canonical_bounded_text(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_pantry_selections(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_text_array(text[], integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.is_valid_draft_uuid_array(uuid[], integer)
  from public, anon, authenticated, service_role;

create table public.generation_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner')),
  main_ingredients text[] not null default '{}',
  cuisine_genre text check (cuisine_genre in ('japanese', 'western', 'chinese', 'any')),
  target_member_ids uuid[] not null default '{}',
  time_limit_minutes smallint check (time_limit_minutes in (15, 30, 45)),
  budget_preference text check (budget_preference in ('economy', 'standard')),
  avoid_ingredients text[] not null default '{}',
  memo text not null default '',
  pantry_selections jsonb not null default '[]'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (private.is_valid_draft_text_array(main_ingredients, 8, 80)),
  check (private.is_valid_draft_uuid_array(target_member_ids, 20)),
  check (private.is_valid_draft_text_array(avoid_ingredients, 20, 80)),
  check (private.is_canonical_bounded_text(memo, 0, 200)),
  check (private.is_valid_draft_pantry_selections(pantry_selections)),
  check (jsonb_array_length(pantry_selections) <= 50),
  check (pg_column_size(pantry_selections) <= 32768),
  check (
    not jsonb_path_exists(
      pantry_selections,
      '$[*] ? (exists(@.checkedAt) || exists(@.checkedOnJst) || exists(@.idempotencyKey))'
    )
  )
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = pg_catalog.statement_timestamp();
  return new;
end;
$function$;
revoke all on function private.touch_updated_at()
  from public, anon, authenticated, service_role;

create trigger pantry_items_touch_updated_at
before update on public.pantry_items
for each row execute function private.touch_updated_at();

create trigger generation_drafts_touch_updated_at
before update on public.generation_drafts
for each row execute function private.touch_updated_at();

alter table public.pantry_items enable row level security;
alter table public.generation_drafts enable row level security;
revoke all on public.pantry_items from anon, authenticated;
revoke all on public.generation_drafts from anon, authenticated;
grant select, insert, update, delete on public.pantry_items to authenticated;
grant select on public.generation_drafts to authenticated;

create policy pantry_items_owner_select on public.pantry_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy pantry_items_owner_insert on public.pantry_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_update on public.pantry_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_delete on public.pantry_items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy generation_drafts_owner_select on public.generation_drafts
  for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

create or replace function private.soft_delete_generation_draft(
  p_user_id uuid, p_draft_id uuid, p_expected_revision bigint
) returns public.generation_drafts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_deleted public.generation_drafts;
begin
  update public.generation_drafts
  set deleted_at = pg_catalog.statement_timestamp(), revision = revision + 1
  where user_id = p_user_id
    and deleted_at is null
    and (p_draft_id is null or id = p_draft_id)
    and (p_expected_revision is null or revision = p_expected_revision)
  returning * into v_deleted;
  return v_deleted;
end;
$function$;

revoke all on function private.soft_delete_generation_draft(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;

create or replace function public.save_generation_draft(
  p_expected_revision bigint, p_meal_type text, p_main_ingredients text[],
  p_cuisine_genre text, p_target_member_ids uuid[], p_time_limit_minutes smallint,
  p_budget_preference text, p_avoid_ingredients text[], p_memo text,
  p_pantry_selections jsonb
) returns public.generation_drafts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_saved public.generation_drafts;
  v_has_existing boolean;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );
  select * into v_saved
  from public.generation_drafts
  where user_id = v_user_id
  for update;
  v_has_existing := found;

  if p_expected_revision = 0 then
    if v_has_existing and v_saved.deleted_at is null then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    if not v_has_existing then
      insert into public.generation_drafts (
        user_id, meal_type, main_ingredients, cuisine_genre, target_member_ids,
        time_limit_minutes, budget_preference, avoid_ingredients, memo,
        pantry_selections, revision
      ) values (
        v_user_id, p_meal_type, p_main_ingredients, p_cuisine_genre, p_target_member_ids,
        p_time_limit_minutes, p_budget_preference, p_avoid_ingredients, p_memo,
        p_pantry_selections, 1
      )
      returning * into v_saved;
    else
      update public.generation_drafts
      set meal_type = p_meal_type,
        main_ingredients = p_main_ingredients,
        cuisine_genre = p_cuisine_genre,
        target_member_ids = p_target_member_ids,
        time_limit_minutes = p_time_limit_minutes,
        budget_preference = p_budget_preference,
        avoid_ingredients = p_avoid_ingredients,
        memo = p_memo,
        pantry_selections = p_pantry_selections,
        revision = revision + 1,
        deleted_at = null
      where id = v_saved.id
      returning * into v_saved;
    end if;
    return v_saved;
  else
    if not v_has_existing
      or v_saved.deleted_at is not null
      or v_saved.revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
    end if;

    update public.generation_drafts
    set meal_type = p_meal_type,
      main_ingredients = p_main_ingredients,
      cuisine_genre = p_cuisine_genre,
      target_member_ids = p_target_member_ids,
      time_limit_minutes = p_time_limit_minutes,
      budget_preference = p_budget_preference,
      avoid_ingredients = p_avoid_ingredients,
      memo = p_memo,
      pantry_selections = p_pantry_selections,
      revision = revision + 1
    where id = v_saved.id
    returning * into v_saved;
    return v_saved;
  end if;
end;
$function$;

create or replace function public.delete_generation_draft(p_expected_revision bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted public.generation_drafts;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;
  v_deleted := private.soft_delete_generation_draft(v_user_id, null, p_expected_revision);
  if v_deleted is null then
    raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
  end if;
  return v_deleted.revision;
end;
$function$;

revoke all on function public.save_generation_draft(
  bigint, text, text[], text, uuid[], smallint, text, text[], text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.delete_generation_draft(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, uuid[], smallint, text, text[], text, jsonb
) to authenticated;
grant execute on function public.delete_generation_draft(bigint)
  to authenticated;
```

- [ ] **Step 5: focused GREENを確認する**

Run:

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/03_pantry_and_planner_drafts.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql
```

Expected: 全assertionがPASSし、`Result: PASS`。

- [ ] **Step 6: DB型を再生成して検証する**

Run:

```bash
docker compose run --rm app npm run db:types
docker compose run --rm --no-deps app npm run typecheck
git diff --check
```

Expected: `database.generated.ts`へ`deleted_at`、2つのpublic RPC、private helper/validatorが反映され、typecheckとdiff checkがexit 0。

- [ ] **Step 7: コミットする**

```bash
git add supabase/migrations/20260711001000_pantry_and_planner_drafts.sql \
  supabase/tests/database/03_pantry_and_planner_drafts.test.sql \
  supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql \
  src/shared/types/database.generated.ts
git commit -m "fix: 献立下書きの保存境界を強化"
```

---

### Task 2: nullable RPC型overlayを追加する

**Files:**
- Create: `src/shared/types/database.ts`
- Create: `src/shared/types/database.test.ts`
- Modify: `src/shared/lib/supabase.ts`

**Interfaces:**
- Consumes: generated `Database["public"]["Functions"]["save_generation_draft"]`。
- Produces: app-owned `Database`型。nullableになるのは`p_meal_type`、`p_cuisine_genre`、`p_time_limit_minutes`、`p_budget_preference`だけ。

- [ ] **Step 1: nullable incomplete draftの型テストを書く**

```ts
import { expect, expectTypeOf, it } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Database } from "./database";
import type { Database as GeneratedDatabase } from "./database.generated";

type SaveDraftArgs =
  Database["public"]["Functions"]["save_generation_draft"]["Args"];

it("未完成下書きのnullable項目をRPC引数として表現できる", () => {
  const args = {
    p_expected_revision: 0,
    p_meal_type: null,
    p_main_ingredients: [],
    p_cuisine_genre: null,
    p_target_member_ids: [],
    p_time_limit_minutes: null,
    p_budget_preference: null,
    p_avoid_ingredients: [],
    p_memo: "",
    p_pantry_selections: [],
  } satisfies SaveDraftArgs;

  expectTypeOf(args).toMatchTypeOf<SaveDraftArgs>();
  expect(args.p_meal_type).toBeNull();
});

function acceptsIncompleteDraft(
  client: BrowserSupabaseClient,
  args: SaveDraftArgs,
) {
  return client.rpc("save_generation_draft", args);
}

it("browser clientのRPC境界も未完成下書きを受け入れる", () => {
  expectTypeOf(acceptsIncompleteDraft).toBeFunction();
});

const invalidMemo = {
  p_expected_revision: 0,
  p_meal_type: null,
  p_main_ingredients: [],
  p_cuisine_genre: null,
  p_target_member_ids: [],
  p_time_limit_minutes: null,
  p_budget_preference: null,
  p_avoid_ingredients: [],
  // @ts-expect-error memoはnullableへ拡張しない
  p_memo: null,
  p_pantry_selections: [],
} satisfies SaveDraftArgs;

void invalidMemo;

type GeneratedSaveDraft =
  GeneratedDatabase["public"]["Functions"]["save_generation_draft"];
type AppSaveDraft =
  Database["public"]["Functions"]["save_generation_draft"];

it("nullable 4項目以外のRPC契約を変更しない", () => {
  expectTypeOf<AppSaveDraft["Returns"]>().toEqualTypeOf<
    GeneratedSaveDraft["Returns"]
  >();
  expectTypeOf<
    Database["public"]["Functions"]["set_onboarding_status"]
  >().toEqualTypeOf<
    GeneratedDatabase["public"]["Functions"]["set_onboarding_status"]
  >();
});

const invalidRevision = {
  ...invalidMemo,
  p_memo: "",
  // @ts-expect-error expected revisionはnullableへ拡張しない
  p_expected_revision: null,
} satisfies SaveDraftArgs;

const invalidMainIngredients = {
  ...invalidMemo,
  p_memo: "",
  // @ts-expect-error 配列はnullableへ拡張しない
  p_main_ingredients: null,
} satisfies SaveDraftArgs;

void invalidRevision;
void invalidMainIngredients;
```

- [ ] **Step 2: REDを確認する**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/types/database.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

Expected: `./database`が存在しないためFAILする。

- [ ] **Step 3: generated型を狭くoverlayする**

`database.ts`を次の構造で作る。

```ts
import type { Database as GeneratedDatabase } from "./database.generated";

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublic["Functions"];
type GeneratedSaveDraft = GeneratedFunctions["save_generation_draft"];
type GeneratedSaveDraftArgs = GeneratedSaveDraft["Args"];

type NullableDraftArgs =
  | "p_meal_type"
  | "p_cuisine_genre"
  | "p_time_limit_minutes"
  | "p_budget_preference";

type SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & {
  p_meal_type: GeneratedSaveDraftArgs["p_meal_type"] | null;
  p_cuisine_genre: GeneratedSaveDraftArgs["p_cuisine_genre"] | null;
  p_time_limit_minutes: GeneratedSaveDraftArgs["p_time_limit_minutes"] | null;
  p_budget_preference: GeneratedSaveDraftArgs["p_budget_preference"] | null;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Functions"> & {
    Functions: Omit<GeneratedFunctions, "save_generation_draft"> & {
      save_generation_draft: Omit<GeneratedSaveDraft, "Args"> & {
        Args: SaveDraftArgs;
      };
    };
  };
};
```

`src/shared/lib/supabase.ts`の`Database` importだけを`@/shared/types/database`へ変更する。テーブル用helperを利用する既存ファイルとservice-role clientはgenerated型を継続利用する。

- [ ] **Step 4: GREENを確認する**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/types/database.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

Expected: 新規テストPASS、typecheck/lint exit 0。既存lint warningは増加しない。

- [ ] **Step 5: コミットする**

```bash
git add src/shared/types/database.ts src/shared/types/database.test.ts \
  src/shared/lib/supabase.ts
git commit -m "fix: 下書きRPCのnullable型を補正"
```

---

### Task 3: 後続計画を保存・削除・予約契約へ同期する

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md`
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md`

**Interfaces:**
- Consumes: Task 1の`delete_generation_draft(expectedRevision)`と`private.soft_delete_generation_draft(userId,draftId,expectedRevision)`。
- Produces: Task 4のcanonical text/3桁数量schema、Task 7のrevision-aware `deletePlannerDraft`、Plan 3 reservation/finalizerのactive-draft契約。

- [ ] **Step 1: Plan 2 Task 2の掲載コードを実装と一致させる**

Plan 2の`## Task 2: Pantry Items and Planner Draft Persistence`内だけを更新する。`Step 1`の`select plan(24);`を`26`へ変更し、`has_column(...revision...)`直後へTask 1 Step 1の2 assertionを挿入する。`Step 3`のmigration code fenceはTask 1 Step 4の全置換migrationと同一内容へ丸ごと置換し、旧`numeric(12,3)`、旧draft CRUD grant/policy、物理DELETEを残さない。`Step 4`の実行コマンドは次へ完全置換する。

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/03_pantry_and_planner_drafts.test.sql
docker compose --profile test run --rm db-test supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql
docker compose run --rm app npm run db:types
docker compose run --rm --no-deps app npm run typecheck
```

`Step 4`のExpectedは「03が26 assertion、03aが全assertion PASSし、型生成とtypecheckがexit 0」とする。コミット例は`fix: 献立下書きの保存境界を強化`へ置換する。数量条件は必ず`quantity = round(quantity, 3)`であり、`scale(quantity) <= 3`へ変更しない。

- [ ] **Step 2: Plan 2 Task 4のschemaをDB境界と一致させる**

Plan 2の`### Task 4: Shared Domain Contracts and Cross-Row Validators`をアンカーとする。`Step 1`の`pantry.test.ts`へ次のtestを`describe("pantry contracts", ...)`内に完全追加する。

```ts
it("canonicalizes ECMAScript padding and counts Unicode code points", () => {
  expect(
    pantryItemInputSchema.parse({
      name: "\u00a0🍳\ufeff",
      quantity: 1.234,
      unit: "\ufeff個\u00a0",
      expiresOn: null,
      expirationType: null,
      openedState: null,
    }),
  ).toMatchObject({ name: "🍳", quantity: 1.234, unit: "個" });
  expect(
    pantryItemInputSchema.safeParse({
      name: "🍳".repeat(81),
      quantity: null,
      unit: null,
      expiresOn: null,
      expirationType: null,
      openedState: null,
    }).success,
  ).toBe(false);
});

it("rejects quantity with more than three decimal places", () => {
  expect(
    pantryItemInputSchema.safeParse({
      name: "牛乳",
      quantity: 1.2345,
      unit: "ml",
      expiresOn: null,
      expirationType: null,
      openedState: null,
    }).success,
  ).toBe(false);
});
```

`Step 1`の`planner.test.ts`へ次を`describe("planner contracts", ...)`内に完全追加する。

```ts
it("canonicalizes Unicode padding in draft text fields", () => {
  expect(
    plannerDraftInputSchema.parse({
      ...incompleteDraft,
      mainIngredients: ["\u00a0🍳\ufeff"],
      avoidIngredients: ["\u2028乳\u2029"],
      memo: "\ufeffメモ\u00a0",
    }),
  ).toMatchObject({
    mainIngredients: ["🍳"],
    avoidIngredients: ["乳"],
    memo: "メモ",
  });
});

it("counts astral draft text by Unicode code point", () => {
  expect(
    plannerDraftInputSchema.safeParse({
      ...incompleteDraft,
      mainIngredients: ["🍳".repeat(80)],
      memo: "🍳".repeat(200),
    }).success,
  ).toBe(true);
  expect(
    plannerDraftInputSchema.safeParse({
      ...incompleteDraft,
      mainIngredients: ["🍳".repeat(81)],
    }).success,
  ).toBe(false);
});
```

`Step 3`の`shared/contracts/pantry.ts` code fenceでは、`expirationTypes`等の定数直後から`pantryItemInputSchema`直前までを次へ置換し、同ファイル内の`name`、`pantryItemName`、`unusedReason`のstring schemaもそれぞれ`boundedCanonicalText(1, 80)`、`boundedCanonicalText(1, 80)`、`boundedCanonicalText(1, 200).nullable()`へ置換する。

```ts
function boundedCanonicalText(min: number, max: number) {
  return z.string().trim().refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    },
    { message: `${min}〜${max}文字で入力してください` },
  );
}

const nullableUnitSchema = boundedCanonicalText(1, 24).nullable();
const nullableQuantitySchema = z
  .number()
  .positive()
  .max(999_999)
  .multipleOf(0.001)
  .nullable();

export const pantryItemInputSchema = z
  .object({
    name: boundedCanonicalText(1, 80),
    quantity: nullableQuantitySchema,
    unit: nullableUnitSchema,
    expiresOn: z.string().date().nullable(),
    expirationType: z.enum(expirationTypes).nullable(),
    openedState: z.enum(openedStates).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.quantity === null) !== (value.unit === null)) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "分量と単位は両方入力してください",
      });
    }
  });
```

`Step 3`の`shared/contracts/planner.ts` code fenceでは、`plannerTimeLimits`と`budgetPreferences`直後から`plannerSubmissionSchema`末尾までを次へ置換する。

```ts
function boundedCanonicalText(min: number, max: number) {
  return z.string().trim().refine(
    (value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    },
    { message: `${min}〜${max}文字で入力してください` },
  );
}

const draftShape = {
  mealType: z.enum(mealTypes).nullable(),
  mainIngredients: z.array(boundedCanonicalText(1, 80)).max(8),
  cuisineGenre: z.enum(cuisineGenres).nullable(),
  targetMemberIds: z.array(z.string().uuid()).max(20),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
  memo: boundedCanonicalText(0, 200),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
} satisfies z.ZodRawShape;

export const plannerDraftInputSchema = z.object(draftShape).strict();
export const plannerDraftSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    ...draftShape,
    revision: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const plannerSubmissionSchema = z
  .object({
    mealType: z.enum(mealTypes),
    mainIngredients: z.array(boundedCanonicalText(1, 80)).min(1).max(8),
    cuisineGenre: z.enum(cuisineGenres),
    targetMemberIds: z.array(z.string().uuid()).min(1).max(20),
    timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
    budgetPreference: z.enum(budgetPreferences).nullable(),
    avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
    memo: boundedCanonicalText(0, 200),
    pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
  })
  .strict();
```

Task 4のRED/GREENコマンドは次へ置換する。

```bash
docker compose run --rm --no-deps app npx vitest run \
  shared/contracts/pantry.test.ts shared/contracts/planner.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 3: Plan 2 Task 7の削除APIを置換する**

Plan 2の`## Task 7: Three-Step Planner, Current Safety Summary, and Server Autosave`、`Step 3`をアンカーとする。Filesへ`Test: src/features/planner/planner-api.test.ts`を追加し、RED testとして次の完全なファイルを`Step 1`のcomponent test後へ追加する。

```ts
import { describe, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { deletePlannerDraft } from "./planner-api";

function clientWithRpc(result: { error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as BrowserSupabaseClient, rpc };
}

describe("deletePlannerDraft", () => {
  it("passes the authoritative revision to the delete RPC", async () => {
    const { client, rpc } = clientWithRpc({ error: null });
    await deletePlannerDraft(client, 7);
    expect(rpc).toHaveBeenCalledWith("delete_generation_draft", {
      p_expected_revision: 7,
    });
  });

  it("maps a stale delete to the shared conflict code", async () => {
    const { client } = clientWithRpc({
      error: { message: "draft_revision_conflict" },
    });
    await expect(deletePlannerDraft(client, 7)).rejects.toMatchObject({
      code: "draft_revision_conflict",
    });
  });
});
```

`Step 2`のRED commandと`Step 4`のGREEN commandは次のDocker形へ置換する。GREENでは既存planner testと新しいAPI testを両方実行する。

```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/planner/planner-page.test.tsx \
  src/features/planner/planner-api.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
```

`Step 3`の`deletePlannerDraft`関数全体を次で置換する。

```ts
export async function deletePlannerDraft(
  client: BrowserSupabaseClient,
  expectedRevision: number,
): Promise<void> {
  const { error } = await client.rpc("delete_generation_draft", {
    p_expected_revision: expectedRevision,
  });
  if (error?.message.includes("draft_revision_conflict") === true) {
    throw Object.assign(new Error("別の画面で献立条件が更新されました"), {
      code: "draft_revision_conflict" as const,
    });
  }
  if (error !== null) {
    throw new Error("献立条件の下書きを削除できませんでした");
  }
}
```

`planner-page.tsx`の生成成功後または明示的破棄のcallerは`deletePlannerDraft(client, draft.revision)`を呼ぶ。`userId`は渡さない。Task 7の全文から`.from("generation_drafts").delete()`を削除する。

- [ ] **Step 4: Plan 3の予約とfinalizerをactive-draft契約へ置換する**

Plan 3では古いTask 2/4と最終補正Task 15の両方を同期する。予約は`### Task 15`、`Step 5`内の「Immediately after the same-key replay branch」直後にあるauthoritative lookupをアンカーとし、その`if` block全体を次へ置換する。`deleted_at is null`はrevision条件と同じlookup内に置き、quota操作より前であることを維持する。

```sql
if p_request_kind = 'new_menu' then
  select * into v_draft
  from public.generation_drafts
  where id = p_draft_id
    and user_id = p_user_id
    and revision = p_draft_revision
    and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_unavailable';
  end if;
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_member_ids,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections,captured_at
  ) values (
    v_draft.id,v_draft.user_id,v_draft.revision,v_draft.meal_type,
    v_draft.main_ingredients,v_draft.cuisine_genre,v_draft.target_member_ids,
    v_draft.time_limit_minutes,v_draft.budget_preference,v_draft.avoid_ingredients,
    v_draft.memo,v_draft.pantry_selections,p_now
  ) on conflict (draft_id,user_id,draft_revision) do nothing;
elsif p_draft_id is not null or p_draft_revision is not null then
  raise exception using errcode = '22023', message = 'invalid_draft_reference';
end if;
```

Task 15で曖昧になっている最終予約RPCは、ここで次の1シグネチャに確定させる。古い8引数overloadはDROPし、revoke/grant、repositoryのnamed arguments、生成型、`to_regprocedure`検査もこの型に揃える。`change_reason_custom`は引数に含めない。

```sql
public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_source_menu_id uuid,
  p_replace_dish_id uuid,
  p_change_reason text,
  p_request_hmac_version text,
  p_request_hmac text,
  p_user_limit integer,
  p_global_limit integer,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default clock_timestamp()
) returns jsonb
```

Task 2 Step 1のpgTAPは、Task 2単体のRED/GREEN実行時には掲載済みの旧8引数呼出しのまま維持する。Task 15へ到達し、上の最終14引数migrationを作るときにだけ、`supabase/tests/database/ai_control_and_quota.test.sql`の最初の
`select throws_ok($$ select public.reserve_ai_generation(`から、`generation_in_progress`を検査する4回目の`select is(...)`の終端までを、下の完全blockで置換する。その後の`select lives_ok($$ select public.finalize_ai_generation_failure(`が置換終端のアンカーである。これにより4呼出しすべてが最終signature、実在active draft/revision、およびversioned 64-hex HMACを使う。

```sql
insert into public.generation_drafts(
  id,user_id,meal_type,main_ingredients,cuisine_genre,target_member_ids,
  time_limit_minutes,budget_preference,avoid_ingredients,memo,pantry_selections,revision
) values (
  '21000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'dinner',array['quota fixture'],'japanese',array[]::uuid[],
  30,'standard',array[]::text[],'','[]',1
);

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099',
    'new_menu','21000000-0000-4000-8000-000000000001',1,
    null,null,null,'generation-command.v1',repeat('9',64),
    6,45,180,'2026-07-10 15:00:00+00'
  )
$$, '22023', 'release_quota_mismatch',
  'the database rejects an environment-only success-limit override');

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu','21000000-0000-4000-8000-000000000001',1,
    null,null,null,'generation-command.v1',repeat('1',64),
    5,45,180,'2026-07-10 15:00:00+00'
  )->>'status',
  'processing'
);
select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu','21000000-0000-4000-8000-000000000001',1,
    null,null,null,'generation-command.v1',repeat('1',64),
    5,45,180,'2026-07-10 15:00:01+00'
  )->>'replayed',
  'true'
);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 1);
select is((select reserved_count from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'), 1);

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'new_menu','21000000-0000-4000-8000-000000000001',1,
    null,null,null,'generation-command.v1',repeat('2',64),
    5,45,180,'2026-07-10 15:00:02+00'
  )->>'failure_code',
  'generation_in_progress'
);
```

同じStep 5のpgTAPへ追加する前に、ファイル先頭の固定`plan(...)`を`select no_plan();`へ置換し、末尾の`select * from finish();`は維持する。次のblockはすべての変数を宣言し、呼出しは上の最終シグネチャである。DO block内の比較失敗は例外にし、成功時だけtop-levelの`pass()`がTAP assertionを1行出力する。`v_before`はrequest ledger、immutable submission snapshot、success quota、daily external attempt、fixed window、global counterの全行をPK順で保持する。

```sql
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000071';
  v_draft_id constant uuid := '20000000-0000-4000-8000-000000000071';
  v_key constant uuid := '30000000-0000-4000-8000-000000000071';
  v_revision constant bigint := 7;
  v_deleted public.generation_drafts;
  v_before jsonb;
  v_after jsonb;
begin
  if to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,integer,integer,integer,timestamptz)'
  ) is null then
    raise exception 'the final reservation signature is missing';
  end if;
  if to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,integer,integer,integer,timestamptz)'
  ) is not null then
    raise exception 'the obsolete reservation overload still exists';
  end if;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','deleted-reserve@example.invalid','','{}','{}',now(),now());
  insert into public.generation_drafts(
    id,user_id,meal_type,main_ingredients,cuisine_genre,target_member_ids,
    time_limit_minutes,budget_preference,avoid_ingredients,memo,pantry_selections,revision
  ) values(v_draft_id,v_owner,'dinner',array['鶏肉'],'japanese',array[]::uuid[],
    30,'standard',array[]::text[],'','[]',v_revision);

  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft_id,v_revision);
  if v_deleted.revision is distinct from v_revision + 1 then
    raise exception 'deleted reserve fixture did not advance the draft revision';
  end if;

  select jsonb_build_object(
    'requests',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global',coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_before;

  begin
    perform public.reserve_ai_generation(
      v_owner,v_key,'new_menu',v_draft_id,v_revision,
      null,null,null,'generation-command.v1',repeat('a',64),
      5,45,180,'2026-07-11 00:00:00+00');
    raise exception using errcode='XX000',message='expected_draft_unavailable';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_unavailable' then raise; end if;
  end;

  select jsonb_build_object(
    'requests',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global',coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'deleted draft reservation changed ledger, snapshot, quota, or counter state';
  end if;
end
$test$;
select pass('deleted draft reservation rejects with the final signature and zero side effects');
```

予約RPCの実装とtest fixtureの双方で、`deleted_at is null`を付けずに事前SELECTする代替経路を作らない。

finalizerは`### Task 4: Persist a validated menu and terminal success in one transaction`、`Step 4`の`delete from public.generation_drafts ...;`をアンカーとし、その1文を次のblockへ置換する。さらにTask 15の「before draft deletion」という文言を「before the draft soft-delete helper call」へ置換する。

```sql
perform private.soft_delete_generation_draft(
  v_request.user_id,
  v_request.draft_id,
  null
);
```

Plan 3の説明を、成功時点の有効draftをソフト削除しrevisionを増加させる契約へ変更する。予約済みsnapshot、後続autosave許可、idempotent replayの説明は維持する。

private helperのNULL結果は成功no-opとして扱う。finalizer内では戻り値を変数へ代入せず、NULLを検査せず、上記`perform`の直後にquota/request成功更新を継続する。

Task 15の`20260711002000_ai_control_and_quota.sql`で、finalizerを作成するより前に下の2関数をそのまま追加する。`private.current_safety_fingerprint(uuid,uuid[]) returns text`はPlan 2の`createCurrentSafetyFingerprint`と同じkey、key順、member/allergen/constraintソート、および同じ固定versionを使う唯一のcanonical JSON/SHA-256 builderである。PostgreSQLの`jsonb::text`の空白やkey並び替えをhash入力にせず、ECMAScriptの`JSON.stringify(payload)`と同じ無空白文字列を明示的に構築する。locking helperは非空・重複なしのowner-owned complete member集合を検証し、member、既存allergy、version tableを安定順でlockしてから、必ずcanonical builderの結果を比較する。

```sql
create or replace function private.current_safety_fingerprint(
  p_user_id uuid,
  p_target_member_ids uuid[]
) returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_payload text;
begin
  with target_members as (
    select target.member_id, target.ordinality
    from unnest(coalesce(p_target_member_ids, array[]::uuid[]))
      with ordinality as target(member_id, ordinality)
  ), member_payloads as (
    select
      m.id,
      '{"householdMemberId":' || to_jsonb(m.id::text)::text ||
      ',"anonymousRef":' || to_jsonb('member_' || t.ordinality::text)::text ||
      ',"ageBand":' || to_jsonb(m.age_band)::text ||
      ',"allergyStatus":' || to_jsonb(m.allergy_status)::text ||
      ',"allergenIds":[' || coalesce((
        select string_agg(to_jsonb(a.allergen_id)::text, ',' order by a.allergen_id)
        from public.member_allergies a
        where a.user_id = p_user_id
          and a.member_id = m.id
          and a.allergen_id is not null
      ), '') || ']' ||
      ',"hasUnmappedCustomAllergy":' || case when exists (
        select 1
        from public.member_allergies a
        where a.user_id = p_user_id
          and a.member_id = m.id
          and a.allergen_id is null
      ) then 'true' else 'false' end ||
      ',"requiredSafetyConstraints":[' || coalesce((
        select string_agg(to_jsonb(value)::text, ',' order by value)
        from unnest(m.required_safety_constraints) as required(value)
      ), '') || ']' ||
      ',"unsupportedDietStatus":' || to_jsonb(m.unsupported_diet_status)::text ||
      ',"unsupportedDietKinds":[' || coalesce((
        select string_agg(to_jsonb(value)::text, ',' order by value)
        from unnest(m.unsupported_diet_kinds) as unsupported(value)
      ), '') || ']}' as payload
    from target_members t
    join public.household_members m
      on m.id = t.member_id
     and m.user_id = p_user_id
     and m.status = 'complete'
  )
  select
    '{"dictionaryVersion":"jp-caa-2026-04.v1"' ||
    ',"foodRuleVersion":"jp-caa-child-shape-2026-07.v1"' ||
    ',"members":[' || coalesce(string_agg(payload, ',' order by id), '') || ']}'
  into v_payload
  from member_payloads;

  return encode(
    extensions.digest(pg_catalog.convert_to(v_payload, 'UTF8'), 'sha256'),
    'hex'
  );
end
$function$;

create or replace function private.lock_and_assert_current_safety_fingerprint(
  p_user_id uuid,
  p_target_member_ids uuid[],
  p_expected text
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_target_ids uuid[];
  v_locked_count integer;
begin
  select coalesce(array_agg(member_id order by member_id), array[]::uuid[])
  into v_target_ids
  from (
    select distinct member_id
    from unnest(coalesce(p_target_member_ids, array[]::uuid[])) as target(member_id)
  ) deduplicated;

  if cardinality(v_target_ids) = 0
     or cardinality(v_target_ids) <> cardinality(p_target_member_ids) then
    raise exception using errcode = '22023', message = 'invalid_target_members';
  end if;

  perform 1
  from public.household_members m
  where m.user_id = p_user_id
    and m.status = 'complete'
    and m.id = any(v_target_ids)
  order by m.id
  for update;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> cardinality(v_target_ids) then
    raise exception using errcode = '22023', message = 'invalid_target_members';
  end if;

  perform 1
  from public.member_allergies a
  where a.user_id = p_user_id
    and a.member_id = any(v_target_ids)
  order by a.member_id, a.id
  for update;

  lock table public.allergen_catalog in share mode;
  lock table public.allergen_aliases in share mode;
  lock table public.food_safety_rules in share mode;

  if private.current_safety_fingerprint(p_user_id, p_target_member_ids)
       is distinct from p_expected then
    raise exception using errcode = 'P0001', message = 'current_safety_changed';
  end if;
end
$function$;

revoke all on function private.current_safety_fingerprint(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.lock_and_assert_current_safety_fingerprint(uuid, uuid[], text)
  from public, anon, authenticated, service_role;
```

Task 15はTask 4の旧空target/dummy fingerprintのsuccess fixtureを削除し、下のfixtureへ置換する。fixtureは実在owner/member、標準allergy、seed済みcatalog/rule versionを作成・参照し、上のproduction canonical builderの結果だけをfinalizerへ渡す。test-local fingerprint helperは作らない。

```sql
create temporary table finalize_fixture_context(
  preference_snapshot jsonb not null,
  safety_snapshot jsonb not null,
  safety_fingerprint text not null,
  allergen_version text not null,
  food_rule_version text not null,
  target_members jsonb not null
) on commit drop;

create function pg_temp.finalize_ordering_success(
  p_request_id uuid,p_menu_id uuid,p_dish_id uuid,p_ingredient_id uuid,
  p_step_id uuid,p_timeline_id uuid,p_adaptation_id uuid,p_now timestamptz
) returns jsonb language plpgsql as $fixture$
declare
  v_context pg_temp.finalize_fixture_context;
  v_side1_dish_id uuid := pg_catalog.gen_random_uuid();
  v_side1_ingredient_id uuid := pg_catalog.gen_random_uuid();
  v_side1_step_id uuid := pg_catalog.gen_random_uuid();
  v_side2_dish_id uuid := pg_catalog.gen_random_uuid();
  v_side2_ingredient_id uuid := pg_catalog.gen_random_uuid();
  v_side2_step_id uuid := pg_catalog.gen_random_uuid();
begin
  select * into strict v_context from pg_temp.finalize_fixture_context;
  return public.finalize_ai_generation_success(
    p_request_id,
    jsonb_build_object(
      'schemaVersion','2026-07-11.v1','menuId',p_menu_id,
      'mealType','dinner','cuisineGenre','japanese','servings',2,
      'totalElapsedMinutes',15,'safetyTags','[]'::jsonb,
      'dishes',jsonb_build_array(jsonb_build_object(
        'id',p_dish_id,'role','main','position',1,'name','鶏肉と白菜の煮物',
        'description','短時間の煮物','cookingTimeMinutes',15,
        'ingredients',jsonb_build_array(jsonb_build_object(
          'id',p_ingredient_id,'position',1,'name','鶏もも肉',
          'quantityValue',200,'quantityText','200g','unit','g',
          'storeSection','meat_fish','pantrySelectionId',null,
          'labelConfirmationRequired',false)),
        'steps',jsonb_build_array(jsonb_build_object(
          'id',p_step_id,'position',1,'instruction','材料を中心まで加熱する'))),
        jsonb_build_object(
          'id',v_side1_dish_id,'role','side','position',2,'name','白菜のおひたし',
          'description','副菜','cookingTimeMinutes',10,
          'ingredients',jsonb_build_array(jsonb_build_object(
            'id',v_side1_ingredient_id,'position',1,'name','白菜',
            'quantityValue',100,'quantityText','100g','unit','g',
            'storeSection','vegetables','pantrySelectionId',null,
            'labelConfirmationRequired',false)),
          'steps',jsonb_build_array(jsonb_build_object(
            'id',v_side1_step_id,'position',1,'instruction','白菜をゆでる'))),
        jsonb_build_object(
          'id',v_side2_dish_id,'role','soup','position',3,'name','わかめ汁',
          'description','汁物','cookingTimeMinutes',10,
          'ingredients',jsonb_build_array(jsonb_build_object(
            'id',v_side2_ingredient_id,'position',1,'name','わかめ',
            'quantityValue',10,'quantityText','10g','unit','g',
            'storeSection','dry_goods','pantrySelectionId',null,
            'labelConfirmationRequired',false)),
          'steps',jsonb_build_array(jsonb_build_object(
            'id',v_side2_step_id,'position',1,'instruction','わかめを煮る')))),
      'timeline',jsonb_build_array(jsonb_build_object(
        'id',p_timeline_id,'position',1,'startMinute',0,'durationMinutes',15,
        'instruction','主菜を作る','dishId',p_dish_id,'recipeStepId',p_step_id)),
      'adaptations',jsonb_build_array(jsonb_build_object(
        'id',p_adaptation_id,'dishId',p_dish_id,'anonymousMemberRef','member_1',
        'portionText','1人分','branchBeforeRecipeStepId',p_step_id,
        'additionalCutting','1cm角','additionalHeating','中心まで十分に加熱',
        'additionalSeasoning',null,'servingCheck','骨がないことを確認',
        'safetyTags',jsonb_build_array('remove_bones'),
        'safetyActions',jsonb_build_array(jsonb_build_object(
          'kind','remove_bones','dishId',p_dish_id,'ingredientId',p_ingredient_id,
          'anonymousMemberRef','member_1','beforeRecipeStepId',p_step_id,
          'instruction','骨を完全に除く')))),
      'pantryUsage','[]'::jsonb,
      'labelConfirmations','[]'::jsonb),
    v_context.preference_snapshot,v_context.safety_snapshot,v_context.safety_fingerprint,
    v_context.allergen_version,v_context.food_rule_version,
    v_context.target_members,'[]'::jsonb,null,null,null,p_now);
end
$fixture$;

do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000072';
  v_member constant uuid := '20000000-0000-4000-8000-000000000072';
  v_draft public.generation_drafts;
  v_deleted public.generation_drafts;
  v_request_id uuid;
  v_result jsonb;
  v_target_ids uuid[];
  v_allergen_version text;
  v_food_rule_version text;
  v_fingerprint text;
  v_before_revision bigint;
  v_recreated_revision bigint;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','ordering-finalizer@example.invalid','','{}','{}',now(),now());
  insert into public.household_members(
    id,user_id,status,display_name,age_band,portion_size,spice_level,
    allergy_status,unsupported_diet_status,sort_order
  ) values(v_member,v_owner,'complete','注文確認','adult','regular','mild',
    'registered','none',0);
  insert into public.member_allergies(id,user_id,member_id,allergen_id)
  values('21000000-0000-4000-8000-000000000072',v_owner,v_member,'milk');
  select catalog_version into strict v_allergen_version
  from public.allergen_catalog where id='milk';
  select rule_version into strict v_food_rule_version
  from public.food_safety_rules order by id limit 1;
  v_target_ids := array[v_member];
  v_fingerprint := private.current_safety_fingerprint(v_owner,v_target_ids);
  insert into pg_temp.finalize_fixture_context values(
    jsonb_build_object('mealType','dinner'),
    jsonb_build_object('members',jsonb_build_array(jsonb_build_object(
      'householdMemberId',v_member,'anonymousRef','member_1','ageBand','adult',
      'allergyStatus','registered','allergenIds',jsonb_build_array('milk'),
      'requiredSafetyConstraints','[]'::jsonb,'unsupportedDietStatus','none',
      'unsupportedDietKinds','[]'::jsonb))),
    v_fingerprint,v_allergen_version,v_food_rule_version,
    jsonb_build_array(jsonb_build_object(
      'householdMemberId',v_member,'anonymousRef','member_1',
      'displayNameSnapshot','注文確認'))
  );
  perform set_config('request.jwt.claim.sub',v_owner::text,true);

  v_draft := public.save_generation_draft(0,'dinner',array['canonical'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000080',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v1',repeat('e',64),5,45,180,'2026-07-11 00:00:10+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000080';
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:00:11+00');
  v_result := pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000080','61000000-0000-4000-8000-000000000080',
    '62000000-0000-4000-8000-000000000080','63000000-0000-4000-8000-000000000080',
    '64000000-0000-4000-8000-000000000080','65000000-0000-4000-8000-000000000080',
    '2026-07-11 00:00:12+00');
  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'canonical finalizer fixture did not succeed';
  end if;
  if (select count(*) from public.menu_safety_actions
      where menu_id='60000000-0000-4000-8000-000000000080') <> 1 then
    raise exception 'canonical finalizer did not commit exactly one safety action';
  end if;
  if not exists (
    select 1
    from public.menu_member_adaptations adaptation
    join public.menu_safety_actions action
      on action.menu_id=adaptation.menu_id
     and action.dish_id=adaptation.dish_id
     and action.anonymous_member_ref=adaptation.anonymous_member_ref
    where adaptation.id='65000000-0000-4000-8000-000000000080'
      and adaptation.menu_id='60000000-0000-4000-8000-000000000080'
      and action.ingredient_id='62000000-0000-4000-8000-000000000080'
      and action.before_recipe_step_id='63000000-0000-4000-8000-000000000080'
      and action.position=1
      and action.kind='remove_bones'
      and action.instruction='骨を完全に除く'
  ) then
    raise exception 'canonical finalizer did not commit the adaptation safety-action child';
  end if;

  -- helper: active delete -> NULL -> recreation delete, with monotonic revisions.
  v_draft := public.save_generation_draft(0,'dinner',array['helper-1'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,v_draft.revision);
  if v_deleted.revision is distinct from v_draft.revision+1 then
    raise exception 'helper did not increment an active draft revision';
  end if;
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,null);
  if v_deleted is not null then
    raise exception 'helper did not return NULL for an already deleted draft';
  end if;
  v_draft := public.save_generation_draft(0,'dinner',array['helper-2'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,null);
  if v_deleted.revision is distinct from v_draft.revision+1 then
    raise exception 'helper did not advance the recreated draft revision';
  end if;

  -- manual delete first: finalizer must still persist and succeed.
  v_draft := public.save_generation_draft(0,'dinner',array['manual-first'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000081',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v1',repeat('b',64),5,45,180,'2026-07-11 00:01:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000081';
  perform public.delete_generation_draft(v_draft.revision);
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:01:01+00');
  v_result := pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000081','61000000-0000-4000-8000-000000000081',
    '62000000-0000-4000-8000-000000000081','63000000-0000-4000-8000-000000000081',
    '64000000-0000-4000-8000-000000000081','65000000-0000-4000-8000-000000000081',
    '2026-07-11 00:01:02+00');
  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'manual-delete-first finalizer did not succeed';
  end if;
  if (select count(*) from public.menus
      where id='60000000-0000-4000-8000-000000000081') <> 1 then
    raise exception 'manual-delete-first did not commit the menu';
  end if;

  -- finalizer first: the old public revision is stale.
  v_draft := public.save_generation_draft(0,'dinner',array['finalizer-first'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  v_before_revision := v_draft.revision;
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000082',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v1',repeat('c',64),5,45,180,'2026-07-11 00:02:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000082';
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:02:01+00');
  perform pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000082','61000000-0000-4000-8000-000000000082',
    '62000000-0000-4000-8000-000000000082','63000000-0000-4000-8000-000000000082',
    '64000000-0000-4000-8000-000000000082','65000000-0000-4000-8000-000000000082',
    '2026-07-11 00:02:02+00');
  begin
    perform public.delete_generation_draft(v_before_revision);
    raise exception using errcode='XX000',message='expected_draft_revision_conflict';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_revision_conflict' then raise; end if;
  end;

  -- reserve -> manual delete -> recreation -> finalizer deletes the live recreation.
  v_draft := public.save_generation_draft(0,'dinner',array['reserved'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000083',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v1',repeat('d',64),5,45,180,'2026-07-11 00:03:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000083';
  perform public.delete_generation_draft(v_draft.revision);
  v_draft := public.save_generation_draft(0,'dinner',array['recreated'],'japanese',
    v_target_ids,30,'standard',array[]::text[],'','[]');
  v_recreated_revision := v_draft.revision;
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:03:01+00');
  perform pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000083','61000000-0000-4000-8000-000000000083',
    '62000000-0000-4000-8000-000000000083','63000000-0000-4000-8000-000000000083',
    '64000000-0000-4000-8000-000000000083','65000000-0000-4000-8000-000000000083',
    '2026-07-11 00:03:02+00');
  if (select revision from public.generation_drafts where id=v_draft.id)
      is distinct from v_recreated_revision+1 then
    raise exception 'finalizer did not advance the live recreation revision';
  end if;
  if not coalesce((select deleted_at is not null
      from public.generation_drafts where id=v_draft.id),false) then
    raise exception 'finalizer did not soft-delete the live recreation';
  end if;
end
$test$;
select pass('canonical finalization and both manual-delete/finalizer orderings are enforced');
```

このfixtureはPlan 3 Task 4の旧signature用testを置換し、Task 15の唯一のfinalizer signature
`public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz)`
だけを呼ぶ。各menu aggregateのUUIDは一意であり、top-levelの`PERFORM`、未宣言変数、未定義helperはない。

Plan 3の変更対象taskに残るNode/DB検証コマンドも同時にDocker形へ置換する。DB reset/testはnpm wrapperを使わない。

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test supabase/tests/database/ai_control_and_quota.test.sql
docker compose run --rm app npm run db:types
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 5: 文書整合性を検証する**

Run:

```bash
if rg -U -n 'from\("generation_drafts"\)[\s\S]{0,160}\.delete\(|delete from public\.generation_drafts' \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md; then exit 1; fi
rg -n "delete_generation_draft|soft_delete_generation_draft|deleted_at is null" \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
docker compose run --rm --no-deps app npx prettier --check \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
git diff --check
```

Expected: 検索結果にauthenticatedの直接DELETEやfinalizerの物理DELETEがなく、削除はpublic/private helper契約だけを参照する。formatとdiff checkはexit 0。

- [ ] **Step 6: コミットする**

```bash
git add docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
git commit -m "docs: 下書き削除契約を単調revisionへ更新"
```

---

### Task 4: 全体検証と敵対的再レビュー

**Files:**
- Verify only: repository-wide relevant files

**Interfaces:**
- Consumes: Tasks 1〜3の全成果物。
- Produces: merge可否を判断できる検証証跡。

- [ ] **Step 1: fresh DBから全検証する**

```bash
./scripts/reset-local-db.sh
docker compose run --rm app npm run db:types
docker compose --profile test run --rm db-test
docker compose run --rm --no-deps app npx vitest run
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run build
git diff --check
git status --short
```

Expected: 全コマンドexit 0。lintは既存warning以外を増やさない。container内のDB型生成後に意図しないdiffが生じない。

- [ ] **Step 2: 元の反例を再実行する**

`03a_pantry_and_planner_drafts_hardening.test.sql`を単独実行し、同ファイルのrollback transaction内でauthenticated ownerとしてNaN、小数4桁、Unicode padding、NULL/多次元/巨大配列、直接DELETE、DELETE→再作成→旧revision保存を再実行する。

```bash
docker compose --profile test run --rm db-test supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql
```

Expected: NaN/不正配列は`23514`、直接DELETEは`42501`、旧revision保存は`P0001 / draft_revision_conflict`。

- [ ] **Step 3: 独立サブエージェントレビューを実施する**

設計書、当計画、実装前後diff、テストレポートを読み取り専用reviewerへ渡し、spec complianceとcode qualityの両方で承認を得る。Critical/Importantがあれば一括修正し、focused testを再実行して再レビューする。
