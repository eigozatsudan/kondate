\ir 000_helpers.sql

begin;
select plan(11);

select tests.create_supabase_user('11111111-1111-4111-8111-111111111111'::uuid, 'owner@example.com');

-- authenticated から表 select は届かない（private はそもそも search_path に無い）
set local role authenticated;
select throws_ok(
  $$select * from private.weekly_plan_intents$$,
  '42501', null, 'authenticated cannot select private.weekly_plan_intents'
);
select throws_ok(
  $$select public.put_weekly_plan_intent(gen_random_uuid(), '11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb, repeat('a', 64))$$,
  '42501', null, 'authenticated cannot execute put_weekly_plan_intent'
);
select throws_ok(
  $$select public.get_weekly_plan_intent(gen_random_uuid(), '11111111-1111-4111-8111-111111111111'::uuid)$$,
  '42501', null, 'authenticated cannot execute get_weekly_plan_intent'
);
select throws_ok(
  $$select public.delete_weekly_plan_intent(gen_random_uuid())$$,
  '42501', null, 'authenticated cannot execute delete_weekly_plan_intent'
);
reset role;

-- service_role から RPC 経由で put / get / delete 可
set local role service_role;
select lives_ok(
  $$select public.put_weekly_plan_intent(
      '55555555-5555-4555-8555-555555555555'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      '{"targetMemberIds":[]}'::jsonb,
      repeat('a', 64)
    )$$,
  'service_role can put a weekly_plan_intent'
);
select is(
  (select count(*) from public.get_weekly_plan_intent(
    '55555555-5555-4555-8555-555555555555'::uuid, '11111111-1111-4111-8111-111111111111'::uuid
  ))::int, 1,
  'get returns the matching row'
);
select is(
  (select count(*) from public.get_weekly_plan_intent(
    '55555555-5555-4555-8555-555555555555'::uuid, '22222222-2222-4222-8222-222222222222'::uuid
  ))::int, 0,
  'get returns nothing for a mismatched user_id'
);
select public.delete_weekly_plan_intent('55555555-5555-4555-8555-555555555555'::uuid);
reset role;

-- run_kondate_maintenance: failed 24h 超と succeeded+public行ありの intent は消える。
-- succeeded+public行なし、processing の intent は残る。既存の戻りキーは不変（9キー）。
-- run_kondate_maintenance 自体は kondate_maintenance_executor にしか GRANT していない
-- （service_role にも許可しない、N-I-8）。pgTAP のデフォルトロール（postgres、テーブル所有者の
-- スーパーユーザー）で直接呼ぶ — 既存 maintenance_cleanup.test.sql と同じ流儀（GRANT を経由しない）。
--
-- WP-P-4: private.flyer_weekly_requests は revoke all のまま（service_role にも
-- テーブル権限を与えていない、20260729160000_flyer_weekly.sql:88）。よって fixture の
-- insert into private.flyer_weekly_requests / insert into public.weekly_plans は
-- postgres（デフォルトロール、テーブル所有者）のまま行う — service_role へは切り替えない。
-- service_role への切り替えは put_weekly_plan_intent（service_role 限定 GRANT の RPC）を
-- 呼ぶ直前・直後だけに最小化する。

-- fixture: failed 24h 超の request + intent
-- identity_key / started_at は NOT NULL（20260729160000_flyer_weekly.sql）。
insert into private.flyer_weekly_requests (id, user_id, identity_key, idempotency_key, status, started_at, completed_at, week_start)
values ('66666666-6666-4666-8666-666666666666'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
        tests.quota_identity_key('11111111-1111-4111-8111-111111111111'::uuid),
        'k-failed-old', 'failed', now() - interval '25 hours', now() - interval '25 hours', '2026-08-31');
set local role service_role;
select public.put_weekly_plan_intent('66666666-6666-4666-8666-666666666666'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb, repeat('a', 64));
reset role;

-- fixture: succeeded + weekly_plans 行あり
insert into private.flyer_weekly_requests (id, user_id, identity_key, idempotency_key, status, started_at, completed_at, week_start)
values ('77777777-7777-4777-8777-777777777777'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
        tests.quota_identity_key('11111111-1111-4111-8111-111111111111'::uuid),
        'k-succeeded-has-row', 'succeeded', now() - interval '10 minutes', now(), '2026-08-31');
set local role service_role;
select public.put_weekly_plan_intent('77777777-7777-4777-8777-777777777777'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb, repeat('a', 64));
reset role;
insert into public.weekly_plans (user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days)
values ('11111111-1111-4111-8111-111111111111'::uuid, '2026-08-31', 'household',
        '77777777-7777-4777-8777-777777777777'::uuid, '{}'::jsonb, repeat('a', 64), '[]'::jsonb);

-- fixture: succeeded + weekly_plans 行なし（残すべき）
insert into private.flyer_weekly_requests (id, user_id, identity_key, idempotency_key, status, started_at, completed_at, week_start)
values ('88888888-8888-4888-8888-888888888888'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
        tests.quota_identity_key('11111111-1111-4111-8111-111111111111'::uuid),
        'k-succeeded-no-row', 'succeeded', now() - interval '10 minutes', now(), '2026-08-31');
set local role service_role;
select public.put_weekly_plan_intent('88888888-8888-4888-8888-888888888888'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb, repeat('a', 64));
reset role;

-- fixture: processing（残すべき）
insert into private.flyer_weekly_requests (id, user_id, identity_key, idempotency_key, status, started_at, week_start)
values ('99999999-9999-4999-8999-999999999999'::uuid, '11111111-1111-4111-8111-111111111111'::uuid,
        tests.quota_identity_key('11111111-1111-4111-8111-111111111111'::uuid),
        'k-processing', 'processing', now() - interval '10 minutes', '2026-08-31');
set local role service_role;
select public.put_weekly_plan_intent('99999999-9999-4999-8999-999999999999'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb, repeat('a', 64));
reset role;

-- run_kondate_maintenance は GRANT を持たない postgres（テーブル所有者）から直接呼ぶ。
select public.run_kondate_maintenance(now(), 250);

select is(
  (select count(*) from private.weekly_plan_intents where request_id = '66666666-6666-4666-8666-666666666666'::uuid)::int,
  0, 'failed 24h+ intent is removed'
);
select is(
  (select count(*) from private.weekly_plan_intents where request_id = '77777777-7777-4777-8777-777777777777'::uuid)::int,
  0, 'succeeded intent with an existing public row is removed'
);
select is(
  (select count(*) from private.weekly_plan_intents where request_id = '88888888-8888-4888-8888-888888888888'::uuid)::int,
  1, 'succeeded intent with no public row is kept'
);
select is(
  (select count(*) from private.weekly_plan_intents where request_id = '99999999-9999-4999-8999-999999999999'::uuid)::int,
  1, 'processing intent is kept'
);

select * from finish();
rollback;
