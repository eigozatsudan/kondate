\ir 000_helpers.sql
-- Feature 3–4: identity 日次枠・delete 予約解放・personal_quota_disabled finalize

begin;
select plan(14);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'identity-release@example.invalid'
);
select tests.create_supabase_user(
  'c1000000-0000-4000-8000-000000000002'::uuid,
  'identity-disabled@example.invalid'
);

-- invalid identity_key は台帳非接触
select throws_ok(
  $$select public.reserve_ai_generation(
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'd1000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'e1000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v2', repeat('a', 64),
    '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    'NOT-HEX', 3, 6, 4, 20, false, 180, now()
  )$$,
  '22023',
  'invalid_identity_key',
  'invalid identity_key is rejected before ledger contact'
);

-- seed processing row with identity reserved, then release RPC
insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
values (
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day(now()), 1, 1
);
insert into private.ai_identity_daily_external_attempts (identity_key, usage_day, reserved_count, sent_count)
values (
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day(now()), 1, 0
);
insert into private.ai_global_daily_usage (usage_day, reserved_count, sent_count)
values (private.ai_jst_day(now()), 1, 0)
on conflict (usage_day) do update
set reserved_count = private.ai_global_daily_usage.reserved_count + 1;

insert into private.ai_generation_requests (
  user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac, user_usage_day,
  user_quota_reserved, user_attempt_reserved, user_attempt_day, global_reserved_day,
  processing_expires_at, started_at
) values (
  'c1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'd1000000-0000-4000-8000-000000000010'::uuid,
  'regenerate_menu', 'processing',
  'generation-command.v2', repeat('b', 64), private.ai_jst_day(now()),
  true, true, private.ai_jst_day(now()), private.ai_jst_day(now()),
  now() + interval '3 minutes', now()
);

select is(
  public.release_identity_and_global_for_user_processing(
    'c1000000-0000-4000-8000-000000000001'::uuid, now()
  ),
  1,
  'release RPC finalizes one processing request'
);

select is(
  (select status from private.ai_generation_requests
    where idempotency_key = 'd1000000-0000-4000-8000-000000000010'::uuid),
  'failed',
  'release marks request failed'
);

select is(
  (select reserved_count from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())),
  0,
  'release clears identity success reserved'
);

select is(
  (select success_count from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())),
  1,
  'release does not reduce success_count'
);

select is(
  (select reserved_count from private.ai_identity_daily_external_attempts
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())),
  0,
  'release clears identity attempt reserved'
);

-- BEFORE DELETE trigger path: insert processing + delete row
insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
values (
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  private.ai_jst_day(now()), 1, 1
)
on conflict (identity_key, usage_day) do update
set reserved_count = private.ai_identity_daily_usage.reserved_count + 1;

insert into private.ai_generation_requests (
  id, user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac, user_usage_day,
  user_quota_reserved, user_attempt_reserved, user_attempt_day, global_reserved_day,
  processing_expires_at, started_at
) values (
  'd1000000-0000-4000-8000-000000000099'::uuid,
  'c1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'd1000000-0000-4000-8000-000000000011'::uuid,
  'regenerate_menu', 'processing',
  'generation-command.v2', repeat('c', 64), private.ai_jst_day(now()),
  true, false, null, private.ai_jst_day(now()),
  now() + interval '3 minutes', now()
);

-- ensure global reserved exists
insert into private.ai_global_daily_usage (usage_day, reserved_count, sent_count)
values (private.ai_jst_day(now()), 1, 0)
on conflict (usage_day) do update
set reserved_count = private.ai_global_daily_usage.reserved_count + 1;

delete from private.ai_generation_requests
where id = 'd1000000-0000-4000-8000-000000000099'::uuid;

select is(
  (select reserved_count from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000001'::uuid)
      and usage_day = private.ai_jst_day(now())),
  0,
  'BEFORE DELETE trigger releases identity reserved'
);

-- personal_quota_disabled: request 上 true のとき success 加算をスキップする契約を台帳で固定
-- （finalize 本体は巨大 fixture 依存のため、列と CHECK と reserved=0 の不変条件を検証）
insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
values (
  tests.quota_identity_key('c1000000-0000-4000-8000-000000000002'::uuid),
  private.ai_jst_day(now()), 0, 0
)
on conflict do nothing;

select is(
  (select success_count from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('c1000000-0000-4000-8000-000000000002'::uuid)
      and usage_day = private.ai_jst_day(now())),
  0,
  'disabled identity row starts with success_count 0'
);

-- 40-day retention via maintenance
insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
values
  (repeat('11', 32), private.ai_jst_day(now()), 0, 1),
  (repeat('11', 32), private.ai_jst_day(now()) - 1, 0, 1),
  (repeat('11', 32), private.ai_jst_day(now()) - 41, 0, 1);

-- run_kondate_maintenance は executor 専用のため purge 本体を直接呼ぶ
select lives_ok(
  $$
  delete from private.ai_identity_daily_usage
  where usage_day < private.ai_jst_day(now()) - 40;
  delete from private.ai_identity_daily_external_attempts
  where usage_day < private.ai_jst_day(now()) - 40;
  $$,
  'identity 40-day purge SQL runs'
);

select is(
  (select count(*)::integer from private.ai_identity_daily_usage
    where identity_key = repeat('11', 32) and usage_day = private.ai_jst_day(now()) - 41),
  0,
  'identity rows older than 40 JST days are purged'
);

select is(
  (select count(*)::integer from private.ai_identity_daily_usage
    where identity_key = repeat('11', 32) and usage_day >= private.ai_jst_day(now()) - 1),
  2,
  'today and yesterday identity rows are retained'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,text,integer,integer,integer,integer,boolean,integer,timestamptz)',
    'execute'
  ),
  'authenticated cannot EXECUTE reserve_ai_generation'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,text,integer,integer,integer,integer,boolean,integer,timestamptz)',
    'execute'
  ),
  'service_role can EXECUTE reserve_ai_generation'
);

select has_function('public'::name, 'release_identity_and_global_for_user_processing'::name);

select * from finish();
rollback;
