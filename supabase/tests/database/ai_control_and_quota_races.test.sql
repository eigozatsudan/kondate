\ir 000_helpers.sql
-- =============================================================================
-- Plan 7 Task 4/8: owner 単位 processing 制約を dblink の別バックエンド session で検証する。
-- 同一 owner の processing v2 があるとき、別 key の new/whole/dish 予約はすべて
-- generation_in_progress となり request / quota / attempt / snapshot を増やさない。
-- dblink セッションは autocommit でコミット済み processing 行を観測する。
-- Task 8: 予約後の source 変更/削除を pre-send / post-send で検証し、
-- source_menu_changed・attempt 返却/消費・success 非消費・menu 0 を固定する。
-- =============================================================================
-- plan: 既存 20 + P3#5 finalize対allergy 二session 2 分岐 = 22
select plan(22);

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

-- =============================================================================
-- P3#5: finalize 対 allergy mutation の二 session 競合
-- allergy 先勝ち: finalize は constraint_conflict / current_safety_changed、
--                 menu 0、成功予約解放、送信済み attempt は消費維持
-- finalize 先勝ち: matching fingerprint で menu 1 件 success、予約/attempt 成功消費、
--                 lock 解放後に待機 allergy が commit できる（終了後 fingerprint 不一致は許容）
-- =============================================================================

-- 既存 fixture owner の processing を解放し、専用 owner を用意する
do $release_processing$
declare
  v_id uuid;
begin
  select id into v_id
  from private.ai_generation_requests
  where user_id = 'c1000000-0000-4000-8000-000000000101'
    and status = 'processing'
  limit 1;
  if v_id is not null then
    perform public.finalize_ai_generation_failure(
      v_id, 'internal_error', null, '2026-07-22 00:20:00+00'
    );
  end if;
end
$release_processing$;

delete from auth.users where id in (
  'c1000000-0000-4000-8000-000000000103',
  'c1000000-0000-4000-8000-000000000104'
);

-- allergy insert は bypassrls 付き shopping_pgtap_dblink_test を使う
-- （generation_pgtap_dblink_test は reserve EXECUTE 専用で RLS を抜けられない）

-- P3#5 用 fixture（dblink から見えるよう autocommit で先に確定）
insert into auth.users (id, instance_id, aud, role, email) values
  ('c1000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gen-race-allergy-first@example.test'),
  ('c1000000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gen-race-finalize-first@example.test');

insert into public.household_members (
  id, user_id, status, display_name, age_band, portion_size, spice_level,
  allergy_status, unsupported_diet_status
) values
  ('c2000000-0000-4000-8000-000000000103', 'c1000000-0000-4000-8000-000000000103',
    'complete', '子どもA', 'age_6_8', 'regular', 'mild', 'none', 'none'),
  ('c2000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000104',
    'complete', '子どもB', 'age_6_8', 'regular', 'mild', 'none', 'none');

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
  servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values
  ('c3000000-0000-4000-8000-000000000103', 'c1000000-0000-4000-8000-000000000103',
    'dinner', array['鶏肉'], 'japanese', 'household',
    array['c2000000-0000-4000-8000-000000000103'::uuid],
    null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1),
  ('c3000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-000000000104',
    'dinner', array['豆腐'], 'japanese', 'household',
    array['c2000000-0000-4000-8000-000000000104'::uuid],
    null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1);

-- 予約時点 fingerprint を一時表に保存（allergy 投入前）
create temporary table p3_5_fingerprints as
select
  'c1000000-0000-4000-8000-000000000103'::uuid as owner_id,
  private.current_safety_fingerprint(
    'c1000000-0000-4000-8000-000000000103',
    array['c2000000-0000-4000-8000-000000000103'::uuid]
  ) as fingerprint
union all
select
  'c1000000-0000-4000-8000-000000000104'::uuid,
  private.current_safety_fingerprint(
    'c1000000-0000-4000-8000-000000000104',
    array['c2000000-0000-4000-8000-000000000104'::uuid]
  );

