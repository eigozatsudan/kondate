begin;
select plan(45);

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
  preference_snapshot,safety_snapshot,safety_fingerprint,target_mode,allergen_dictionary_version,
  food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason,version
) values
  ('b1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'household','allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001',null,null,1),
  ('b1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
    'dinner','japanese',2,30,'{}','{}',repeat('a',64),'household','allergens-v1','food-v1','menu-v1',
    'c1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','simpler',2),
  ('b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002',
    'dinner','japanese',2,30,'{}','{}',repeat('b',64),'household','allergens-v1','food-v1','menu-v1',
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

-- accept_menu_version: 同一 derivation_group 内で is_selected / selected_at を排他切替する
-- fixture の初期選択状態は superuser で用意し、RPC 呼び出しだけ authenticated で行う
update public.menus
set is_selected = true, selected_at = now()
where id = 'b1000000-0000-4000-8000-000000000001';
update public.menus
set is_selected = false, selected_at = null
where id = 'b1000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.accept_menu_version('b1000000-0000-4000-8000-000000000002'::uuid)$$,
  'owner can accept a child version'
);
reset role;
select is(
  (select is_selected from public.menus where id = 'b1000000-0000-4000-8000-000000000002'::uuid),
  true, 'accepted menu is selected'
);
select ok(
  (select selected_at is not null from public.menus
    where id = 'b1000000-0000-4000-8000-000000000002'::uuid),
  'accepted menu has selected_at'
);
select is(
  (select is_selected from public.menus where id = 'b1000000-0000-4000-8000-000000000001'::uuid),
  false, 'sibling version is unselected after accept'
);

-- 非所有者は menu_not_found（P0002）。選択状態は変わらない。
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.accept_menu_version('b1000000-0000-4000-8000-000000000002'::uuid)$$,
  'P0002',
  'menu_not_found',
  'non-owner accept is indistinguishable as menu_not_found'
);
reset role;
select is(
  (select is_selected from public.menus where id = 'b1000000-0000-4000-8000-000000000002'::uuid),
  true, 'non-owner accept does not clear owner selection'
);

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

-- Task 3: reconcile_menu_label_confirmations + 3 引数 confirm の契約
select has_function(
  'public',
  'reconcile_menu_label_confirmations',
  array['uuid','uuid','text','jsonb'],
  'reconcile_menu_label_confirmations exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_menu_label_confirmations(uuid,uuid,text,jsonb)',
    'execute'
  ),
  'service_role may execute reconcile_menu_label_confirmations'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reconcile_menu_label_confirmations(uuid,uuid,text,jsonb)',
    'execute'
  ),
  'authenticated cannot execute reconcile_menu_label_confirmations'
);
select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null
  and to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid,text)') is not null,
  'Plan 3 sole three-argument confirm overload remains; no two-argument overload'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'confirm_menu_label_confirmation'
  ),
  1,
  'exactly one confirm_menu_label_confirmation overload'
);

-- 再検証 1 行 upsert: 同一 (menu,user) を 10 回置換しても 1 行
do $test$
declare
  v_owner constant uuid := 'a1000000-0000-4000-8000-000000000001';
  v_menu constant uuid := 'b3000000-0000-4000-8000-000000000001';
  v_i integer;
begin
  insert into public.menus (
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,target_mode,allergen_dictionary_version,
    food_safety_rule_version,output_schema_version,derivation_group_id,version
  ) values (
    v_menu,v_owner,'dinner','japanese',2,30,'{}','{}',repeat('c',64),'household',
    'allergens-v1','food-v1','menu-v1','c3000000-0000-4000-8000-000000000001',1
  );
  for v_i in 1..10 loop
    insert into public.menu_revalidations (
      user_id,menu_id,safety_fingerprint,allergen_catalog_version,food_rule_version,status,issues,created_at
    ) values (
      v_owner,v_menu,repeat('c',64),'allergens-v1','food-v1','valid','[]'::jsonb, now() + (v_i || ' seconds')::interval
    )
    on conflict (menu_id,user_id) do update set
      status = excluded.status,
      safety_fingerprint = excluded.safety_fingerprint,
      created_at = excluded.created_at;
  end loop;
  if (select count(*)::integer from public.menu_revalidations
        where user_id = v_owner and menu_id = v_menu) <> 1 then
    raise exception 'menu_revalidations grew beyond one row per owner menu';
  end if;
