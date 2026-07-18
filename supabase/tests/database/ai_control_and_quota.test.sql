begin;
select plan(33);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-a@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-b@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

select has_table('private'::name, 'ai_generation_requests'::name);
select has_table('private'::name, 'ai_user_daily_usage'::name);
select has_table('private'::name, 'ai_global_daily_usage'::name);
select hasnt_table('public'::name, 'ai_generation_requests'::name);
select has_function('public'::name, 'reserve_ai_generation'::name);
select has_function('public'::name, 'reserve_ai_repair_call'::name);
select has_function('public'::name, 'mark_ai_global_sent'::name);
select has_function('public'::name, 'finalize_ai_generation_failure'::name);
select has_function('public'::name, 'cleanup_stale_ai_generations'::name);
select table_privs_are('private', 'ai_generation_requests', 'authenticated', array[]::text[]);
select is(private.ai_jst_day('2026-07-10 14:59:59+00'), date '2026-07-10');
select is(private.ai_jst_day('2026-07-10 15:00:00+00'), date '2026-07-11');

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099',
    'new_menu', null, 6, 45, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'release_quota_mismatch',
  'the database rejects an environment-only success-limit override');

select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
select is((select count(*) from private.ai_global_daily_usage), 0::bigint);
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000097',
    'regenerate_menu', null, 5, 0, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a zero global limit before generation reservation');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000098',
    'regenerate_menu', null, 5, 46, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a global limit above the release maximum before generation reservation');
select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
select is((select count(*) from private.ai_global_daily_usage), 0::bigint);

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'regenerate_menu', null, 5, 45, 180, '2026-07-10 15:00:00+00'
  )->>'status',
  'processing'
);
select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'regenerate_menu', null, 5, 45, 180, '2026-07-10 15:00:01+00'
  )->>'replayed',
  'true'
);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 1);
select is((select reserved_count from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'), 1);

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'regenerate_menu', null, 5, 45, 180, '2026-07-10 15:00:02+00'
  )->>'failure_code',
  'generation_in_progress'
);

select lives_ok($$
  select public.mark_ai_global_sent(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    '2026-07-10 15:00:03+00'
  )
$$);
select is((select jsonb_build_object(
  'status', status,
  'repair_attempted', repair_attempted,
  'global_reserved_day', global_reserved_day,
  'global_sent_calls', global_sent_calls
) from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'status', 'processing',
    'repair_attempted', false,
    'global_reserved_day', null,
    'global_sent_calls', 1
  ));
select is((select jsonb_build_object(
  'reserved_count', reserved_count,
  'sent_count', sent_count
) from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'),
  jsonb_build_object('reserved_count', 0, 'sent_count', 1));
select throws_ok($$
  select public.reserve_ai_repair_call(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    0, '2026-07-10 15:00:04+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a zero global limit before repair reservation');
select throws_ok($$
  select public.reserve_ai_repair_call(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    46, '2026-07-10 15:00:05+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a global limit above the release maximum before repair reservation');
select is((select jsonb_build_object(
  'status', status,
  'repair_attempted', repair_attempted,
  'global_reserved_day', global_reserved_day,
  'global_sent_calls', global_sent_calls
) from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'status', 'processing',
    'repair_attempted', false,
    'global_reserved_day', null,
    'global_sent_calls', 1
  ));
select is((select jsonb_build_object(
  'reserved_count', reserved_count,
  'sent_count', sent_count
) from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'),
  jsonb_build_object('reserved_count', 0, 'sent_count', 1));

select lives_ok($$
  select public.finalize_ai_generation_failure(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    'model_unavailable', '2026-07-10 15:05:00+00', '2026-07-10 15:00:03+00'
  )
$$);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 0);

select * from finish();
rollback;
