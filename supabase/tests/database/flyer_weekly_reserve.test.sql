\ir 000_helpers.sql
-- Task 7: flyer weekly S1 no try mutation + release symmetry

begin;
select plan(10);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'flyer-weekly-reserve@example.invalid'
);

-- 1. happy reserve: flyer success+try+attempt+global reserved++
select lives_ok(
  $$select public.reserve_flyer_weekly(
    'b1000000-0000-4000-8000-000000000001'::uuid,
    tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
    'idem-flyer-1',
    20, 8, 20, false, now()
  )$$,
  'reserve_flyer_weekly accepts happy path'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'flyer success reserved_count = 1 after reserve'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'flyer try reserved_count = 1 after reserve'
);

-- 2. release S8 path: finalize failure unsent → reserved 0
select public.finalize_flyer_weekly_failure(
  (select id from private.flyer_weekly_requests
    where idempotency_key = 'idem-flyer-1'),
  'flyer_invalid_image',
  false,
  now()
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'release after unsent fail returns flyer success reserved to 0'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'release after unsent fail returns flyer try reserved to 0'
);

-- 3. A11: success_count=2 → always flyer_weekly_limit; tries unchanged
insert into private.ai_identity_flyer_weekly (identity_key, week_start, reserved_count, success_count)
values (
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_week_start(now()),
  0, 2
)
on conflict (identity_key, week_start) do update
  set success_count = 2, reserved_count = 0;

insert into private.ai_identity_flyer_weekly_tries (identity_key, week_start, reserved_count, sent_count)
values (
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_week_start(now()),
  0, 3
)
on conflict (identity_key, week_start) do update
  set sent_count = 3, reserved_count = 0;

select is(
  (
    select public.reserve_flyer_weekly(
      'b1000000-0000-4000-8000-000000000001'::uuid,
      tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
      'idem-flyer-limit',
      20, 8, 20, false, now()
    ) ->> 'failure_code'
  ),
  'flyer_weekly_limit',
  'S1 full returns flyer_weekly_limit'
);

select is(
  (
    select public.reserve_flyer_weekly(
      'b1000000-0000-4000-8000-000000000001'::uuid,
      tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
      'idem-flyer-limit-2',
      20, 8, 20, false, now()
    ) ->> 'failure_code'
  ),
  'flyer_weekly_limit',
  'S1 full is stable on repeat reserve'
);

select is(
  (
    select sent_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  3,
  'A11: try sent_count unchanged when success full'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly_tries
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'A11: try reserved_count unchanged when success full'
);

select is(
  (
    select count(*)::integer
    from private.flyer_weekly_requests
    where idempotency_key in ('idem-flyer-limit', 'idem-flyer-limit-2')
  ),
  0,
  'A11: no request row created on S1 full'
);

select * from finish();
rollback;
