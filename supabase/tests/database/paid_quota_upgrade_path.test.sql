\ir 000_helpers.sql
-- identity 日次 CHECK（成功3 / attempt6）・user 削除後残存・authenticated EXECUTE 否。
-- Plan 8 user 台帳 upgrade 経路は identity 移行で廃止。

begin;
select plan(13);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'identity-share-a@example.invalid'
);

select has_table('private'::name, 'ai_identity_daily_usage'::name);
select has_table('private'::name, 'ai_identity_daily_external_attempts'::name);
select hasnt_table('private'::name, 'ai_user_daily_usage'::name);
select hasnt_table('private'::name, 'ai_user_daily_external_attempts'::name);

select throws_ok(
  $$insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
    values (tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid), private.ai_jst_day(now()), 2, 2)$$,
  '23514',
  NULL,
  'identity success ledger rejects reserved+success > 3'
);

select lives_ok(
  $$insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
    values (tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid), private.ai_jst_day(now()), 1, 2)$$,
  'identity success ledger accepts reserved+success = 3'
);

select throws_ok(
  $$insert into private.ai_identity_daily_external_attempts (identity_key, usage_day, reserved_count, sent_count)
    values (tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid), private.ai_jst_day(now()), 3, 4)$$,
  '23514',
  NULL,
  'identity attempt ledger rejects reserved+sent > 6'
);

select lives_ok(
  $$insert into private.ai_identity_daily_external_attempts (identity_key, usage_day, reserved_count, sent_count)
    values (tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid), private.ai_jst_day(now()), 2, 4)$$,
  'identity attempt ledger accepts reserved+sent = 6'
);

insert into private.ai_identity_daily_usage (identity_key, usage_day, reserved_count, success_count)
values (repeat('ab', 32), private.ai_jst_day(now()), 0, 3)
on conflict do nothing;

select is(
  (select success_count from private.ai_identity_daily_usage
    where identity_key = repeat('ab', 32) and usage_day = private.ai_jst_day(now())),
  3,
  'shared identity_key holds success_count'
);

select lives_ok(
  $$delete from auth.users where id = 'b1000000-0000-4000-8000-000000000001'::uuid$$,
  'auth user delete succeeds'
);

select is(
  (select count(*)::integer from private.ai_identity_daily_usage
    where identity_key = tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid)),
  1,
  'identity usage row survives auth.users delete'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.release_identity_and_global_for_user_processing(uuid,timestamptz)',
    'execute'
  ),
  'authenticated cannot EXECUTE release_identity_and_global_for_user_processing'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.release_identity_and_global_for_user_processing(uuid,timestamptz)',
    'execute'
  ),
  'service_role can EXECUTE release_identity_and_global_for_user_processing'
);

select * from finish();
rollback;
