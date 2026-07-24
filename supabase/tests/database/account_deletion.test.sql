begin;
select plan(4);

select is_empty(
  $$
    with expected(table_name) as (values
      ('profiles'),('household_members'),('member_allergies'),('member_dislikes'),
      ('privacy_consents'),('pantry_items'),('generation_drafts'),('menus'),
      ('menu_target_members'),('generation_pantry_selections'),('dishes'),
      ('dish_ingredients'),('recipe_steps'),('menu_timeline_steps'),
      ('menu_member_adaptations'),('menu_safety_actions'),('menu_label_confirmations'),('menu_revalidations'),
      ('shopping_lists'),('shopping_list_sources'),('shopping_items'),
      ('shopping_item_sources'),('shopping_label_confirmations'),
      ('shopping_current_label_warnings')
    )
    select expected.table_name
    from expected
    left join information_schema.columns column_info
      on column_info.table_schema = 'public'
     and column_info.table_name = expected.table_name
     and column_info.column_name = 'user_id'
    where column_info.column_name is null
  $$,
  'every expected public relation has user_id'
);

-- Reverse inventory: any public base table with user_id must appear in expected.
-- A new user-owned table that is missing from the list must fail even if it already cascades.
select is_empty(
  $$
    with expected(table_name) as (values
      ('profiles'),('household_members'),('member_allergies'),('member_dislikes'),
      ('privacy_consents'),('pantry_items'),('generation_drafts'),('menus'),
      ('menu_target_members'),('generation_pantry_selections'),('dishes'),
      ('dish_ingredients'),('recipe_steps'),('menu_timeline_steps'),
      ('menu_member_adaptations'),('menu_safety_actions'),('menu_label_confirmations'),('menu_revalidations'),
      ('shopping_lists'),('shopping_list_sources'),('shopping_items'),
      ('shopping_item_sources'),('shopping_label_confirmations'),
      ('shopping_current_label_warnings')
    )
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'user_id'
     and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from expected e where e.table_name = c.relname)
    order by 1
  $$,
  'no unexpected public user_id relation outside the account-deletion inventory'
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

-- 行動アサーション: 制約形状だけでなく、auth.users 削除が cascade で
-- 所有グラフ（public.profiles / private 台帳 / Plan 7 snapshot）を消すことを証明する。
-- profiles 行は on_auth_user_created トリガで自動作成される。
do $seed$
declare
  v_user_id uuid := 'e1000000-0000-4000-8000-000000000001';
  v_request_id uuid := 'e2000000-0000-4000-8000-000000000001';
  v_source_menu_id uuid := 'e3000000-0000-4000-8000-000000000001';
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'account-deletion-cascade@example.test'
  );

  insert into private.ai_generation_requests (
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    failure_code, started_at, completed_at
  ) values (
    v_request_id,
    v_user_id,
    'e2000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'failed',
    'generation-command.v2',
    repeat('c', 64),
    date '2026-07-11',
    'generation_timeout',
    '2026-07-11 00:00:00+00',
    '2026-07-11 00:00:01+00'
  );

  -- idea モードは target_member_ids が空配列。複合 FK は app 関係へ、
  -- 単一列 Auth cascade は本マイグレーションが追加する。
  insert into private.generation_regeneration_snapshots (
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    v_request_id,
    v_user_id,
    'regenerate_menu',
    v_source_menu_id,
    1,
    null,
    'idea',
    2,
    '{}'::uuid[]
  );

  delete from auth.users where id = v_user_id;
end;
$seed$;

select is_empty(
  $$
    select src from (
      select 'profiles' as src
      from public.profiles
      where user_id = 'e1000000-0000-4000-8000-000000000001'
      union all
      select 'ai_generation_requests'
      from private.ai_generation_requests
      where user_id = 'e1000000-0000-4000-8000-000000000001'
      union all
      select 'generation_regeneration_snapshots'
      from private.generation_regeneration_snapshots
      where user_id = 'e1000000-0000-4000-8000-000000000001'
    ) leftover
  $$,
  'deleting auth user cascades owned profiles, generation requests, and regeneration snapshots'
);

select * from finish();
rollback;
