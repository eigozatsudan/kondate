\ir 000_helpers.sql
begin;
select no_plan();

select tests.create_supabase_user('10000000-0000-0000-0000-000000000001', 'menu-one@example.invalid');
select tests.create_supabase_user('10000000-0000-0000-0000-000000000002', 'menu-two@example.invalid');

insert into public.household_members (
  id, user_id, status, display_name, age_band, portion_size, spice_level,
  allergy_status, unsupported_diet_status
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'complete', '一郎', 'adult', 'regular', 'regular', 'none', 'none'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'complete', '二郎', 'adult', 'regular', 'regular', 'none', 'none');

insert into public.pantry_items (id, user_id, name, quantity, unit) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '卵', 1, '個'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '牛乳', 1, '本');

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id
) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'dinner', 'japanese', 2, 30, '{}', '{}', repeat('a', 64), 'dict-v1', 'rule-v1', 'schema-v1', '40000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'dinner', 'western', 2, 30, '{}', '{}', repeat('b', 64), 'dict-v1', 'rule-v1', 'schema-v1', '40000000-0000-0000-0000-000000000002');

insert into public.menu_target_members (
  id, menu_id, user_id, household_member_id, household_member_user_id,
  anonymous_ref, member_display_name_snapshot
) values
  ('40100000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'member_1', '一郎'),
  ('40100000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'member_1', '二郎');

insert into public.generation_pantry_selections (
  id, menu_id, user_id, pantry_item_id, pantry_name_snapshot, priority,
  idempotency_key, usage_status, planned_quantity,
  inventory_quantity_snapshot, shortage_quantity, unit
) values
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '卵', 'must_use', '41100000-0000-0000-0000-000000000001', 'used', 2, 1, 1, '個'),
  ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '牛乳', 'must_use', '41100000-0000-0000-0000-000000000002', 'used', 2, 1, 1, '本');

