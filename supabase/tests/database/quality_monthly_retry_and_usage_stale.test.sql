\ir 000_helpers.sql
-- G1: quality_monthly_limit.retry_at = next JST month start
-- G4: get_ai_usage_today runs cleanup_stale so remaining recovers after orphan expiry

begin;
select plan(6);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'quality-monthly-retry@example.invalid'
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'dinner', 'japanese', 2, 30,
  '{}'::jsonb, '{}'::jsonb, repeat('b', 64), 'idea',
  null, null, 'menu-v1',
  'b5000000-0000-4000-8000-000000000001', 1
);

-- ---------------------------------------------------------------------------
-- G1: monthly quality exhaustion stamps next JST month start, not next midnight
-- ---------------------------------------------------------------------------
insert into private.ai_identity_quality_monthly (
  identity_key, usage_month, success_count, reserved_count
) values (
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_month_start('2026-07-15 03:00:00+00'::timestamptz),
  20,
  0
)
on conflict (identity_key, usage_month) do update
  set success_count = 20, reserved_count = 0;

select is(
  (
    select public.reserve_ai_generation(
      'b1000000-0000-4000-8000-000000000001'::uuid,
      'b3000000-0000-4000-8000-000000000001'::uuid,
      'regenerate_menu', null, null,
      'b2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
      'generation-command.v3', repeat('a', 64),
      '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
      tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
      10, 20, 8, 20, false, true, 180,
      '2026-07-15 03:00:00+00'::timestamptz
    ) ->> 'failure_code'
  ),
  'quality_monthly_limit',
  'G1: quality monthly exhaustion returns quality_monthly_limit'
);

select is(
  (
    select retry_at
    from private.ai_generation_requests
    where idempotency_key = 'b3000000-0000-4000-8000-000000000001'::uuid
  ),
  private.ai_next_jst_month_start('2026-07-15 03:00:00+00'::timestamptz),
  'G1: quality_monthly_limit retry_at is next JST month start'
);

select isnt(
  (
    select retry_at
    from private.ai_generation_requests
    where idempotency_key = 'b3000000-0000-4000-8000-000000000001'::uuid
  ),
  private.ai_next_jst_midnight('2026-07-15 03:00:00+00'::timestamptz),
  'G1: quality_monthly_limit retry_at is not next JST midnight'
);

-- ---------------------------------------------------------------------------
-- G4: get_ai_usage_today finalizes expired processing and restores remaining
-- ---------------------------------------------------------------------------
-- 期限切れ processing + reserved を手で載せ、usage だけ呼んで解放されることを確認
insert into private.ai_identity_daily_usage (
  identity_key, usage_day, success_count, reserved_count
) values (
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  0,
  1
)
on conflict (identity_key, usage_day) do update
  set reserved_count = 1, success_count = 0;

insert into private.ai_identity_daily_external_attempts (
  identity_key, usage_day, sent_count, reserved_count
) values (
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  0,
  1
)
on conflict (identity_key, usage_day) do update
  set reserved_count = 1, sent_count = 0;

insert into private.ai_global_daily_usage (
  usage_day, sent_count, reserved_count
) values (
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  0,
  1
)
on conflict (usage_day) do update
  set reserved_count = greatest(private.ai_global_daily_usage.reserved_count, 1);

insert into private.ai_generation_requests (
  user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  draft_id, draft_revision, source_menu_id, replace_dish_id, change_reason,
  request_hmac_version, request_hmac,
  quota_success_limit, quota_attempt_limit, quota_short_limit, quality_mode,
  user_usage_day, user_quota_reserved, user_attempt_reserved, user_attempt_day,
  global_reserved_day, processing_expires_at, started_at
) values (
  'b1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'b3000000-0000-4000-8000-000000000099'::uuid,
  'regenerate_menu',
  'processing',
  null, null,
  'b2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
  'generation-command.v3', repeat('c', 64),
  10, 20, 8, false,
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  true, true,
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  private.ai_jst_day('2026-07-15 12:00:00+00'::timestamptz),
  '2026-07-15 11:00:00+00'::timestamptz,
  '2026-07-15 10:57:00+00'::timestamptz
);

-- usage 呼び出し前は reserved で success remaining が 1 減っている前提（Plus 10）
select is(
  (
    select (public.get_ai_usage_today(
      'b1000000-0000-4000-8000-000000000001'::uuid,
      tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
      10, 20, 8, 20,
      '2026-07-15 12:00:00+00'::timestamptz
    )->'success'->>'remaining')::integer
  ),
  10,
  'G4: get_ai_usage_today restores success remaining after stale cleanup'
);

select is(
  (
    select status
    from private.ai_generation_requests
    where idempotency_key = 'b3000000-0000-4000-8000-000000000099'::uuid
  ),
  'failed',
  'G4: expired processing is finalized by get_ai_usage_today cleanup'
);

select is(
  (
    select failure_code
    from private.ai_generation_requests
    where idempotency_key = 'b3000000-0000-4000-8000-000000000099'::uuid
  ),
  'generation_timeout',
  'G4: stale cleanup marks generation_timeout'
);

select * from finish();
rollback;
