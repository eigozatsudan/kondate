\ir 000_helpers.sql

begin;
select plan(12);

create extension if not exists pgtap with schema extensions;

select tests.isolate_local_ai_global_usage();

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'daily-success-quota-1-5@example.invalid'
);

-- regenerate_menu 用 source menu（plan_aware_quota.test.sql の Plus 受理ケースと同じ手順）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'dinner', 'japanese', 2, 30,
  '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'idea',
  null, null, 'menu-v1',
  'a5000000-0000-4000-8000-000000000001', 1
);

-- CHECK は 1 本だけ in (1, 3, 5, 10)
select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname = 'ai_generation_requests'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%quota_success_limit%'
  ),
  1,
  'quota_success_limit has exactly one CHECK'
);

select ok(
  (
    select pg_get_constraintdef(c.oid) ilike '%(1, 3, 5, 10)%'
       or pg_get_constraintdef(c.oid) ilike '%(1,3,5,10)%'
       or pg_get_constraintdef(c.oid) ilike '%ARRAY[1, 3, 5, 10]%'
       or pg_get_constraintdef(c.oid) ilike '%ARRAY[1,3,5,10]%'
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'private'
      and t.relname = 'ai_generation_requests'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%quota_success_limit%'
  ),
  'quota_success_limit CHECK allows 1, 3, 5, 10'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'ai_generation_requests'
      and column_name = 'quota_success_limit'
  ),
  '1',
  'quota_success_limit default is 1'
);

-- Plus 5 受理
select lives_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  )$$,
  'reserve accepts Plus limits 5/20/8'
);

-- 旧 Free 3 / 旧 Plus 10 は mismatch
select throws_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000003'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('d', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    3, 6, 4, 20, false, false, 180, now()
  )$$,
  '22023',
  'release_quota_mismatch',
  'reserve rejects retired p_user_limit 3'
);

select throws_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000010'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('e', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 20, false, false, 180, now()
  )$$,
  '22023',
  'release_quota_mismatch',
  'reserve rejects retired p_user_limit 10'
);

-- 歴史 1|5|3|10 は生き、不正 2|4 は 23514。
-- processing 一意制約を避けるため status は failed。列リストは quality_monthly 117-134 行。
select lives_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-000000000021'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('1', 64),
    1, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  'quota_success_limit CHECK accepts 1'
);

select lives_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-000000000025'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('5', 64),
    5, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  'quota_success_limit CHECK accepts 5'
);

select lives_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-000000000023'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('3', 64),
    3, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  'quota_success_limit CHECK accepts historical 3'
);

select lives_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-00000000002a'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('a', 64),
    10, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  'quota_success_limit CHECK accepts historical 10'
);

select throws_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-000000000022'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('2', 64),
    2, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  '23514',
  NULL,
  'quota_success_limit CHECK rejects 2'
);

select throws_ok(
  $$insert into private.ai_generation_requests (
    user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
    draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
    request_hmac_version, request_hmac,
    quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
    user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, processing_expires_at, started_at
  ) values (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    false,
    'a3000000-0000-4000-8000-000000000024'::uuid,
    'regenerate_menu',
    'failed',
    null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('4', 64),
    4, 20, 8, false,
    private.ai_jst_day(now()),
    false, false,
    private.ai_jst_day(now()),
    private.ai_jst_day(now()),
    now(),
    now()
  )$$,
  '23514',
  NULL,
  'quota_success_limit CHECK rejects 4'
);

select finish();
rollback;
