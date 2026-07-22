\ir 000_helpers.sql
begin;
select plan(46);

select has_table('public', 'menus', 'menus exists');
select has_table('public', 'menu_target_members', 'menu_target_members exists');
select has_table('public', 'generation_pantry_selections', 'generation_pantry_selections exists');
select has_table('public', 'dishes', 'dishes exists');
select has_table('public', 'dish_ingredients', 'dish_ingredients exists');
select has_table('public', 'recipe_steps', 'recipe_steps exists');
select has_table('public', 'menu_timeline_steps', 'menu_timeline_steps exists');
select has_table('public', 'menu_member_adaptations', 'menu_member_adaptations exists');
select has_table('public', 'menu_safety_actions', 'menu_safety_actions exists');
select has_table('public', 'menu_label_confirmations', 'menu_label_confirmations exists');

select has_column(
  'public', 'menu_label_confirmations', 'source_text_snapshot',
  'label confirmations preserve a human-readable source snapshot'
);
select has_column('public', 'menus', 'target_mode', 'menus records a target mode');
select col_not_null('public', 'menus', 'target_mode', 'menu target mode is not null');
select col_is_null(
  'public', 'menus', 'allergen_dictionary_version',
  'menu allergen dictionary version is mode-conditionally nullable'
);

select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menus'), 'menus has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menu_target_members'), 'menu_target_members has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'generation_pantry_selections'), 'generation_pantry_selections has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'dishes'), 'dishes has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'dish_ingredients'), 'dish_ingredients has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'recipe_steps'), 'recipe_steps has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menu_timeline_steps'), 'menu_timeline_steps has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menu_member_adaptations'), 'menu_member_adaptations has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menu_safety_actions'), 'menu_safety_actions has RLS enabled');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'menu_label_confirmations'), 'menu_label_confirmations has RLS enabled');

