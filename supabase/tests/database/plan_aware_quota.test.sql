\ir 000_helpers.sql
-- Plan-aware quota: CHECK 10/20/8, plan RPC args, short snapshot mark-time (A1)

begin;
select plan(13);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'plan-aware-quota@example.invalid'
);

-- 1. identity CHECK が 10/20 を許容
select lives_ok(
  $$insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
    values (repeat('a1', 32), private.ai_jst_day(now()), 0, 10)$$,
  'identity success CHECK accepts reserved+success = 10'
);

select lives_ok(
  $$insert into private.ai_identity_daily_external_attempts (identity_key, usage_day, reserved_count, sent_count)
    values (repeat('a2', 32), private.ai_jst_day(now()), 0, 20)$$,
  'identity attempt CHECK accepts reserved+sent = 20'
);

-- 2. short window sent_count=8 ok, 9 fail
select lives_ok(
  $$insert into private.ai_user_rate_windows (user_id, window_started_at, sent_count)
    values (
      'f1000000-0000-4000-8000-000000000001'::uuid,
      to_timestamp(floor(extract(epoch from now()) / 600.0) * 600.0),
      8
    )$$,
  'rate window CHECK accepts sent_count = 8'
);

select throws_ok(
  $$insert into private.ai_user_rate_windows (user_id, window_started_at, sent_count)
    values (
      'f1000000-0000-4000-8000-000000000001'::uuid,
      to_timestamp(floor(extract(epoch from now()) / 600.0) * 600.0) + interval '10 minutes',
      9
    )$$,
  '23514',
  NULL,
  'rate window CHECK rejects sent_count = 9'
);

-- regenerate_menu 用 source menu（idea: empty members が integrity で有効）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'dinner', 'japanese', 2, 30,
  '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'idea',
  null, null, 'menu-v1',
  'f5000000-0000-4000-8000-000000000001', 1
);

-- 3. reserve Plus limits 受理
select lives_ok(
  $$select public.reserve_ai_generation(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f3000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'f2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 20, false, false, 180, now()
  )$$,
  'reserve_ai_generation accepts Plus limits 10/20/8'
);

-- 4. invalid user limit 拒否
select throws_ok(
  $$select public.reserve_ai_generation(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    'f3000000-0000-4000-8000-000000000099'::uuid,
    'regenerate_menu', null, null,
    'f2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('d', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid),
    5, 6, 4, 20, false, false, 180, now()
  )$$,
  '22023',
  'release_quota_mismatch',
  'reserve rejects p_user_limit outside 3|10'
);

-- 5. reserve 後 short window 行が「reserve 専用に」増えない（A1）
-- 事前 seed の sent_count=8 行のみ。reserve は rate_windows を触らない。
select is(
  (
    select count(*)::integer
    from private.ai_user_rate_windows
    where user_id = 'f1000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'reserve does not create additional short-window rows (A1)'
);

select ok(
  (
    select quota_success_limit = 10
       and quota_attempt_limit = 20
       and quota_short_limit = 8
    from private.ai_generation_requests
    where idempotency_key = 'f3000000-0000-4000-8000-000000000001'::uuid
  ),
  'reserve snapshots Plus quota limits on request row'
);

-- 6. mark で short limit 8 スナップショットが効く
-- processing 行を解放してから別キーで再 reserve
update private.ai_generation_requests set
  status = 'failed',
  failure_code = 'test_release',
  user_quota_reserved = false,
  user_attempt_reserved = false,
  user_attempt_day = null,
  global_reserved_day = null,
  completed_at = now(),
  updated_at = now()
where idempotency_key = 'f3000000-0000-4000-8000-000000000001'::uuid
  and status = 'processing';

update private.ai_identity_daily_usage
set reserved_count = greatest(reserved_count - 1, 0)
where identity_key = tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid);
update private.ai_identity_daily_external_attempts
set reserved_count = greatest(reserved_count - 1, 0)
where identity_key = tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid);
update private.ai_global_daily_usage
set reserved_count = greatest(reserved_count - 1, 0)
where usage_day = private.ai_jst_day(now());

-- short 窓を 7 に下げて mark 成功余地を作る
update private.ai_user_rate_windows
set sent_count = 7
where user_id = 'f1000000-0000-4000-8000-000000000001'::uuid
  and window_started_at = to_timestamp(floor(extract(epoch from now()) / 600.0) * 600.0);

select public.reserve_ai_generation(
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'f3000000-0000-4000-8000-000000000002'::uuid,
  'regenerate_menu', null, null,
  'f2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
  'generation-command.v3', repeat('e', 64),
  '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
  tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid),
  10, 20, 8, 20, false, false, 180, now()
);

select is(
  (
    select (public.mark_ai_global_sent(
      (select id from private.ai_generation_requests
        where idempotency_key = 'f3000000-0000-4000-8000-000000000002'::uuid),
      now()
    ) ->> 'sent')::boolean
  ),
  true,
  'mark succeeds when short sent_count=7 with quota_short_limit=8'
);

select is(
  (
    select sent_count
    from private.ai_user_rate_windows
    where user_id = 'f1000000-0000-4000-8000-000000000001'::uuid
      and window_started_at = to_timestamp(floor(extract(epoch from now()) / 600.0) * 600.0)
  ),
  8,
  'mark increments short window to 8 under Plus snapshot'
);

-- 7. global 200 受理 / 201 拒否
select lives_ok(
  $$select public.get_ai_usage_today(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 200, '2001-01-01 00:00:00+00'::timestamptz
  )$$,
  'get_ai_usage_today accepts p_global_limit=200'
);

select throws_ok(
  $$select public.get_ai_usage_today(
    'f1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('f1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 201, '2001-01-01 00:00:00+00'::timestamptz
  )$$,
  '22023',
  'invalid_quota_configuration',
  'get_ai_usage_today rejects p_global_limit=201'
);

select throws_ok(
  $$select public.reserve_ai_repair_call(
    '00000000-0000-4000-8000-000000000001'::uuid,
    201, false, now()
  )$$,
  '22023',
  'invalid_quota_configuration',
  'reserve_ai_repair_call rejects p_global_limit=201'
);

select * from finish();
rollback;
