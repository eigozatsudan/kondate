\ir 000_helpers.sql

begin;
select plan(7);

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

select * from finish();
rollback;
