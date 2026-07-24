\ir 000_helpers.sql
-- =============================================================================
-- Plan 7 Task 4/8: owner 単位 processing 制約を dblink の別バックエンド session で検証する。
-- 同一 owner の processing v2 があるとき、別 key の new/whole/dish 予約はすべて
-- generation_in_progress となり request / quota / attempt / snapshot を増やさない。
-- dblink セッションは autocommit でコミット済み processing 行を観測する。
-- Task 8: 予約後の source 変更/削除を pre-send / post-send で検証し、
-- source_menu_changed・attempt 返却/消費・success 非消費・menu 0 を固定する。
-- =============================================================================
select plan(20);

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

-- 同一 key replay は保存済み processing を返し、request/quota/attempt/snapshot を増やさない
select is(
  (
    select jsonb_build_object(
      'status', payload->>'status',
      'replayed', payload->>'replayed',
      'request_id', payload->>'request_id'
    )
    from extensions.dblink(
      (select connstr from race_dblink_conn),
      $sql$
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
          '2026-07-22 00:00:05+00'
        ) as payload
      $sql$
    ) as t(payload jsonb)
  ),
  (
    select jsonb_build_object(
      'status', 'processing',
      'replayed', 'true',
      'request_id', id::text
    )
    from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000101'
      and idempotency_key = 'c9000000-0000-4000-8000-000000000001'
  ),
  'same-key replay returns saved processing status without a new reservation'
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
  'same-key replay does not add request, quota, attempt, or snapshot rows'
);

-- =============================================================================
-- Task 8 Step 3: whole/dish 再生成の予約後 source 変更・削除
-- pre-send: mark_ai_global_sent 前に fail → attempt 返却 / success 非消費 / menu 0
-- post-send: mark 後に source 削除して finalize_success → source_menu_changed /
--            attempt 消費済み / success 非消費 / menu 0
-- =============================================================================

-- owner1 の processing を解放してから source race 用の予約を始める
select public.finalize_ai_generation_failure(
  (
    select id from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000101'
      and status = 'processing'
    limit 1
  ),
  'internal_error', null, '2026-07-22 00:10:00+00'
);

-- ソースメニューと料理を再確保（前段 fixture を再利用）
-- owner2 の processing も解放
select public.finalize_ai_generation_failure(
  (
    select id from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000102'
      and status = 'processing'
    limit 1
  ),
  'internal_error', null, '2026-07-22 00:10:01+00'
);