select public.reserve_ai_generation(
  'c1000000-0000-4000-8000-000000000103', 'c9000000-0000-4000-8000-000000000021',
  'new_menu', 'c3000000-0000-4000-8000-000000000103', 1, null, null, null,
  'generation-command.v2', repeat('d', 64),
  '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["c2000000-0000-4000-8000-000000000103"],"source_menu_version":null}'::jsonb,
  5, 45, 180, '2026-07-22 00:21:00+00'
);
select public.mark_ai_global_sent(
  (select id from private.ai_generation_requests
    where idempotency_key = 'c9000000-0000-4000-8000-000000000021'),
  '2026-07-22 00:21:01+00'
);

select public.reserve_ai_generation(
  'c1000000-0000-4000-8000-000000000104', 'c9000000-0000-4000-8000-000000000022',
  'new_menu', 'c3000000-0000-4000-8000-000000000104', 1, null, null, null,
  'generation-command.v2', repeat('e', 64),
  '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["c2000000-0000-4000-8000-000000000104"],"source_menu_version":null}'::jsonb,
  5, 45, 180, '2026-07-22 00:22:00+00'
);
select public.mark_ai_global_sent(
  (select id from private.ai_generation_requests
    where idempotency_key = 'c9000000-0000-4000-8000-000000000022'),
  '2026-07-22 00:22:01+00'
);

-- ---- Branch A: allergy mutation 先勝ち（別 session が allergy を commit 済み）----
do $allergy_first$
declare
  v_owner constant uuid := 'c1000000-0000-4000-8000-000000000103';
  v_member constant uuid := 'c2000000-0000-4000-8000-000000000103';
  v_request_id uuid;
  v_result jsonb;
  v_stale text;
  v_allergen_version text;
  v_food_rule_version text;
  v_menu_id constant uuid := 'c6000000-0000-4000-8000-000000000103';
  v_dish_id constant uuid := 'c6100000-0000-4000-8000-000000000103';
  v_ingredient_id constant uuid := 'c6200000-0000-4000-8000-000000000103';
  v_step_id constant uuid := 'c6300000-0000-4000-8000-000000000103';
  v_timeline_id constant uuid := 'c6400000-0000-4000-8000-000000000103';
  v_sent_before integer;
  v_success_before integer;
  v_reserved_before integer;
  v_allergy_id constant uuid := 'c3000000-0000-4000-8000-000000000193';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
