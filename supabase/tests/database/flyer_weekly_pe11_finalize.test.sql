\ir 000_helpers.sql
-- PE11: stash + finalize の reserved→success 確定と、本文付き stale の promote
begin;
select plan(10);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'flyer-weekly-pe11@example.invalid'
);

insert into private.ai_identity_flyer_weekly (identity_key, week_start, reserved_count, success_count)
values (
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_week_start(now()),
  1, 0
);

insert into private.flyer_weekly_requests (
  id, user_id, identity_key, idempotency_key, status, week_start,
  flyer_success_reserved, flyer_try_reserved, flyer_try_sent,
  user_attempt_reserved, processing_expires_at, started_at
) values (
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'c1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  'idem-pe11-stash',
  'processing',
  private.ai_jst_week_start(now()),
  true, false, true,
  false,
  now() + interval '2 minutes',
  now()
);

select is(
  (
    select public.stash_flyer_weekly_result(
      'c2000000-0000-4000-8000-000000000001'::uuid,
      '{"weekStartJst":"2026-07-27","days":[]}'::jsonb,
      now()
    ) ->> 'status'
  ),
  'processing',
  'stash keeps processing and does not convert reserved'
);

select is(
  (
    select result_payload ->> 'weekStartJst'
    from private.flyer_weekly_requests
    where id = 'c2000000-0000-4000-8000-000000000001'::uuid
  ),
  '2026-07-27',
  'stash writes validated result_payload'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'stash does not decrement reserved_count'
);

-- 期限切れ + 本文あり: cleanup は reserved を解放せず success に promote する
update private.flyer_weekly_requests
set processing_expires_at = now() - interval '1 second'
where id = 'c2000000-0000-4000-8000-000000000001'::uuid;

select lives_ok(
  $$select public.cleanup_stale_flyer_weekly_batch(now(), 50)$$,
  'cleanup runs on stale processing with result'
);

select is(
  (
    select status
    from private.flyer_weekly_requests
    where id = 'c2000000-0000-4000-8000-000000000001'::uuid
  ),
  'succeeded',
  'cleanup with result marks succeeded instead of generation_timeout'
);

select is(
  (
    select reserved_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  0,
  'cleanup promote converts reserved to success (does not release)'
);

select is(
  (
    select success_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  1,
  'cleanup promote increments success_count'
);

-- reserved=0 でも flag が残っていれば success 枠を消費する（corrupt でも 200 再入場しない）
insert into private.flyer_weekly_requests (
  id, user_id, identity_key, idempotency_key, status, week_start,
  flyer_success_reserved, flyer_try_reserved, flyer_try_sent,
  user_attempt_reserved, processing_expires_at, started_at
) values (
  'c2000000-0000-4000-8000-000000000002'::uuid,
  'c1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  'idem-pe11-corrupt',
  'processing',
  private.ai_jst_week_start(now()),
  true, false, true,
  false,
  now() + interval '2 minutes',
  now()
);

select is(
  (
    select public.finalize_flyer_weekly_success(
      'c2000000-0000-4000-8000-000000000002'::uuid,
      '{"weekStartJst":"2026-07-27","days":[]}'::jsonb,
      now()
    ) ->> 'status'
  ),
  'succeeded',
  'finalize succeeds even when reserved_count is already 0'
);

select is(
  (
    select success_count
    from private.ai_identity_flyer_weekly
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and week_start = private.ai_jst_week_start(now())
  ),
  2,
  'corrupt reserved still consumes a success slot'
);

select is(
  (
    select public.finalize_flyer_weekly_success(
      'c2000000-0000-4000-8000-000000000002'::uuid,
      '{"weekStartJst":"2026-07-27","days":[]}'::jsonb,
      now()
    ) ->> 'status'
  ),
  'succeeded',
  'finalize on already succeeded is idempotent'
);

select * from finish();
rollback;
