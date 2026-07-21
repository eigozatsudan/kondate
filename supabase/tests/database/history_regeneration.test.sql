begin;
select plan(27);

-- この pgTAP 1.3 は has_column(schema, table, column) の3引数形がなく、
-- schema 付きは description 付きの4引数形だけが使える。
select has_column('public', 'menus', 'derivation_group_id', 'menus has derivation_group_id');
select has_column('public', 'menus', 'parent_menu_id', 'menus has parent_menu_id');
select has_column('public', 'menus', 'version', 'menus has version');
select has_column('public', 'menus', 'change_reason', 'menus has change_reason');
select has_column('public', 'menus', 'selected_at', 'menus has selected_at');
select has_column('public', 'menus', 'is_selected', 'menus has is_selected');
select has_table('public', 'menu_revalidations', 'menu_revalidations exists');
select has_function('public', 'accept_menu_version', array['uuid']);
select has_function('public', 'delete_menu_group', array['uuid']);
-- Plan 3 は非自由記述の change_reason enum を台帳に保持してよい（plan03 L7175）。
-- 禁止対象は自由記述の change_reason_custom のみ。生リクエスト本文は別アサーションで固定する。
select is_empty($$select 1 from information_schema.columns
  where table_schema='private' and table_name='ai_generation_requests'
    and column_name = 'change_reason_custom'$$,
  'generation ledger never stores free-text change_reason_custom');
select has_column('private', 'ai_generation_requests', 'replace_dish_id', 'ledger has replace_dish_id');
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
-- pgTAP 1.3 の has_unique に制約名を取る4引数形はないため、名前付き UNIQUE を直接検査する。
select ok(exists (
  select 1 from pg_constraint c
  where c.conname = 'menu_revalidations_one_per_menu_owner'
    and c.conrelid = 'public.menu_revalidations'::regclass
    and c.contype = 'u'
    and (select array_agg(a.attname order by key_column.ordinality)
      from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum)
      = array['menu_id','user_id']::name[]
), 'repeated mount revalidation updates one latest row instead of growing without bound');
select ok(exists (
  select 1 from pg_constraint c
  where c.conname = 'menu_revalidations_menu_owner_fkey'
    and c.conrelid = 'public.menu_revalidations'::regclass
    and c.confrelid = 'public.menus'::regclass
    and c.confdeltype = 'c'
    and (select array_agg(a.attname order by key_column.ordinality)
      from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum)
      = array['menu_id','user_id']::name[]
    and (select array_agg(a.attname order by ref_column.ordinality)
      from unnest(c.confkey) with ordinality as ref_column(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.confrelid and a.attnum = ref_column.attnum)
      = array['id','user_id']::name[]
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
-- parent_menu_id 非 null のとき Plan 2 の check が change_reason を要求する。
-- 計画の fixture は version のみ列挙していたが、既存 check と両立させるために change_reason を補う。
insert into public.menus (
  id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
  preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,
  food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason,version
) values
  ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001',null,null,1),
  ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','simpler',2),
  ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',
    'dinner','japanese',2,30,'{}','{}',repeat('b',64),'allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001',null,null,1);
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