select ok(
  (select conkey = array[
      (select attnum from pg_attribute where attrelid = 'public.menus'::regclass and attname = 'parent_menu_id'),
      (select attnum from pg_attribute where attrelid = 'public.menus'::regclass and attname = 'user_id')
    ]::smallint[]
    and confkey = array[
      (select attnum from pg_attribute where attrelid = 'public.menus'::regclass and attname = 'id'),
      (select attnum from pg_attribute where attrelid = 'public.menus'::regclass and attname = 'user_id')
    -- Plan 4: parent 削除時は parent_menu_id だけ SET NULL（confdeltype = n）
    ]::smallint[] and confdeltype = 'n'
   from pg_constraint where conname = 'menus_parent_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_target_members'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_target_members'::regclass and confrelid = 'public.household_members'::regclass and contype = 'f')
  and (select confdeltype = 'n' from pg_constraint where conname = 'menu_target_members_member_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.generation_pantry_selections'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.generation_pantry_selections'::regclass and confrelid = 'public.pantry_items'::regclass and contype = 'f')
  and (select confdeltype = 'n' from pg_constraint where conname = 'generation_pantry_selections_item_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.dishes'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select confdeltype = 'c' from pg_constraint where conname = 'dishes_menu_owner_fkey'),
  'menu, target, pantry selection, and dish use unambiguous owner-composite delete contracts'
);

select ok(
  (select count(*) = 1 from pg_constraint where conrelid = 'public.dish_ingredients'::regclass and confrelid = 'public.dishes'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.dish_ingredients'::regclass and confrelid = 'public.generation_pantry_selections'::regclass and contype = 'f')
  and (select confdeltype = 'n' from pg_constraint where conname = 'dish_ingredients_pantry_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.recipe_steps'::regclass and confrelid = 'public.dishes'::regclass and contype = 'f')
  and (select confdeltype = 'c' from pg_constraint where conname = 'recipe_steps_dish_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_timeline_steps'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_timeline_steps'::regclass and confrelid = 'public.dishes'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_timeline_steps'::regclass and confrelid = 'public.recipe_steps'::regclass and contype = 'f')
  and (select conkey = array[
      (select attnum from pg_attribute where attrelid = 'public.menu_timeline_steps'::regclass and attname = 'recipe_step_id'),
      (select attnum from pg_attribute where attrelid = 'public.menu_timeline_steps'::regclass and attname = 'dish_id'),
      (select attnum from pg_attribute where attrelid = 'public.menu_timeline_steps'::regclass and attname = 'menu_id'),
      (select attnum from pg_attribute where attrelid = 'public.menu_timeline_steps'::regclass and attname = 'user_id')
    ]::smallint[] and confdeltype = 'c'
    from pg_constraint where conname = 'menu_timeline_steps_step_owner_fkey'),
  'ingredients, recipe steps, and timeline use exact unambiguous owner-composite relationships'
);

select ok(
  (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_member_adaptations'::regclass and confrelid = 'public.dishes'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_member_adaptations'::regclass and confrelid = 'public.recipe_steps'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_member_adaptations'::regclass and confrelid = 'public.menu_target_members'::regclass and contype = 'f')
  and (select confdeltype = 'c' from pg_constraint where conname = 'menu_member_adaptations_member_owner_fkey')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.dishes'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.dish_ingredients'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.menu_target_members'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.recipe_steps'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_safety_actions'::regclass and confrelid = 'public.menu_member_adaptations'::regclass and contype = 'f')
  and not exists (
    select 1 from pg_constraint
    where conname like 'menu_safety_actions_%_owner_fkey' and confdeltype <> 'c'
  ),
  'adaptations and every normalized safety-action edge use unambiguous cascading owner composites'
);

select ok(
  (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_label_confirmations'::regclass and confrelid = 'public.menus'::regclass and contype = 'f')
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.menu_label_confirmations'::regclass and confrelid = 'public.menu_target_members'::regclass and contype = 'f')
  and (select confdeltype = 'c' from pg_constraint where conname = 'menu_label_confirmations_member_owner_fkey')
  and exists (
    select 1 from pg_trigger
    where tgname = 'menu_label_confirmations_source_owner' and not tgisinternal and tgenabled = 'O'
  ),
  'label requirements use exact menu/member ownership and an enabled source-owner trigger'
);

select ok(has_table_privilege('authenticated', 'public.menus', 'select'), 'menus are readable');
select ok(has_column_privilege('authenticated', 'public.menus', 'is_favorite', 'update'), 'favorite is browser editable');
select ok(not has_column_privilege('authenticated', 'public.menus', 'is_selected', 'update'), 'selection is not browser editable');
select ok(not has_table_privilege('authenticated', 'public.menus', 'insert'), 'menus are finalized server-side');
select ok(not has_table_privilege('authenticated', 'public.menus', 'delete'), 'menus are deleted through an owner-checking RPC');
select ok(has_table_privilege('authenticated', 'public.menu_label_confirmations', 'select'), 'label confirmations are readable');
select ok(not has_column_privilege('authenticated', 'public.menu_label_confirmations', 'confirmation_status', 'update'), 'direct confirmation update is forbidden');
select ok(
  to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid)') is null
  and to_regprocedure('public.confirm_menu_label_confirmation(uuid,uuid,text)') is not null,
  'Plan 3 exposes sole three-argument confirmation after current-safety locking'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.confirm_menu_label_confirmation(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.confirm_menu_label_confirmation(uuid,uuid,text)',
    'execute'
  ),
  'only authenticated may execute the three-argument confirmation RPC'
);
select ok(not has_table_privilege('authenticated', 'public.menu_label_confirmations', 'insert'), 'label records are finalized server-side');
select ok(has_table_privilege('authenticated', 'public.dishes', 'select'), 'generated children are readable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'insert'), 'generated children are not insertable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'update'), 'generated children are not editable');
select ok(not has_table_privilege('authenticated', 'public.dishes', 'delete'), 'generated children are not deletable');
select ok(has_table_privilege('authenticated', 'public.menu_safety_actions', 'select'), 'owner safety actions are readable');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'insert'), 'browser cannot insert safety actions');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'update'), 'browser cannot update safety actions');
select ok(not has_table_privilege('authenticated', 'public.menu_safety_actions', 'delete'), 'browser cannot delete safety actions');

select * from finish();
rollback;