begin
  select fingerprint into strict v_stale from p3_5_fingerprints where owner_id = v_owner;
  select catalog_version into strict v_allergen_version
  from public.allergen_catalog where id = 'egg';
  select rule_version into strict v_food_rule_version
  from public.food_safety_rules order by id limit 1;
  select id into strict v_request_id
  from private.ai_generation_requests
  where user_id = v_owner
    and idempotency_key = 'c9000000-0000-4000-8000-000000000021';

  select sent_count into strict v_sent_before
  from private.ai_user_daily_external_attempts
  where user_id = v_owner and usage_day = date '2026-07-22';
  select success_count, reserved_count
    into strict v_success_before, v_reserved_before
  from private.ai_user_daily_usage
  where user_id = v_owner and usage_day = date '2026-07-22';

  -- 別 session が allergy を commit（finalize より先）
  perform extensions.dblink_exec(
    v_connstr,
    format(
      'insert into public.member_allergies(id,user_id,member_id,allergen_id,custom_name,custom_confirmed) '
      || 'values (%L::uuid,%L::uuid,%L::uuid,%L,null,false)',
      v_allergy_id, v_owner, v_member, 'egg'
    )
  );
  if private.current_safety_fingerprint(v_owner, array[v_member]) is not distinct from v_stale then
    raise exception 'allergy-first: fingerprint did not change after allergy insert';
  end if;

  -- stale fingerprint で finalize → constraint_conflict
  v_result := public.finalize_ai_generation_success(
    v_request_id,
    jsonb_build_object(
      'schemaVersion', '2026-07-11.v1',
      'menuId', v_menu_id,
      'mealType', 'dinner',
      'cuisineGenre', 'japanese',
      'servings', 2,
      'totalElapsedMinutes', 15,
      'safetyTags', '[]'::jsonb,
      'dishes', jsonb_build_array(jsonb_build_object(
        'id', v_dish_id, 'role', 'main', 'position', 1, 'name', '鶏肉の塩焼き',
        'description', '主菜', 'cookingTimeMinutes', 15,
        'ingredients', jsonb_build_array(jsonb_build_object(
          'id', v_ingredient_id, 'position', 1, 'name', '鶏肉',
          'quantityValue', 200, 'quantityText', '200g', 'unit', 'g',
          'storeSection', 'meat', 'pantrySelectionId', null,
          'labelConfirmationRequired', false)),
        'steps', jsonb_build_array(jsonb_build_object(
          'id', v_step_id, 'position', 1, 'instruction', '焼く')))),
      'timeline', jsonb_build_array(jsonb_build_object(
        'id', v_timeline_id, 'position', 1, 'startMinute', 0, 'durationMinutes', 15,
        'instruction', '主菜を作る', 'dishId', v_dish_id, 'recipeStepId', v_step_id)),
      'adaptations', '[]'::jsonb,
      'pantryUsage', '[]'::jsonb,
      'labelConfirmations', '[]'::jsonb
    ),
    jsonb_build_object('mealType', 'dinner'),
    jsonb_build_object('members', jsonb_build_array(jsonb_build_object(
      'householdMemberId', v_member, 'anonymousRef', 'member_1', 'ageBand', 'age_6_8',
      'allergyStatus', 'none', 'allergenIds', '[]'::jsonb,
      'requiredSafetyConstraints', '[]'::jsonb, 'unsupportedDietStatus', 'none',
      'unsupportedDietKinds', '[]'::jsonb))),
    v_stale,
    v_allergen_version,
    v_food_rule_version,
    jsonb_build_array(jsonb_build_object(
      'householdMemberId', v_member, 'anonymousRef', 'member_1',
      'displayNameSnapshot', '子どもA')),
    '[]'::jsonb,
    null, null, null,
    '2026-07-22 00:21:02+00'
  );

  if v_result->>'status' is distinct from 'constraint_conflict' then
    raise exception 'allergy-first: expected constraint_conflict, got %', v_result;
  end if;
  if (select terminal_details from private.ai_generation_requests where id = v_request_id)
     is distinct from jsonb_build_object(
       'conflictCodes', jsonb_build_array('current_safety_changed')
     ) then
    raise exception 'allergy-first: missing current_safety_changed conflict codes';
  end if;
  if exists (select 1 from public.menus where user_id = v_owner) then
    raise exception 'allergy-first: menu row was persisted';
  end if;
  if (select status from private.ai_generation_requests where id = v_request_id)
     is distinct from 'constraint_conflict' then
    raise exception 'allergy-first: request status was not constraint_conflict';
  end if;
  if (select user_quota_reserved from private.ai_generation_requests where id = v_request_id)
     is not false then
    raise exception 'allergy-first: success reservation was not released';
  end if;
  if (select success_count from private.ai_user_daily_usage
        where user_id = v_owner and usage_day = date '2026-07-22')
     is distinct from v_success_before then
    raise exception 'allergy-first: success quota was consumed';
  end if;
  if (select reserved_count from private.ai_user_daily_usage
        where user_id = v_owner and usage_day = date '2026-07-22')
     is distinct from (v_reserved_before - 1) then
    raise exception 'allergy-first: success reservation was not released from usage';
  end if;
  if (select sent_count from private.ai_user_daily_external_attempts
        where user_id = v_owner and usage_day = date '2026-07-22')
     is distinct from v_sent_before then
    raise exception 'allergy-first: sent attempt was refunded';
  end if;
end
$allergy_first$;

select ok(
  exists(
    select 1 from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000103'
      and status = 'constraint_conflict'
      and terminal_details = jsonb_build_object(
        'conflictCodes', jsonb_build_array('current_safety_changed')
      )
  )
  and not exists (
    select 1 from public.menus where user_id = 'c1000000-0000-4000-8000-000000000103'
  ),
  'P3#5 allergy-first: finalize terminals as constraint_conflict/current_safety_changed with menu 0 and reservation release'
);

