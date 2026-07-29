\ir 000_helpers.sql
-- Task 8 residual: reserve flyer → release_flyer_weekly_for_user_processing → reserved=0
-- success/sent は残る。Auth CASCADE 時の BEFORE DELETE 第二経路も固定。

begin;
select plan(13);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'flyer-release-on-delete@example.invalid'
);

-- 1. happy reserve
select lives_ok(
  $$select public.reserve_flyer_weekly(
    'c2000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid),
    'idem-flyer-delete-1',
    20, 8, 20, false, now()
  )$$,
  'reserve_flyer_weekly accepts happy path for delete release'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'flyer success reserved_count = 1 after reserve'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'flyer try reserved_count = 1 after reserve'
);

-- 2. account-delete bulk release
select is(
  public.release_flyer_weekly_for_user_processing(
    'c2000000-0000-4000-8000-000000000001'::uuid, now()
  ),
  1,
  'release RPC finalizes one processing flyer request'
);

select is(
  (
    select status from private.flyer_weekly_requests
    where idempotency_key = 'idem-flyer-delete-1'
  ),
  'failed',
  'release marks flyer request failed'
);

select is(
  (
    select failure_code from private.flyer_weekly_requests
    where idempotency_key = 'idem-flyer-delete-1'
  ),
  'account_deleted',
  'release sets failure_code account_deleted'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'release clears flyer success reserved'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'release clears flyer try reserved'
);

-- identity 週次行は success/sent 用に残ってよい（reserved のみ解放）
select is(
  (
    select count(*)::integer
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'identity flyer weekly row may remain after reserved release'
);

-- 3. grants: service_role only
select ok(
  not has_function_privilege(
    'authenticated',
    'public.release_flyer_weekly_for_user_processing(uuid,timestamptz)',
    'execute'
  ),
  'authenticated cannot EXECUTE release_flyer_weekly_for_user_processing'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.release_flyer_weekly_for_user_processing(uuid,timestamptz)',
    'execute'
  ),
  'service_role can EXECUTE release_flyer_weekly_for_user_processing'
);

-- 4. BEFORE DELETE trigger path: reserve again then delete request row
select lives_ok(
  $$select public.reserve_flyer_weekly(
    'c2000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid),
    'idem-flyer-delete-trigger',
    20, 8, 20, false, now()
  )$$,
  'second reserve for BEFORE DELETE path'
);

delete from private.flyer_weekly_requests
where idempotency_key = 'idem-flyer-delete-trigger';

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c2000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'BEFORE DELETE trigger releases flyer success reserved'
);

select * from finish();
rollback;