end
$test$;
select pass('ten revalidation upserts leave exactly one row per menu owner');

-- reconcile / confirm: member_10 を member_2 より先に挿入し数値 suffix 順を固定
do $test$
declare
  v_owner constant uuid := 'a3000000-0000-4000-8000-000000000003';
  v_other constant uuid := 'a4000000-0000-4000-8000-000000000004';
  v_member2 constant uuid := 'e2000000-0000-4000-8000-000000000002';
  v_member10 constant uuid := 'e2000000-0000-4000-8000-00000000000a';
  v_menu constant uuid := 'b4000000-0000-4000-8000-000000000001';
  v_dish constant uuid := 'd4000000-0000-4000-8000-0000000000aa';
  v_confirm uuid;
  v_fingerprint text;
  v_stale text;
  v_count integer;
  v_status text;
  v_snapshot text;
  v_req jsonb;
begin
  perform tests.create_supabase_user(v_owner, 'reconcile-owner@example.test');
  perform tests.create_supabase_user(v_other, 'reconcile-other@example.test');

  insert into public.household_members(
    id,user_id,status,display_name,age_band,portion_size,spice_level,allergy_status,
    required_safety_constraints,unsupported_diet_status,unsupported_diet_kinds,ease_preferences
  ) values
    (v_member10,v_owner,'complete','十郎','adult','regular','regular','none',
     array[]::text[],'none',array[]::text[],array[]::text[]),
    (v_member2,v_owner,'complete','次郎','adult','regular','regular','none',
     array[]::text[],'none',array[]::text[],array[]::text[]);

  insert into public.menus (
    id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,
    preference_snapshot,safety_snapshot,safety_fingerprint,target_mode,allergen_dictionary_version,
    food_safety_rule_version,output_schema_version,derivation_group_id,version
  ) values (
    v_menu,v_owner,'dinner','japanese',2,20,'{}','{}',repeat('d',64),'household',
    'jp-caa-2026-04.v1','jp-caa-child-shape-2026-07.v1','2026-07-11.v1',
    'c4000000-0000-4000-8000-000000000001',1
  );
  -- member_10 を先に挿入（挿入順は権威にしない）
  insert into public.menu_target_members (
    menu_id,user_id,household_member_id,household_member_user_id,
    anonymous_ref,member_display_name_snapshot
  ) values
    (v_menu,v_owner,v_member10,v_owner,'member_10','十郎'),
    (v_menu,v_owner,v_member2,v_owner,'member_2','次郎');
  insert into public.dishes (
    id,menu_id,user_id,role,position,name,description,cooking_time_minutes
  ) values (v_dish,v_menu,v_owner,'main',1,'確認料理','説明',10);

  -- numeric suffix 順 member_2, member_10 が fingerprint 入力
  v_fingerprint := private.current_safety_fingerprint(
    v_owner, array[v_member2, v_member10]
  );

  v_req := jsonb_build_array(
    jsonb_build_object(
      'sourceType','dish',
      'sourceId',v_dish,
      'sourcePath','dishes.0.name',
      'sourceTextSnapshot','確認料理',
      'allergenId','egg',
      'anonymousMemberRef','member_2',
      'dictionaryVersion','jp-caa-2026-04.v1'
    ),
    jsonb_build_object(
      'sourceType','dish',
      'sourceId',v_dish,
      'sourcePath','dishes.0.description',
      'sourceTextSnapshot','説明',
      'allergenId','egg',
      'anonymousMemberRef','member_10',
      'dictionaryVersion','jp-caa-2026-04.v1'
    )
  );

  select count(*)::integer into v_count
  from public.reconcile_menu_label_confirmations(
    v_owner, v_menu, v_fingerprint, v_req
  );
  if v_count <> 2 then
    raise exception 'reconcile did not return two current rows: %', v_count;
  end if;
  if (select count(*)::integer from public.menu_label_confirmations
        where menu_id = v_menu and is_current) <> 2 then
    raise exception 'reconcile did not persist two current rows';
  end if;
  if exists (
    select 1 from public.menu_label_confirmations
    where menu_id = v_menu and is_current
      and source_text_snapshot not in ('確認料理','説明')
  ) then
    raise exception 'reconcile did not store exact sourceTextSnapshot values';
  end if;

  -- 同一 sourceId の 2 leaf が別 snapshot を持つ
  if (select count(distinct source_text_snapshot)::integer
        from public.menu_label_confirmations
        where menu_id = v_menu and is_current and source_id = v_dish) <> 2 then
    raise exception 'two leaves sharing source id lost distinct snapshots';
  end if;

  select id into v_confirm
  from public.menu_label_confirmations
  where menu_id = v_menu and is_current and source_path = 'dishes.0.name'
  limit 1;

  -- 所有者 confirm 成功
  perform tests.authenticate_as(v_owner);
  set local role authenticated;
  select confirmation_status into v_status
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_fingerprint);
  if v_status is distinct from 'confirmed' then
    raise exception 'owner confirm after reconcile failed';
  end if;
  reset role;

  -- 同一 fingerprint 再 reconcile は confirmed 証跡と immutable snapshot を保持
  perform public.reconcile_menu_label_confirmations(
    v_owner, v_menu, v_fingerprint, v_req
  );
  select confirmation_status, source_text_snapshot
    into v_status, v_snapshot
  from public.menu_label_confirmations
  where id = v_confirm;
  if v_status is distinct from 'confirmed' or v_snapshot is distinct from '確認料理' then
    raise exception 'same-fingerprint reconcile lost confirmed provenance or snapshot';
  end if;

  -- 設定変更（fingerprint 変化）で旧 ID は confirm 不可、新 pending が作られる
  update public.household_members
  set age_band = 'senior'
  where id = v_member2;
  v_stale := v_fingerprint;
  v_fingerprint := private.current_safety_fingerprint(
    v_owner, array[v_member2, v_member10]
  );
  if v_fingerprint = v_stale then
    raise exception 'fingerprint did not change after member settings update';
  end if;

  perform tests.authenticate_as(v_owner);
  set local role authenticated;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_stale);
  if v_count <> 0 then
    raise exception 'stale fingerprint remaining confirmable after settings change';
  end if;
  reset role;

  select count(*)::integer into v_count
  from public.reconcile_menu_label_confirmations(
    v_owner, v_menu, v_fingerprint, v_req
  );
  if v_count <> 2 then
    raise exception 'reconcile after settings change did not create two pending rows';
  end if;
  if exists (
    select 1 from public.menu_label_confirmations
    where id = v_confirm and is_current
  ) then
    raise exception 'old confirmation remained current after fingerprint change';
  end if;
  if (select count(*)::integer from public.menu_label_confirmations
        where menu_id = v_menu and is_current and confirmation_status = 'pending') <> 2 then
    raise exception 'new pending confirmations missing after fingerprint change';
  end if;

  -- 他所有者は reconcile 不能（menu_not_found）
  begin
    perform public.reconcile_menu_label_confirmations(
      v_other, v_menu, v_fingerprint, v_req
    );
    raise exception 'foreign owner reconcile should fail';
  exception
    when sqlstate 'P0002' then null;
  end;

  -- 同時 fingerprint 不一致はロールバック
  begin
    perform public.reconcile_menu_label_confirmations(
      v_owner, v_menu, v_stale, v_req
    );
    raise exception 'stale fingerprint reconcile should fail';
  exception
    when sqlstate 'P0001' then null;
  end;

  perform tests.clear_authentication();
end
$test$;
select pass('reconcile preserves snapshots, archives obsolete, and reuses numeric member order');
select pass('settings change makes old confirmation unconfirmable and creates new pending rows');
select pass('same-fingerprint reconcile keeps confirmed provenance and immutable snapshot');
select pass('foreign owner reconcile is indistinguishable as menu_not_found');
select pass('concurrent fingerprint mismatch rolls back reconcile');
select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null,
  'no two-argument confirm overload after Plan 4 migration'
);

select * from finish();
rollback;
