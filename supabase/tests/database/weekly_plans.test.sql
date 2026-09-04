\ir 000_helpers.sql

begin;
select plan(10);

select tests.create_supabase_user('11111111-1111-4111-8111-111111111111'::uuid, 'owner@example.com');
select tests.create_supabase_user('22222222-2222-4222-8222-222222222222'::uuid, 'other@example.com');

insert into public.weekly_plans (
  id, user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days
) values (
  '33333333-3333-4333-8333-333333333333'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '2026-09-07',
  'household',
  '44444444-4444-4444-8444-444444444444'::uuid,
  '{"targetMemberIds":[],"cuisineGenre":"japanese","budgetPreference":null,"noveltyPreference":null}'::jsonb,
  repeat('a', 64),
  '[]'::jsonb
);

-- 他人 select 0 行
select tests.authenticate_as('22222222-2222-4222-8222-222222222222'::uuid);
set local role authenticated;
select is(
  (select count(*) from public.weekly_plans)::int, 0,
  'other user cannot select any weekly_plans row'
);

-- 所有者 select 1 行
-- authenticated ロールは schema tests へ USAGE を持たないため、authenticate_as を
-- 呼ぶ前に必ず reset role する（002_household_rls.test.sql と同じ流儀）。
reset role;
select tests.authenticate_as('11111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;
select is(
  (select count(*) from public.weekly_plans)::int, 1,
  'owner can select their own weekly_plans row'
);

-- authenticated の insert / update / delete は 42501
select throws_ok(
  $$insert into public.weekly_plans (user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days)
    values ('11111111-1111-4111-8111-111111111111'::uuid, '2026-09-07', 'household', gen_random_uuid(),
            '{}'::jsonb, repeat('a', 64), '[]'::jsonb)$$,
  '42501', null, 'authenticated cannot insert into weekly_plans'
);
select throws_ok(
  $$update public.weekly_plans set week_start = '2026-09-14' where id = '33333333-3333-4333-8333-333333333333'::uuid$$,
  '42501', null, 'authenticated cannot update weekly_plans'
);
select throws_ok(
  $$delete from public.weekly_plans where id = '33333333-3333-4333-8333-333333333333'::uuid$$,
  '42501', null, 'authenticated cannot delete weekly_plans'
);
reset role;

-- service_role の insert / update / delete は可
set local role service_role;
select lives_ok(
  $$update public.weekly_plans set week_start = '2026-09-14' where id = '33333333-3333-4333-8333-333333333333'::uuid$$,
  'service_role can update weekly_plans'
);

-- request_id 重複は 23505
select throws_ok(
  $$insert into public.weekly_plans (user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days)
    values ('11111111-1111-4111-8111-111111111111'::uuid, '2026-09-07', 'household',
            '44444444-4444-4444-8444-444444444444'::uuid, '{}'::jsonb, repeat('a', 64), '[]'::jsonb)$$,
  '23505', null, 'duplicate request_id is rejected'
);

-- source CHECK
select throws_ok(
  $$insert into public.weekly_plans (user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days)
    values ('11111111-1111-4111-8111-111111111111'::uuid, '2026-09-07', 'idea',
            gen_random_uuid(), '{}'::jsonb, repeat('a', 64), '[]'::jsonb)$$,
  '23514', null, 'source must be household'
);

select lives_ok(
  $$delete from public.weekly_plans where id = '33333333-3333-4333-8333-333333333333'::uuid$$,
  'service_role can delete weekly_plans'
);
reset role;

-- ユーザー削除で cascade
-- INSERT は grant all があるので service_role のままでよいが、auth.users の DELETE は
-- 必ず reset role してから既定ロール（postgres）で行う。SET ROLE 後の service_role は
-- スーパーユーザ権限を失い auth.users への表 ACL を持たないため 42501 で
-- トランザクションが abort し plan(10) が finish しない。
-- 既存 paid_quota_upgrade_path.test.sql / account_deletion.test.sql と同じ流儀。
-- auth.users へ GRANT を足してはいけない（アクセス行列外へ権限が広がり
-- rls_inventory の棚卸しにも掛からない）。SECURITY DEFINER の削除ヘルパー新設も禁止。
set local role service_role;
insert into public.weekly_plans (user_id, week_start, source, request_id, preference_snapshot, safety_fingerprint, days)
values ('22222222-2222-4222-8222-222222222222'::uuid, '2026-09-07', 'household',
        gen_random_uuid(), '{}'::jsonb, repeat('a', 64), '[]'::jsonb);
reset role;
delete from auth.users where id = '22222222-2222-4222-8222-222222222222'::uuid;
select is(
  (select count(*) from public.weekly_plans where user_id = '22222222-2222-4222-8222-222222222222'::uuid)::int,
  0,
  'deleting the user cascades to weekly_plans'
);

select * from finish();
rollback;
