\ir 000_helpers.sql
-- =============================================================================
-- Plan 7 Task 4: owner 単位 processing 制約を dblink の別バックエンド session で検証する。
-- 同一 owner の processing v2 があるとき、別 key の new/whole/dish 予約はすべて
-- generation_in_progress となり request / quota / attempt / snapshot を増やさない。
-- dblink セッションは autocommit でコミット済み processing 行を観測する。
-- =============================================================================
select plan(5);

delete from auth.users where id in (
  'c1000000-0000-4000-8000-000000000101',
  'c1000000-0000-4000-8000-000000000102'
);

do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'generation_pgtap_dblink_test') then
    create role generation_pgtap_dblink_test with login password 'generation_pgtap_dblink_test_only'
      nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end;
$block$;
revoke all on schema public from generation_pgtap_dblink_test;
grant usage on schema public to generation_pgtap_dblink_test;
-- service_role 相当の reserve は SECURITY DEFINER のため EXECUTE だけ付与する
grant execute on function public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text, text, text, jsonb, integer, integer, integer, timestamptz
) to generation_pgtap_dblink_test;

insert into auth.users (id, instance_id, aud, role, email) values
  ('c1000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gen-race-owner-1@example.test'),
  ('c1000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gen-race-owner-2@example.test');

insert into public.household_members (
  id, user_id, status, display_name, age_band, portion_size, spice_level,
  allergy_status, unsupported_diet_status
) values
  ('c2000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000101',
    'complete', '子ども1', 'age_6_8', 'regular', 'mild', 'none', 'none'),
  ('c2000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000102',
    'complete', '子ども2', 'age_6_8', 'regular', 'mild', 'none', 'none');

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
  servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values
  ('c3000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000101',
    'dinner', array['鶏肉'], 'japanese', 'household',
    array['c2000000-0000-4000-8000-000000000101'::uuid],
    null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1),
  ('c3000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-000000000102',
    'dinner', array['豆腐'], 'japanese', 'household',
    array['c2000000-0000-4000-8000-000000000102'::uuid],
    null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values
  ('c4000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-000000000101',
    'dinner', 'japanese', 2, 30, '{}', '{}', repeat('a', 64), 'household',
    'allergens-v1', 'food-v1', 'menu-v1', 'c5000000-0000-4000-8000-000000000101', 1);

insert into public.menu_target_members (
  id, menu_id, user_id, household_member_id, household_member_user_id,
  anonymous_ref, member_display_name_snapshot
) values
  ('c6000000-0000-4000-8000-000000000101', 'c4000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'c2000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'member_1', '子ども1');

insert into public.dishes (
  id, menu_id, user_id, role, position, name, description, cooking_time_minutes
) values
  ('c8000000-0000-4000-8000-000000000101', 'c4000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'main', 1, '煮物', 'race検証用の煮物です', 20);

-- owner1 に processing 予約を作る（このファイルは begin を開かないので autocommit）
select public.reserve_ai_generation(
  'c1000000-0000-4000-8000-000000000101',
  'c9000000-0000-4000-8000-000000000001',
  'new_menu',
  'c3000000-0000-4000-8000-000000000101',
  1,
  null, null, null,
  'generation-command.v2',
  repeat('1', 64),
  '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":null}'::jsonb,
  5, 45, 180,
  '2026-07-22 00:00:00+00'
);

-- 件数ベースライン
create temporary table race_baseline as
select
  (select count(*) from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000101') as requests,
  (select coalesce(sum(reserved_count),0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_reserved,
  (select coalesce(sum(reserved_count),0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_reserved,
  (select count(*) from private.generation_regeneration_snapshots
    where user_id = 'c1000000-0000-4000-8000-000000000101') as snapshots;

-- dblink 用接続文字列（別バックエンド session）
create temporary table race_dblink_conn as
select
  'host=db port=5432 dbname=postgres user=generation_pgtap_dblink_test password=generation_pgtap_dblink_test_only'
    as connstr;

-- 別 session から new_menu を予約 → generation_in_progress
select is(
  (
    select failure_code
    from extensions.dblink(
      (select connstr from race_dblink_conn),
      $sql$
        select public.reserve_ai_generation(
          'c1000000-0000-4000-8000-000000000101',
          'c9000000-0000-4000-8000-000000000002',
          'new_menu',
          'c3000000-0000-4000-8000-000000000101',
          1,
          null, null, null,
          'generation-command.v2',
          repeat('2', 64),
          '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":null}'::jsonb,
          5, 45, 180,
          '2026-07-22 00:00:01+00'
        )->>'failure_code'
      $sql$
    ) as t(failure_code text)
  ),
  'generation_in_progress',
  'other-session new_menu under processing is generation_in_progress'
);

-- 別 session から regenerate_menu
select is(
  (
    select failure_code
    from extensions.dblink(
      (select connstr from race_dblink_conn),
      $sql$
        select public.reserve_ai_generation(
          'c1000000-0000-4000-8000-000000000101',
          'c9000000-0000-4000-8000-000000000003',
          'regenerate_menu',
          null, null,
          'c4000000-0000-4000-8000-000000000101',
          null, 'simpler',
          'generation-command.v2',
          repeat('3', 64),
          '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
          5, 45, 180,
          '2026-07-22 00:00:02+00'
        )->>'failure_code'
      $sql$
    ) as t(failure_code text)
  ),
  'generation_in_progress',
  'other-session regenerate_menu under processing is generation_in_progress'
);

-- 別 session から regenerate_dish
select is(
  (
    select failure_code
    from extensions.dblink(
      (select connstr from race_dblink_conn),
      $sql$
        select public.reserve_ai_generation(
          'c1000000-0000-4000-8000-000000000101',
          'c9000000-0000-4000-8000-000000000004',
          'regenerate_dish',
          null, null,
          'c4000000-0000-4000-8000-000000000101',
          'c8000000-0000-4000-8000-000000000101',
          'simpler',
          'generation-command.v2',
          repeat('4', 64),
          '{"kind":"regenerate_dish","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
          5, 45, 180,
          '2026-07-22 00:00:03+00'
        )->>'failure_code'
      $sql$
    ) as t(failure_code text)
  ),
  'generation_in_progress',
  'other-session regenerate_dish under processing is generation_in_progress'
);

select is(
  (
    select jsonb_build_object(
      'requests', (select count(*) from private.ai_generation_requests
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'user_reserved', (select coalesce(sum(reserved_count),0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_reserved', (select coalesce(sum(reserved_count),0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'snapshots', (select count(*) from private.generation_regeneration_snapshots
        where user_id = 'c1000000-0000-4000-8000-000000000101')
    )
  ),
  (
    select jsonb_build_object(
      'requests', requests,
      'user_reserved', user_reserved,
      'attempt_reserved', attempt_reserved,
      'snapshots', snapshots
    )
    from race_baseline
  ),
  'generation_in_progress from other sessions does not add request, quota, attempt, or snapshot rows'
);

-- 別 owner は独立して予約できる（これも dblink の別 session から）
select is(
  (
    select status
    from extensions.dblink(
      (select connstr from race_dblink_conn),
      $sql$
        select public.reserve_ai_generation(
          'c1000000-0000-4000-8000-000000000102',
          'c9000000-0000-4000-8000-000000000005',
          'new_menu',
          'c3000000-0000-4000-8000-000000000102',
          1,
          null, null, null,
          'generation-command.v2',
          repeat('5', 64),
          '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["c2000000-0000-4000-8000-000000000102"],"source_menu_version":null}'::jsonb,
          5, 45, 180,
          '2026-07-22 00:00:04+00'
        )->>'status'
      $sql$
    ) as t(status text)
  ),
  'processing',
  'a different owner can reserve independently from another session'
);

-- cleanup
delete from auth.users where id in (
  'c1000000-0000-4000-8000-000000000101',
  'c1000000-0000-4000-8000-000000000102'
);

select * from finish();
