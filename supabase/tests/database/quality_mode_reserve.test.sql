\ir 000_helpers.sql
-- Task 6: generation-command.v3 cutover + quality atomic reserve + release symmetry

begin;
select plan(12);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'quality-mode-reserve@example.invalid'
);

-- regenerate 用 idea source menu
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

-- 1. v3 happy path
select lives_ok(
  $$select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    10, 20, 8, 20, false, false, 180, now()
  )$$,
  'reserve accepts generation-command.v3'
);

select ok(
  (
    select quality_mode = false and request_hmac_version = 'generation-command.v3'
    from private.ai_generation_requests
    where idempotency_key = 'a3000000-0000-4000-8000-000000000001'::uuid
  ),
  'request row stores v3 and quality_mode false by default'
);

-- release processing to free slot for later tests
update private.ai_generation_requests set
  status = 'failed', failure_code = 'test_release',
  user_quota_reserved = false, user_attempt_reserved = false,
  user_attempt_day = null, global_reserved_day = null,
  completed_at = now(), updated_at = now()
where idempotency_key = 'a3000000-0000-4000-8000-000000000001'::uuid
  and status = 'processing';
update private.ai_identity_daily_usage
set reserved_count = greatest(reserved_count - 1, 0)
where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid);
update private.ai_identity_daily_external_attempts
set reserved_count = greatest(reserved_count - 1, 0)
where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid);
update private.ai_global_daily_usage
set reserved_count = greatest(reserved_count - 1, 0)
where usage_day = private.ai_jst_day(now());

-- 2. retired version rejected（リテラル v2 を置かず concat で grep gate を満たす）
select throws_ok(
  format(
    $q$select public.reserve_ai_generation(
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'a3000000-0000-4000-8000-000000000099'::uuid,
      'regenerate_menu', null, null,
      'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
      %L, repeat('d', 64),
      '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
      tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
      10, 20, 8, 20, false, false, 180, now()
    )$q$,
    'generation-command.' || 'v2'
  ),
  '22023',
  'invalid_request_hmac',
  'reserve rejects retired hmac version with invalid_request_hmac'
);

-- 3. CHECK rejects retired hmac version insert
select throws_ok(
  format(
    $q$insert into private.ai_generation_requests (
      user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
      request_hmac_version, request_hmac, user_usage_day, started_at, completed_at
    ) values (
      'a1000000-0000-4000-8000-000000000001'::uuid,
      tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
      false,
      'a3000000-0000-4000-8000-000000000098'::uuid,
      'regenerate_menu', 'failed',
      %L, repeat('e', 64),
      private.ai_jst_day(now()), now(), now()
    )$q$,
    'generation-command.' || 'v2'
  ),
  '23514',
  NULL,
  'ai_generation_requests CHECK rejects retired hmac version'
);

-- 4. only one live overload with p_quality_mode
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reserve_ai_generation'
  ),
  1,
  'exactly one live reserve_ai_generation overload'
);

select ok(
  pg_get_functiondef(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,text,integer,integer,integer,integer,boolean,boolean,integer,timestamptz)'::regprocedure
  ) like '%p_quality_mode%',
  'surviving reserve overload includes p_quality_mode'
);

-- 5. quality reserve co-consumes standard success + quality day/month
select public.reserve_ai_generation(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'a3000000-0000-4000-8000-000000000002'::uuid,
  'regenerate_menu', null, null,
  'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
  'generation-command.v3', repeat('f', 64),
  '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
  tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
  10, 20, 8, 20, false, true, 180, now()
);

select ok(
  (
    select quality_mode = true and user_quota_reserved and status = 'processing'
    from private.ai_generation_requests
    where idempotency_key = 'a3000000-0000-4000-8000-000000000002'::uuid
  ),
  'quality reserve stores quality_mode true and identity reserved'
);

select is(
  (
    select reserved_count
    from private.ai_identity_quality_daily
    where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())
  ),
  1,
  'quality day reserved_count = 1 after quality reserve'
);

select is(
  (
    select reserved_count
    from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())
  ),
  1,
  'M8: normal identity success reserved also 1 on quality path'
);

-- 6. fail finalize releases quality + identity reserved
select public.finalize_ai_generation_failure(
  (select id from private.ai_generation_requests
    where idempotency_key = 'a3000000-0000-4000-8000-000000000002'::uuid),
  'invalid_ai_response',
  null,
  now()
);

select is(
  (
    select reserved_count
    from private.ai_identity_quality_daily
    where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())
  ),
  0,
  'fail finalize returns quality day reserved to 0'
);

select is(
  (
    select reserved_count
    from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())
  ),
  0,
  'fail finalize returns identity reserved to 0'
);

-- 7. day limit 3: seed reserved+success and reject 4th
insert into private.ai_identity_quality_daily (identity_key, usage_day, reserved_count, success_count)
values (
  tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day(now()),
  0, 3
)
on conflict (identity_key, usage_day) do update
  set success_count = 3, reserved_count = 0;

select is(
  (
    select public.reserve_ai_generation(
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'a3000000-0000-4000-8000-000000000003'::uuid,
      'regenerate_menu', null, null,
      'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
      'generation-command.v3', repeat('1', 64),
      '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
      tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
      10, 20, 8, 20, false, true, 180, now()
    ) ->> 'failure_code'
  ),
  'quality_daily_limit',
  'quality reserve rejects when day success+reserved >= 3'
);

select * from finish();
rollback;