-- ---- PRE-SEND regenerate_menu: 予約後 source 削除 → fail(source_menu_changed) ----
create temporary table source_race_pre_menu as
select
  (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_reserved,
  (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_success,
  (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_reserved,
  (select coalesce(sum(sent_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_sent,
  (select count(*) from public.menus
    where user_id = 'c1000000-0000-4000-8000-000000000101') as menus;

select is(
  (
    select public.reserve_ai_generation(
      'c1000000-0000-4000-8000-000000000101',
      'c9000000-0000-4000-8000-000000000011',
      'regenerate_menu',
      null, null,
      'c4000000-0000-4000-8000-000000000101',
      null, 'simpler',
      'generation-command.v2',
      repeat('a', 64),
      '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
      5, 45, 180,
      '2026-07-22 00:11:00+00'
    )->>'status'
  ),
  'processing',
  'pre-send regenerate_menu reserve succeeds'
);

-- 予約後・送信前に source を削除（service の load が source_menu_changed になる状態）
delete from public.menu_target_members
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.dishes
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.menus
  where id = 'c4000000-0000-4000-8000-000000000101';

-- pre-send fail: attempt は未送信のため返却、success は消費しない
select is(
  (
    select jsonb_build_object(
      'status', payload->>'status',
      'failure_code', payload->>'failure_code',
      -- failed 応答の consumed は false 相当（null または false 文字列）
      'consumed_false', coalesce(payload->>'consumed', 'false') = 'false'
    )
    from (
      select public.finalize_ai_generation_failure(
        (
          select id from private.ai_generation_requests
          where idempotency_key = 'c9000000-0000-4000-8000-000000000011'
        ),
        'source_menu_changed', null, '2026-07-22 00:11:05+00'
      ) as payload
    ) t
  ),
  jsonb_build_object(
    'status', 'failed',
    'failure_code', 'source_menu_changed',
    'consumed_false', true
  ),
  'pre-send regenerate_menu source delete fails with source_menu_changed and success non-consume'
);

select is(
  (
    select jsonb_build_object(
      'user_reserved', (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'user_success', (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_reserved', (select coalesce(sum(reserved_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_sent', (select coalesce(sum(sent_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'menus', (select count(*) from public.menus
        where user_id = 'c1000000-0000-4000-8000-000000000101')
    )
  ),
  (
    select jsonb_build_object(
      'user_reserved', user_reserved,
      'user_success', user_success,
      'attempt_reserved', attempt_reserved,
      'attempt_sent', attempt_sent,
      'menus', menus - 1
    )
    from source_race_pre_menu
  ),
  'pre-send source_menu_changed returns attempt reservation, does not consume success, menu delta only source delete'
);

-- ソースを再作成（post-send と dish 用）
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

-- ---- POST-SEND regenerate_menu: mark 後 source version 変更 → finalize_success ----
create temporary table source_race_post_menu as
select
  (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_reserved,
  (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_success,
  (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_reserved,
  (select coalesce(sum(sent_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_sent,
  (select count(*) from public.menus
    where user_id = 'c1000000-0000-4000-8000-000000000101') as menus;

select is(
  (
    select public.reserve_ai_generation(
      'c1000000-0000-4000-8000-000000000101',
      'c9000000-0000-4000-8000-000000000012',
      'regenerate_menu',
      null, null,
      'c4000000-0000-4000-8000-000000000101',
      null, 'simpler',
      'generation-command.v2',
      repeat('b', 64),
      '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
      5, 45, 180,
      '2026-07-22 00:12:00+00'
    )->>'status'
  ),
  'processing',
  'post-send regenerate_menu reserve succeeds'
);

select is(
  (
    select public.mark_ai_global_sent(
      (
        select id from private.ai_generation_requests
        where idempotency_key = 'c9000000-0000-4000-8000-000000000012'
      ),
      '2026-07-22 00:12:01+00'
    )->>'sent'
  ),
  'true',
  'post-send regenerate_menu markSent converts attempt to sent'
);

-- 送信後に source version をずらす（FOR SHARE owner+version 不一致）
update public.menus
set version = 2
where id = 'c4000000-0000-4000-8000-000000000101';

select is(
  (
    select jsonb_build_object(
      'status', payload->>'status',
      'failure_code', payload->>'failure_code',
      'consumed_false', coalesce(payload->>'consumed', 'false') = 'false'
    )
    from (
      select public.finalize_ai_generation_success(
        (
          select id from private.ai_generation_requests
          where idempotency_key = 'c9000000-0000-4000-8000-000000000012'
        ),
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
        repeat('f', 64), 'allergens-v1', 'food-v1',
        '[]'::jsonb, '[]'::jsonb,
        'c4000000-0000-4000-8000-000000000101', 'simpler', null,
        '2026-07-22 00:12:05+00'
      ) as payload
    ) t
  ),
  jsonb_build_object(
    'status', 'failed',
    'failure_code', 'source_menu_changed',
    'consumed_false', true
  ),
  'post-send regenerate_menu source version change finalizes as source_menu_changed without success consume'
);

select is(
  (
    select jsonb_build_object(
      'user_success', (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_sent', (select coalesce(sum(sent_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'menus_delta', (
        (select count(*) from public.menus
          where user_id = 'c1000000-0000-4000-8000-000000000101')
        - (select menus from source_race_post_menu)
      )
    )
  ),
  jsonb_build_object(
    'user_success', (select user_success from source_race_post_menu),
    'attempt_sent', (select attempt_sent + 1 from source_race_post_menu),
    'menus_delta', 0
  ),
  'post-send source_menu_changed keeps attempt consumed, success non-consume, menu 0'
);

-- version を戻して dish 経路へ
update public.menus
set version = 1
where id = 'c4000000-0000-4000-8000-000000000101';

-- ---- PRE-SEND regenerate_dish: 予約後 source 削除 ----
create temporary table source_race_pre_dish as
select
  (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_success,
  (select coalesce(sum(reserved_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_reserved,
  (select coalesce(sum(sent_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_sent,
  (select count(*) from public.menus
    where user_id = 'c1000000-0000-4000-8000-000000000101') as menus;

select is(
  (
    select public.reserve_ai_generation(
      'c1000000-0000-4000-8000-000000000101',
      'c9000000-0000-4000-8000-000000000013',
      'regenerate_dish',
      null, null,
      'c4000000-0000-4000-8000-000000000101',
      'c8000000-0000-4000-8000-000000000101',
      'simpler',
      'generation-command.v2',
      repeat('c', 64),
      '{"kind":"regenerate_dish","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
      5, 45, 180,
      '2026-07-22 00:13:00+00'
    )->>'status'
  ),
  'processing',
  'pre-send regenerate_dish reserve succeeds'
);

delete from public.menu_target_members
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.dishes
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.menus
  where id = 'c4000000-0000-4000-8000-000000000101';

select is(
  (
    select jsonb_build_object(
      'status', payload->>'status',
      'failure_code', payload->>'failure_code'
    )
    from (
      select public.finalize_ai_generation_failure(
        (
          select id from private.ai_generation_requests
          where idempotency_key = 'c9000000-0000-4000-8000-000000000013'
        ),
        'source_menu_changed', null, '2026-07-22 00:13:05+00'
      ) as payload
    ) t
  ),
  jsonb_build_object(
    'status', 'failed',
    'failure_code', 'source_menu_changed'
  ),
  'pre-send regenerate_dish source delete fails with source_menu_changed'
);

select is(
  (
    select jsonb_build_object(
      'user_success', (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_reserved', (select coalesce(sum(reserved_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_sent', (select coalesce(sum(sent_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'menus', (select count(*) from public.menus
        where user_id = 'c1000000-0000-4000-8000-000000000101')
    )
  ),
  (
    select jsonb_build_object(
      'user_success', user_success,
      'attempt_reserved', attempt_reserved,
      'attempt_sent', attempt_sent,
      'menus', menus - 1
    )
    from source_race_pre_dish
  ),
  'pre-send dish source_menu_changed returns attempt, success non-consume, menu only source delete'
);

-- dish post-send 用に source 再作成
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
  ('c6000000-0000-4000-8000-000000000102', 'c4000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'c2000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'member_1', '子ども1');

insert into public.dishes (
  id, menu_id, user_id, role, position, name, description, cooking_time_minutes
) values
  ('c8000000-0000-4000-8000-000000000101', 'c4000000-0000-4000-8000-000000000101',
    'c1000000-0000-4000-8000-000000000101', 'main', 1, '煮物', 'race検証用の煮物です', 20);

-- ---- POST-SEND regenerate_dish: mark 後 source 削除 → finalize_success ----
create temporary table source_race_post_dish as
select
  (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
    where user_id = 'c1000000-0000-4000-8000-000000000101') as user_success,
  (select coalesce(sum(sent_count), 0) from private.ai_user_daily_external_attempts
    where user_id = 'c1000000-0000-4000-8000-000000000101') as attempt_sent,
  (select count(*) from public.menus
    where user_id = 'c1000000-0000-4000-8000-000000000101') as menus;

select is(
  (
    select public.reserve_ai_generation(
      'c1000000-0000-4000-8000-000000000101',
      'c9000000-0000-4000-8000-000000000014',
      'regenerate_dish',
      null, null,
      'c4000000-0000-4000-8000-000000000101',
      'c8000000-0000-4000-8000-000000000101',
      'simpler',
      'generation-command.v2',
      repeat('d', 64),
      '{"kind":"regenerate_dish","target_mode":"household","servings":2,"target_member_ids":["c2000000-0000-4000-8000-000000000101"],"source_menu_version":1}'::jsonb,
      5, 45, 180,
      '2026-07-22 00:14:00+00'
    )->>'status'
  ),
  'processing',
  'post-send regenerate_dish reserve succeeds'
);

select ok(
  (
    select public.mark_ai_global_sent(
      (
        select id from private.ai_generation_requests
        where idempotency_key = 'c9000000-0000-4000-8000-000000000014'
      ),
      '2026-07-22 00:14:01+00'
    )->>'sent' = 'true'
  ),
  'post-send regenerate_dish markSent succeeds'
);

delete from public.menu_target_members
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.dishes
  where menu_id = 'c4000000-0000-4000-8000-000000000101';
delete from public.menus
  where id = 'c4000000-0000-4000-8000-000000000101';

select is(
  (
    select jsonb_build_object(
      'status', payload->>'status',
      'failure_code', payload->>'failure_code',
      'user_success', (select coalesce(sum(success_count), 0) from private.ai_user_daily_usage
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'attempt_sent', (select coalesce(sum(sent_count), 0)
        from private.ai_user_daily_external_attempts
        where user_id = 'c1000000-0000-4000-8000-000000000101'),
      'menus_delta', (
        (select count(*) from public.menus
          where user_id = 'c1000000-0000-4000-8000-000000000101')
        - (select menus from source_race_post_dish)
      )
    )
    from (
      select public.finalize_ai_generation_success(
        (
          select id from private.ai_generation_requests
          where idempotency_key = 'c9000000-0000-4000-8000-000000000014'
        ),
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
        repeat('f', 64), 'allergens-v1', 'food-v1',
        '[]'::jsonb, '[]'::jsonb,
        'c4000000-0000-4000-8000-000000000101', 'simpler', null,
        '2026-07-22 00:14:05+00'
      ) as payload
    ) t
  ),
  jsonb_build_object(
    'status', 'failed',
    'failure_code', 'source_menu_changed',
    'user_success', (select user_success from source_race_post_dish),
    'attempt_sent', (select attempt_sent + 1 from source_race_post_dish),
    'menus_delta', -1
  ),
  'post-send regenerate_dish source delete: source_menu_changed, attempt consumed, success non-consume, no new menu'
);

-- cleanup
delete from auth.users where id in (
  'c1000000-0000-4000-8000-000000000101',
  'c1000000-0000-4000-8000-000000000102'
);

select * from finish();