-- ---- Branch B: finalize 先勝ち（lock 保持中に allergy が待ち、commit 後に完了）----
do $finalize_first$
declare
  v_owner constant uuid := 'c1000000-0000-4000-8000-000000000104';
  v_member constant uuid := 'c2000000-0000-4000-8000-000000000104';
  v_request_id uuid;
  v_result jsonb;
  v_fingerprint text;
  v_allergen_version text;
  v_food_rule_version text;
  v_menu_id constant uuid := 'c6000000-0000-4000-8000-000000000104';
  v_dish_id constant uuid := 'c6100000-0000-4000-8000-000000000104';
  v_ingredient_id constant uuid := 'c6200000-0000-4000-8000-000000000104';
  v_step_id constant uuid := 'c6300000-0000-4000-8000-000000000104';
  v_timeline_id constant uuid := 'c6400000-0000-4000-8000-000000000104';
  v_allergy_id constant uuid := 'c3000000-0000-4000-8000-000000000194';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=shopping_pgtap_dblink_test password=shopping_pgtap_dblink_test_only';
  v_wait_event text;
  v_attempt integer;
  v_completed_before_commit boolean := false;
  v_sent_before integer;
  v_success_before integer;
  v_stored_fingerprint text;
begin
  select fingerprint into strict v_fingerprint from p3_5_fingerprints where owner_id = v_owner;
  select catalog_version into strict v_allergen_version
  from public.allergen_catalog where id = 'egg';
  select rule_version into strict v_food_rule_version
  from public.food_safety_rules order by id limit 1;
  select id into strict v_request_id
  from private.ai_generation_requests
  where user_id = v_owner
    and idempotency_key = 'c9000000-0000-4000-8000-000000000022';

  select sent_count into strict v_sent_before
  from private.ai_user_daily_external_attempts
  where user_id = v_owner and usage_day = date '2026-07-22';
  select success_count into strict v_success_before
  from private.ai_user_daily_usage
  where user_id = v_owner and usage_day = date '2026-07-22';

  -- finalize が household_members FOR UPDATE を取る（この DO トランザクションが保持）
  v_result := public.finalize_ai_generation_success(
    v_request_id,
    jsonb_build_object(
      'schemaVersion', '2026-07-11.v1',
      'menuId', v_menu_id,
      'mealType', 'dinner',
      'cuisineGenre', 'japanese',
      'servings', 2,
      'totalElapsedMinutes', 15,
      'safetyTags', '[]'::jsonb,
      'dishes', jsonb_build_array(jsonb_build_object(
        'id', v_dish_id, 'role', 'main', 'position', 1, 'name', '豆腐の煮物',
        'description', '主菜', 'cookingTimeMinutes', 15,
        'ingredients', jsonb_build_array(jsonb_build_object(
          'id', v_ingredient_id, 'position', 1, 'name', '豆腐',
          'quantityValue', 1, 'quantityText', '1丁', 'unit', 'piece',
          'storeSection', 'produce', 'pantrySelectionId', null,
          'labelConfirmationRequired', false)),
        'steps', jsonb_build_array(jsonb_build_object(
          'id', v_step_id, 'position', 1, 'instruction', '煮る')))),
      'timeline', jsonb_build_array(jsonb_build_object(
        'id', v_timeline_id, 'position', 1, 'startMinute', 0, 'durationMinutes', 15,
        'instruction', '主菜を作る', 'dishId', v_dish_id, 'recipeStepId', v_step_id)),
      'adaptations', '[]'::jsonb,
      'pantryUsage', '[]'::jsonb,
      'labelConfirmations', '[]'::jsonb
    ),
    jsonb_build_object('mealType', 'dinner'),
    jsonb_build_object('members', jsonb_build_array(jsonb_build_object(
      'householdMemberId', v_member, 'anonymousRef', 'member_1', 'ageBand', 'age_6_8',
      'allergyStatus', 'none', 'allergenIds', '[]'::jsonb,
      'requiredSafetyConstraints', '[]'::jsonb, 'unsupportedDietStatus', 'none',
      'unsupportedDietKinds', '[]'::jsonb))),
    v_fingerprint,
    v_allergen_version,
    v_food_rule_version,
    jsonb_build_array(jsonb_build_object(
      'householdMemberId', v_member, 'anonymousRef', 'member_1',
      'displayNameSnapshot', '子どもB')),
    '[]'::jsonb,
    null, null, null,
    '2026-07-22 00:22:02+00'
  );

  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'finalize-first: expected succeeded, got %', v_result;
  end if;
  if (select count(*) from public.menus where id = v_menu_id and user_id = v_owner) <> 1 then
    raise exception 'finalize-first: expected exactly one menu';
  end if;
  select safety_fingerprint into strict v_stored_fingerprint
  from public.menus where id = v_menu_id;
  if v_stored_fingerprint is distinct from v_fingerprint then
    raise exception 'finalize-first: stored fingerprint does not match locked fingerprint';
  end if;
  if (select success_count from private.ai_user_daily_usage
        where user_id = v_owner and usage_day = date '2026-07-22')
     is distinct from (v_success_before + 1) then
    raise exception 'finalize-first: success was not consumed';
  end if;
  if (select sent_count from private.ai_user_daily_external_attempts
        where user_id = v_owner and usage_day = date '2026-07-22')
     is distinct from v_sent_before then
    raise exception 'finalize-first: sent attempt accounting drifted';
  end if;

  -- lock 保持中に別 session の allergy insert を非同期送出
  perform extensions.dblink_connect('gen_finalize_first', v_connstr);
  perform extensions.dblink_exec('gen_finalize_first', 'begin');
  perform extensions.dblink_send_query(
    'gen_finalize_first',
    format(
      'insert into public.member_allergies(id,user_id,member_id,allergen_id,custom_name,custom_confirmed) '
      || 'values (%L::uuid,%L::uuid,%L::uuid,%L,null,false)',
      v_allergy_id, v_owner, v_member, 'egg'
    )
  );

  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    select wait_event into v_wait_event from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%member_allergies%'
        and query ilike '%' || v_allergy_id::text || '%'
      limit 1;
    if v_wait_event is not null then
      exit;
    end if;
    if exists(select 1 from public.member_allergies where id = v_allergy_id) then
      v_completed_before_commit := true;
      exit;
    end if;
  end loop;

  if v_completed_before_commit then
    raise exception 'finalize-first: allergy completed while finalize still held member locks';
  end if;
  if v_wait_event is null then
    raise exception 'finalize-first: allergy did not block on finalize member locks';
  end if;

  -- finalize 側トランザクションを commit して lock を解放
  commit;

  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('gen_finalize_first') = 0;
  end loop;
  loop
    declare
      v_drained integer;
    begin
      select count(*) into v_drained
        from extensions.dblink_get_result('gen_finalize_first') as t(status text);
      exit when v_drained = 0;
    end;
  end loop;
  perform extensions.dblink_exec('gen_finalize_first', 'commit');
  perform extensions.dblink_disconnect('gen_finalize_first');

  if not exists(select 1 from public.member_allergies where id = v_allergy_id) then
    raise exception 'finalize-first: allergy did not commit after lock release';
  end if;
  -- 仕様: 競合終了後の current と stored の不一致は許容（history/revalidation が扱う）
  if private.current_safety_fingerprint(v_owner, array[v_member])
     is not distinct from v_stored_fingerprint then
    raise exception 'finalize-first: expected current fingerprint to diverge after allergy';
  end if;
  if (select count(*) from public.menus where id = v_menu_id) <> 1 then
    raise exception 'finalize-first: menu disappeared after allergy commit';
  end if;
end
$finalize_first$;

select ok(
  exists(
    select 1 from public.menus
    where id = 'c6000000-0000-4000-8000-000000000104'
      and user_id = 'c1000000-0000-4000-8000-000000000104'
  )
  and exists(
    select 1 from public.member_allergies
    where id = 'c3000000-0000-4000-8000-000000000194'
  )
  and exists(
    select 1 from private.ai_generation_requests
    where user_id = 'c1000000-0000-4000-8000-000000000104'
      and status = 'succeeded'
  ),
  'P3#5 finalize-first: success menu 1 committed under lock, then waiting allergy commits after release'
);

-- cleanup
delete from auth.users where id in (
  'c1000000-0000-4000-8000-000000000101',
  'c1000000-0000-4000-8000-000000000102',
  'c1000000-0000-4000-8000-000000000103',
  'c1000000-0000-4000-8000-000000000104'
);

select * from finish();