insert into public.dishes (
  id, menu_id, user_id, role, position, name, description, cooking_time_minutes
) values
  ('42000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'main', 1, '卵焼き', '卵の主菜', 10),
  ('42000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'main', 1, 'スープ', '牛乳の主菜', 10);

insert into public.dish_ingredients (
  id, menu_id, dish_id, user_id, position, name, quantity_value,
  quantity_text, unit, store_section, pantry_selection_id
) values
  ('43000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, '卵', 2, '2個', '個', 'dairy_eggs', '41000000-0000-0000-0000-000000000001'),
  ('43000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1, '牛乳', 1, '1本', '本', 'dairy_eggs', '41000000-0000-0000-0000-000000000002');

insert into public.recipe_steps (
  id, menu_id, dish_id, user_id, position, instruction
) values
  ('44000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, '卵を焼く'),
  ('44000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1, '牛乳を温める');

insert into public.menu_timeline_steps (
  id, menu_id, user_id, position, start_minute, duration_minutes,
  instruction, dish_id, recipe_step_id
) values
  ('45000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 0, 10, '卵を焼く', '42000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001'),
  ('45000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1, 0, 10, '牛乳を温める', '42000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000002');

insert into public.menu_member_adaptations (
  id, menu_id, dish_id, user_id, anonymous_member_ref, portion_text,
  branch_before_recipe_step_id, serving_check
) values
  ('46000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'member_1', '通常量', '44000000-0000-0000-0000-000000000001', '中心まで確認'),
  ('46000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'member_1', '通常量', '44000000-0000-0000-0000-000000000002', '中心まで確認');

insert into public.menu_safety_actions (
  id, menu_id, dish_id, ingredient_id, user_id, anonymous_member_ref,
  before_recipe_step_id, position, kind, instruction
) values
  ('47000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'member_1', '44000000-0000-0000-0000-000000000001', 1, 'heat_thoroughly', '中心まで十分に加熱する'),
  ('47000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'member_1', '44000000-0000-0000-0000-000000000002', 1, 'heat_thoroughly', '中心まで十分に加熱する');

insert into public.menu_label_confirmations (
  id, menu_id, user_id, source_type, source_id, source_path, source_text_snapshot, allergen_id,
  anonymous_member_ref, dictionary_version, requirement_safety_fingerprint
) values
  ('48000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'dish', '42000000-0000-0000-0000-000000000001', 'dishes.0.name', '卵焼き', 'egg', 'member_1', 'dict-v1', repeat('a', 64)),
  ('48100000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ingredient', '43000000-0000-0000-0000-000000000001', 'dishes.0.ingredients.0.name', '卵', 'egg', 'member_1', 'dict-v1', repeat('a', 64)),
  ('48200000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'recipe_step', '44000000-0000-0000-0000-000000000001', 'dishes.0.steps.0.instruction', '卵を焼く', 'egg', 'member_1', 'dict-v1', repeat('a', 64)),
  ('48300000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'adaptation', '46000000-0000-0000-0000-000000000001', 'adaptations.0.servingCheck', '中心まで確認', 'egg', 'member_1', 'dict-v1', repeat('a', 64)),
  ('48400000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'timeline', '45000000-0000-0000-0000-000000000001', 'timeline.0.instruction', '卵を焼く', 'egg', 'member_1', 'dict-v1', repeat('a', 64)),
  ('48000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'dish', '42000000-0000-0000-0000-000000000002', 'dishes.0.name', 'スープ', 'egg', 'member_1', 'dict-v1', repeat('b', 64)),
  ('48100000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'ingredient', '43000000-0000-0000-0000-000000000002', 'dishes.0.ingredients.0.name', '牛乳', 'egg', 'member_1', 'dict-v1', repeat('b', 64)),
  ('48200000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'recipe_step', '44000000-0000-0000-0000-000000000002', 'dishes.0.steps.0.instruction', '牛乳を温める', 'egg', 'member_1', 'dict-v1', repeat('b', 64)),
  ('48300000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'adaptation', '46000000-0000-0000-0000-000000000002', 'adaptations.0.servingCheck', '中心まで確認', 'egg', 'member_1', 'dict-v1', repeat('b', 64)),
  ('48400000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'timeline', '45000000-0000-0000-0000-000000000002', 'timeline.0.instruction', '牛乳を温める', 'egg', 'member_1', 'dict-v1', repeat('b', 64));

select ok(
  has_table_privilege('authenticated', format('public.%I', table_name), 'select')
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'insert')
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'update')
  and not has_table_privilege('authenticated', format('public.%I', table_name), 'delete'),
  format('%s grants select but deny table writes', table_name)
)
from unnest(array[
  'menus', 'menu_target_members', 'generation_pantry_selections', 'dishes',
  'dish_ingredients', 'recipe_steps', 'menu_timeline_steps',
  'menu_member_adaptations', 'menu_safety_actions', 'menu_label_confirmations'
]) as tables(table_name);

select is(
  array(
    select attribute.attname::text
    from pg_attribute attribute
    where attribute.attrelid = 'public.menus'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and has_column_privilege(
        'authenticated', 'public.menus', attribute.attname, 'update'
      )
    order by attribute.attname
  ),
  array['is_favorite']::text[],
  'only menus.is_favorite is browser-updatable'
);

select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null
  and to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid,text)') is null,
  'Task 3 exposes no confirmation transition before current-safety locking exists'
);

select ok(
  actual.child_columns = expected.child_columns
  and actual.parent_columns = expected.parent_columns
  and actual.delete_type = expected.delete_type,
  format('%s has the exact ordered owner-composite delete contract', expected.constraint_name)
)
from (values
  ('menus_parent_owner_fkey', array['parent_menu_id','user_id'], array['id','user_id'], 'c'),
  ('menu_target_members_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('menu_target_members_member_owner_fkey', array['household_member_id','household_member_user_id'], array['id','user_id'], 'n'),
  ('generation_pantry_selections_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('generation_pantry_selections_item_owner_fkey', array['pantry_item_id','user_id'], array['id','user_id'], 'n'),
  ('dishes_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('dish_ingredients_dish_owner_fkey', array['dish_id','menu_id','user_id'], array['id','menu_id','user_id'], 'c'),
  ('dish_ingredients_pantry_owner_fkey', array['pantry_selection_id','menu_id','user_id'], array['id','menu_id','user_id'], 'n'),
  ('recipe_steps_dish_owner_fkey', array['dish_id','menu_id','user_id'], array['id','menu_id','user_id'], 'c'),
  ('menu_timeline_steps_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('menu_timeline_steps_dish_owner_fkey', array['dish_id','menu_id','user_id'], array['id','menu_id','user_id'], 'c'),
  ('menu_timeline_steps_step_owner_fkey', array['recipe_step_id','dish_id','menu_id','user_id'], array['id','dish_id','menu_id','user_id'], 'c'),
  ('menu_member_adaptations_dish_owner_fkey', array['dish_id','menu_id','user_id'], array['id','menu_id','user_id'], 'c'),
  ('menu_member_adaptations_branch_owner_fkey', array['branch_before_recipe_step_id','dish_id','menu_id','user_id'], array['id','dish_id','menu_id','user_id'], 'c'),
  ('menu_member_adaptations_member_owner_fkey', array['menu_id','user_id','anonymous_member_ref'], array['menu_id','user_id','anonymous_ref'], 'c'),
  ('menu_safety_actions_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('menu_safety_actions_dish_owner_fkey', array['dish_id','menu_id','user_id'], array['id','menu_id','user_id'], 'c'),
  ('menu_safety_actions_ingredient_owner_fkey', array['ingredient_id','dish_id','menu_id','user_id'], array['id','dish_id','menu_id','user_id'], 'c'),
  ('menu_safety_actions_member_owner_fkey', array['menu_id','user_id','anonymous_member_ref'], array['menu_id','user_id','anonymous_ref'], 'c'),
  ('menu_safety_actions_step_owner_fkey', array['before_recipe_step_id','dish_id','menu_id','user_id'], array['id','dish_id','menu_id','user_id'], 'c'),
  ('menu_safety_actions_adaptation_owner_fkey', array['menu_id','dish_id','user_id','anonymous_member_ref'], array['menu_id','dish_id','user_id','anonymous_member_ref'], 'c'),
  ('menu_label_confirmations_menu_owner_fkey', array['menu_id','user_id'], array['id','user_id'], 'c'),
  ('menu_label_confirmations_member_owner_fkey', array['menu_id','user_id','anonymous_member_ref'], array['menu_id','user_id','anonymous_ref'], 'c')
) as expected(constraint_name, child_columns, parent_columns, delete_type)
left join lateral (
  select
    array(select a.attname::text from unnest(c.conkey) with ordinality as keys(attnum, position) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = keys.attnum order by keys.position) as child_columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality as keys(attnum, position) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = keys.attnum order by keys.position) as parent_columns,
    c.confdeltype::text as delete_type
  from pg_constraint c where c.conname = expected.constraint_name
) actual on true;

select ok(
  not exists (
    select 1
    from (values
      ('menus','menus'),
      ('menu_target_members','menus'), ('menu_target_members','household_members'),
      ('generation_pantry_selections','menus'), ('generation_pantry_selections','pantry_items'),
      ('dishes','menus'), ('dish_ingredients','dishes'),
      ('dish_ingredients','generation_pantry_selections'), ('recipe_steps','dishes'),
      ('menu_timeline_steps','menus'), ('menu_timeline_steps','dishes'),
      ('menu_timeline_steps','recipe_steps'), ('menu_member_adaptations','dishes'),
      ('menu_member_adaptations','recipe_steps'), ('menu_member_adaptations','menu_target_members'),
      ('menu_safety_actions','menus'), ('menu_safety_actions','dishes'),
      ('menu_safety_actions','dish_ingredients'), ('menu_safety_actions','menu_target_members'),
      ('menu_safety_actions','recipe_steps'), ('menu_safety_actions','menu_member_adaptations'),
      ('menu_label_confirmations','menus'), ('menu_label_confirmations','menu_target_members')
    ) pairs(child_table, parent_table)
    where (select count(*) from pg_constraint c
      where c.contype = 'f' and c.conrelid = format('public.%I', child_table)::regclass
        and c.confrelid = format('public.%I', parent_table)::regclass) <> 1
  ),
  'every child and parent pair has one unambiguous relationship'
);

select throws_ok(
  $$insert into public.dishes (menu_id,user_id,role,position,name,description,cooking_time_minutes) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','side',2,'越境','越境',1)$$,
  '23503', null, 'dish cannot cross owners'
);
select throws_ok(
  $$insert into public.menu_target_members (menu_id,user_id,household_member_id,household_member_user_id,anonymous_ref,member_display_name_snapshot) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','member_2','越境')$$,
  '23503', null, 'target member cannot cross owners through a forged owner pair'
);
select throws_ok(
  $$insert into public.generation_pantry_selections (menu_id,user_id,pantry_item_id,pantry_name_snapshot,priority,idempotency_key,usage_status) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','越境','prefer_use',gen_random_uuid(),'used')$$,
  '23503', null, 'pantry selection cannot cross owners through a forged owner pair'
);
select throws_ok(
  $$insert into public.dish_ingredients (menu_id,dish_id,user_id,position,name,quantity_text,store_section) values ('40000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',2,'越境','1個','other')$$,
  '23503', null, 'ingredient cannot cross dish owners'
);
select throws_ok(
  $$insert into public.menu_timeline_steps (menu_id,user_id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',2,0,1,'越境','42000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000002')$$,
  '23503', null, 'timeline cannot cross recipe-step owners'
);
select throws_ok(
  $$insert into public.menu_member_adaptations (menu_id,dish_id,user_id,anonymous_member_ref,portion_text,branch_before_recipe_step_id,serving_check) values ('40000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','member_2','通常量','44000000-0000-0000-0000-000000000001','確認')$$,
  '23503', null, 'adaptation requires a target member from the same menu and owner'
);
select throws_ok(
  $$insert into public.menu_safety_actions (menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,before_recipe_step_id,position,kind,instruction) values ('40000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','member_1','44000000-0000-0000-0000-000000000001',2,'cut_small','小さく切る')$$,
  '23503', null, 'safety action requires an ingredient from the same graph'
);
select throws_ok(
  format(
    $$insert into public.menu_label_confirmations (menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',%L,%L::uuid,%L,'越境','egg','member_1','dict-v1',repeat('a',64))$$,
    source_type, source_id, 'foreign.' || source_type
  ),
  '23503', 'menu_label_source_owner_mismatch',
  format('%s label source cannot belong to another menu or owner', source_type)
)
from (values
  ('dish', '42000000-0000-0000-0000-000000000002'),
  ('ingredient', '43000000-0000-0000-0000-000000000002'),
  ('recipe_step', '44000000-0000-0000-0000-000000000002'),
  ('adaptation', '46000000-0000-0000-0000-000000000002'),
  ('timeline', '45000000-0000-0000-0000-000000000002')
) as foreign_sources(source_type, source_id);
select throws_ok(
  $$update public.menu_label_confirmations set source_id = '43000000-0000-0000-0000-000000000002' where id = '48100000-0000-0000-0000-000000000001'$$,
  '23503', 'menu_label_source_owner_mismatch',
  'label source ownership is rechecked when source identity changes'
);

select throws_ok(
  $$insert into public.menus (user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason,change_reason_custom) values ('10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1',gen_random_uuid(),'40000000-0000-0000-0000-000000000001','custom',' ')$$,
  '23514', null, 'custom change reason rejects blank detail'
);
select throws_ok(
  $$insert into public.menus (user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,change_reason) values ('10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1',gen_random_uuid(),'simpler')$$,
  '23514', null, 'root menu rejects a change reason'
);
select throws_ok(
  $$insert into public.menus (user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id) values ('10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1',gen_random_uuid(),'40000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'derived menu requires a change reason'
);
select throws_ok(
  $$insert into public.menus (user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason,change_reason_custom) values ('10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1',gen_random_uuid(),'40000000-0000-0000-0000-000000000001','simpler','余計')$$,
  '23514', null, 'non-custom derived menu rejects custom detail'
);
select lives_ok(
  $$insert into public.menus (id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason) values ('49000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','simpler')$$,
  'derived menu accepts a non-custom reason without detail'
);
delete from public.menus where id = '49000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.menus (id,user_id,meal_type,cuisine_genre,servings,total_elapsed_minutes,preference_snapshot,safety_snapshot,safety_fingerprint,allergen_dictionary_version,food_safety_rule_version,output_schema_version,derivation_group_id,parent_menu_id,change_reason,change_reason_custom) values ('49000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','dinner','japanese',2,30,'{}','{}',repeat('a',64),'dict-v1','rule-v1','schema-v1','40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','custom','食材変更')$$,
  'custom derived menu accepts canonical detail'
);
delete from public.menus where id = '49000000-0000-0000-0000-000000000002';

select throws_ok(
  $$insert into public.generation_pantry_selections (menu_id,user_id,pantry_name_snapshot,priority,idempotency_key,usage_status,planned_quantity,inventory_quantity_snapshot) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','不足','prefer_use',gen_random_uuid(),'used',2,1)$$,
  '23514', null, 'shortage is required when both quantities exist'
);
select throws_ok(
  $$insert into public.generation_pantry_selections (menu_id,user_id,pantry_name_snapshot,priority,idempotency_key,usage_status,planned_quantity,shortage_quantity) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','余剰','prefer_use',gen_random_uuid(),'used',2,1)$$,
  '23514', null, 'shortage is forbidden when either quantity is null'
);
select throws_ok(
  $$insert into public.menu_timeline_steps (menu_id,user_id,position,start_minute,duration_minutes,instruction,recipe_step_id) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',2,0,1,'不正','44000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'timeline recipe step requires a dish'
);
select throws_ok(
  $$insert into public.menu_safety_actions (menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,before_recipe_step_id,position,kind,instruction) values ('40000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','member_1','44000000-0000-0000-0000-000000000001',2,'unknown','確認')$$,
  '23514', null, 'safety action rejects an unknown kind'
);
select throws_ok(
  $$insert into public.menu_safety_actions (menu_id,dish_id,ingredient_id,user_id,anonymous_member_ref,before_recipe_step_id,position,kind,instruction) values ('40000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','member_1','44000000-0000-0000-0000-000000000001',2,'cut_small',' ')$$,
  '23514', null, 'safety action rejects a blank instruction'
);
select throws_ok(
  $$insert into public.menu_label_confirmations (menu_id,user_id,source_type,source_id,source_path,source_text_snapshot,allergen_id,anonymous_member_ref,dictionary_version,requirement_safety_fingerprint,confirmation_status,confirmed_at,confirmed_by) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','dish','42000000-0000-0000-0000-000000000001','dishes.0.description','卵の主菜','egg','member_1','dict-v1',repeat('a',64),'confirmed',now(),'10000000-0000-0000-0000-000000000002')$$,
  '23514', null, 'confirmed provenance actor must equal the row owner'
);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.menus), 1, 'owner sees exactly its menu');
select is((select count(*)::integer from public.menu_target_members), 1, 'owner sees exactly its target');
select is((select count(*)::integer from public.generation_pantry_selections), 1, 'owner sees exactly its pantry selection');
select is((select count(*)::integer from public.dishes), 1, 'owner sees exactly its dish');
select is((select count(*)::integer from public.dish_ingredients), 1, 'owner sees exactly its ingredient');
select is((select count(*)::integer from public.recipe_steps), 1, 'owner sees exactly its recipe step');
select is((select count(*)::integer from public.menu_timeline_steps), 1, 'owner sees exactly its timeline step');
select is((select count(*)::integer from public.menu_member_adaptations), 1, 'owner sees exactly its adaptation');
select is((select count(*)::integer from public.menu_safety_actions), 1, 'owner sees exactly its safety action');
select is((select count(*)::integer from public.menu_label_confirmations), 5, 'owner sees only its five label sources');

update public.menus set is_favorite = true where id = '40000000-0000-0000-0000-000000000001';
select is((select is_favorite from public.menus where id = '40000000-0000-0000-0000-000000000001'), true, 'owner can favorite its menu');
with changed as (
  update public.menus set is_favorite = true where id = '40000000-0000-0000-0000-000000000002' returning 1
) select is((select count(*)::integer from changed), 0, 'owner cannot favorite another menu');
select throws_ok(
  $$update public.menu_label_confirmations set confirmation_status = 'confirmed' where id = '48000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'direct confirmation update is denied'
);

reset role;
delete from public.household_members where id = '20000000-0000-0000-0000-000000000001';
select ok(
  (select household_member_id is null and household_member_user_id is null
    and member_display_name_snapshot = '一郎'
   from public.menu_target_members where id = '40100000-0000-0000-0000-000000000001'),
  'member deletion nulls only the live link and preserves the display snapshot'
);
select ok(
  exists(select 1 from public.menu_member_adaptations where id = '46000000-0000-0000-0000-000000000001')
  and exists(select 1 from public.menu_safety_actions where id = '47000000-0000-0000-0000-000000000001')
  and exists(select 1 from public.menu_label_confirmations where id = '48000000-0000-0000-0000-000000000001'),
  'member deletion preserves adaptations, safety actions, and label history'
);

delete from public.pantry_items where id = '30000000-0000-0000-0000-000000000001';
select ok(
  (select pantry_item_id is null from public.generation_pantry_selections where id = '41000000-0000-0000-0000-000000000001')
  and exists(select 1 from public.dish_ingredients where id = '43000000-0000-0000-0000-000000000001'),
  'pantry deletion unlinks live inventory while preserving selection and ingredient history'
);

delete from public.menus where id = '40000000-0000-0000-0000-000000000001';
select ok(
  not exists(select 1 from public.menu_target_members where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.generation_pantry_selections where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.dishes where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.dish_ingredients where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.recipe_steps where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.menu_timeline_steps where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.menu_member_adaptations where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.menu_safety_actions where user_id = '10000000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.menu_label_confirmations where user_id = '10000000-0000-0000-0000-000000000001'),
  'root menu deletion cascades through all nine child tables'
);
select ok(
  exists(select 1 from public.menus where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.menu_target_members where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.generation_pantry_selections where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.dishes where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.dish_ingredients where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.recipe_steps where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.menu_timeline_steps where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.menu_member_adaptations where user_id = '10000000-0000-0000-0000-000000000002')
  and exists(select 1 from public.menu_safety_actions where user_id = '10000000-0000-0000-0000-000000000002')
  and (select count(*) = 5 from public.menu_label_confirmations where user_id = '10000000-0000-0000-0000-000000000002'),
  'another owner entire graph survives unrelated root deletion'
);

select * from finish();
rollback;
