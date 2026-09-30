\ir 000_helpers.sql
begin;
select plan(24);
select tests.isolate_local_ai_global_usage();
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

select public.reserve_ai_generation(
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'a2000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  );
create temporary table background_test_request as select id from private.ai_generation_requests where idempotency_key = 'a3000000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('anon', 'public.claim_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'anon cannot claim');
select ok(not has_function_privilege('authenticated', 'public.claim_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'authenticated cannot claim');
select ok(not has_function_privilege('anon', 'public.register_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'anon cannot register');
select ok(has_function_privilege('service_role', 'public.claim_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'service may claim');
select set_config('request.jwt.claim.role', 'service_role', true);
select is((public.register_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001')->>'token'), 'a4000000-0000-4000-8000-000000000001', 'token registered');
select is((public.register_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000002')->>'token'), 'a4000000-0000-4000-8000-000000000001', 're-dispatch retains token');
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000002', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'other owner rejected');
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000002'), false, 'wrong token rejected');
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), true, 'first claim accepted');
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'second claim rejected');
select ok((select status = 'processing' and user_quota_reserved and user_attempt_reserved and global_sent_calls = 0 from private.ai_generation_requests where id = (select id from background_test_request)), 'claim does not send or alter reservations');
select is((public.register_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000002')->>'token'), null, 'claimed token is not reissued');

-- 制約を外さず同じ予約行の時刻だけを動かし、SQL 自身の期限判定を観測する。
select ok(not has_function_privilege('authenticated', 'public.register_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'authenticated cannot register');
select ok(has_function_privilege('service_role', 'public.register_menu_background_dispatch(uuid,uuid,uuid)', 'execute'), 'service may register');
update private.ai_generation_requests set background_claimed_at = null, status = 'succeeded' where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'succeeded request rejected');
update private.ai_generation_requests set status = 'failed' where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'failed request rejected');
update private.ai_generation_requests set status = 'constraint_conflict', terminal_details = '{"conflictCodes":["must_use_conflict"]}'::jsonb where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'conflict request rejected');
update private.ai_generation_requests set status = 'processing', terminal_details = null, started_at = now() + interval '1 second' where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'future acceptance rejected');
update private.ai_generation_requests set started_at = now() - interval '120 seconds' where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'exact 120s acceptance boundary rejected');
update private.ai_generation_requests set started_at = now(), processing_expires_at = now() where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'processing expiry boundary rejected');
update private.ai_generation_requests set processing_expires_at = null where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), false, 'null processing expiry rejected');
select throws_ok($sql$ update private.ai_generation_requests set started_at = null where id = (select id from background_test_request) $sql$, '23502', null, 'schema rejects null acceptance timestamp');
update private.ai_generation_requests set started_at = now() - interval '119.999 seconds', processing_expires_at = now() + interval '60 seconds' where id = (select id from background_test_request);
select is(public.claim_menu_background_dispatch('a1000000-0000-4000-8000-000000000001', (select id from background_test_request), 'a4000000-0000-4000-8000-000000000001'), true, 'immediately before acceptance boundary allowed');
select ok((select user_quota_reserved and user_attempt_reserved and global_sent_calls = 0 from private.ai_generation_requests where id = (select id from background_test_request)), 'all deadline and terminal checks preserve quota reservations and send count');
select * from finish();
rollback;
