begin;
select plan(60);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-a@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-b@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_member_ids,
  time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'dinner', array['鶏肉'], 'japanese',
  array['10000000-0000-4000-8000-000000000001'::uuid],
  30, 'standard', array[]::text[], '', '[]'::jsonb, 1
);

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_member_ids,
  time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'lunch', array['豆腐'], 'chinese',
  array['10000000-0000-4000-8000-000000000002'::uuid],
  15, 'economy', array['えび'], '辛さ控えめ', '[]'::jsonb, 2
);

select has_table('private'::name, 'ai_generation_requests'::name);
select has_table('private'::name, 'generation_draft_submission_versions'::name);
select has_table('private'::name, 'ai_user_daily_usage'::name);
select has_table('private'::name, 'ai_global_daily_usage'::name);
select hasnt_table('public'::name, 'ai_generation_requests'::name);
select has_function('public'::name, 'reserve_ai_generation'::name);
select has_function('public'::name, 'reserve_ai_repair_call'::name);
select has_function('public'::name, 'mark_ai_global_sent'::name);
select has_function('public'::name, 'finalize_ai_generation_failure'::name);
select has_function('public'::name, 'cleanup_stale_ai_generations'::name);
select has_function('public'::name, 'get_ai_generation_submission_snapshot'::name);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
  ) is not null,
  'the interim reservation RPC has the exact nine-argument signature'
);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,integer,integer,integer,timestamptz)'
  ) is null,
  'the obsolete eight-argument reservation RPC is absent'
);
select ok(
  to_regprocedure(
    'public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz)'
  ) is not null,
  'the final 13-argument success finalizer exists'
);
select ok(
  coalesce(
    not has_function_privilege(
      'service_role',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb)'
      ),
      'EXECUTE'
    ),
    false
  ),
  'the private persistence helper is not externally executable'
);
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure(
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    to_regprocedure(
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  ),
  'only service_role can execute the interim reservation RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.get_ai_generation_submission_snapshot(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    to_regprocedure('public.get_ai_generation_submission_snapshot(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.get_ai_generation_submission_snapshot(uuid,uuid)'),
    'EXECUTE'
  ),
  'only service_role can read an immutable generation submission snapshot'
);
select table_privs_are('private', 'ai_generation_requests', 'authenticated', array[]::text[]);
select is(private.ai_jst_day('2026-07-10 14:59:59+00'), date '2026-07-10');
select is(private.ai_jst_day('2026-07-10 15:00:00+00'), date '2026-07-11');

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099',
    'new_menu', null, null, 6, 45, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'release_quota_mismatch',
  'the database rejects an environment-only success-limit override');

select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
select is((select count(*) from private.ai_global_daily_usage), 0::bigint);
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000097',
    'regenerate_menu', null, null, 5, 0, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a zero global limit before generation reservation');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000098',
    'regenerate_menu', null, null, 5, 46, 180, '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a global limit above the release maximum before generation reservation');
select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
select is((select count(*) from private.ai_global_daily_usage), 0::bigint);

insert into private.ai_user_daily_usage (
  user_id, usage_day, reserved_count, success_count, updated_at
) values (
  '10000000-0000-4000-8000-000000000002', date '2026-07-11', 1, 0,
  '2026-07-10 15:00:00+00'
);
insert into private.ai_global_daily_usage (
  usage_day, reserved_count, sent_count, updated_at
) values (
  date '2026-07-11', 1, 0, '2026-07-10 15:00:00+00'
);
insert into private.ai_generation_requests (
  user_id, idempotency_key, request_kind, status, user_usage_day,
  user_quota_reserved, global_reserved_day, processing_expires_at, started_at
) values (
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000090',
  'regenerate_menu', 'processing', date '2026-07-11', true, date '2026-07-11',
  '2026-07-10 15:30:00+00', '2026-07-10 15:00:00+00'
);

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000091',
    'new_menu', '30000000-0000-4000-8000-000000000099', 1,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a missing draft is rejected before lifecycle mutation');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000092',
    'new_menu', '30000000-0000-4000-8000-000000000001', 1,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a foreign draft is rejected without revealing ownership');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000093',
    'new_menu', '30000000-0000-4000-8000-000000000002', 1,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a stale draft revision is rejected');

update public.generation_drafts
set deleted_at = '2026-07-10 15:45:00+00'
where id = '30000000-0000-4000-8000-000000000002';
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000094',
    'new_menu', '30000000-0000-4000-8000-000000000002', 2,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a deleted draft is rejected');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000095',
    'regenerate_menu', '30000000-0000-4000-8000-000000000002', 2,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, '22023', 'invalid_draft_reference',
  'a non-new request rejects draft arguments');
select is(
  (select count(*) from private.ai_generation_requests
    where idempotency_key between
      '20000000-0000-4000-8000-000000000091'
      and '20000000-0000-4000-8000-000000000095'),
  0::bigint,
  'invalid drafts create no request ledger rows'
);
select is(
  (select count(*) from private.generation_draft_submission_versions),
  0::bigint,
  'invalid drafts create no immutable snapshots'
);
select is(
  (select jsonb_build_object(
    'status', status,
    'failure_code', failure_code,
    'processing_expires_at', processing_expires_at
  ) from private.ai_generation_requests
    where idempotency_key = '20000000-0000-4000-8000-000000000090'),
  jsonb_build_object(
    'status', 'processing',
    'failure_code', null,
    'processing_expires_at', '2026-07-10 15:30:00+00'::timestamptz
  ),
  'an invalid draft does not clean an unrelated stale request'
);
select is(
  (select jsonb_build_object(
    'user_reserved', u.reserved_count,
    'user_success', u.success_count,
    'global_reserved', g.reserved_count,
    'global_sent', g.sent_count
  )
  from private.ai_user_daily_usage u
  join private.ai_global_daily_usage g using (usage_day)
  where u.user_id = '10000000-0000-4000-8000-000000000002'
    and u.usage_day = date '2026-07-11'),
  jsonb_build_object(
    'user_reserved', 1,
    'user_success', 0,
    'global_reserved', 1,
    'global_sent', 0
  ),
  'invalid drafts leave every existing quota counter unchanged'
);

delete from private.ai_generation_requests
where idempotency_key = '20000000-0000-4000-8000-000000000090';
delete from private.ai_user_daily_usage
where user_id = '10000000-0000-4000-8000-000000000002';
delete from private.ai_global_daily_usage where usage_day = date '2026-07-11';

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu', '30000000-0000-4000-8000-000000000001',
    1, 5, 45, 180, '2026-07-10 15:00:00+00'
  )->>'status',
  'processing'
);
select is(
  (select jsonb_build_object(
    'draft_id', draft_id,
    'user_id', user_id,
    'draft_revision', draft_revision,
    'meal_type', meal_type,
    'main_ingredients', main_ingredients,
    'cuisine_genre', cuisine_genre,
    'target_member_ids', target_member_ids,
    'time_limit_minutes', time_limit_minutes,
    'budget_preference', budget_preference,
    'avoid_ingredients', avoid_ingredients,
    'memo', memo,
    'pantry_selections', pantry_selections,
    'captured_at', captured_at
  ) from private.generation_draft_submission_versions
    where draft_id = '30000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'draft_id', '30000000-0000-4000-8000-000000000001'::uuid,
    'user_id', '10000000-0000-4000-8000-000000000001'::uuid,
    'draft_revision', 1,
    'meal_type', 'dinner',
    'main_ingredients', array['鶏肉'],
    'cuisine_genre', 'japanese',
    'target_member_ids', array['10000000-0000-4000-8000-000000000001'::uuid],
    'time_limit_minutes', 30,
    'budget_preference', 'standard',
    'avoid_ingredients', array[]::text[],
    'memo', '',
    'pantry_selections', '[]'::jsonb,
    'captured_at', '2026-07-10 15:00:00+00'::timestamptz
  ),
  'a new-menu reservation captures the exact immutable draft submission'
);
select is(
  (select draft_revision from private.ai_generation_requests
    where idempotency_key = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a new-menu request stores the accepted draft revision'
);
select is(
  (select jsonb_build_object(
    'draft_id', draft_id,
    'draft_revision', draft_revision,
    'meal_type', meal_type,
    'main_ingredients', main_ingredients,
    'cuisine_genre', cuisine_genre,
    'target_member_ids', target_member_ids,
    'time_limit_minutes', time_limit_minutes,
    'budget_preference', budget_preference,
    'avoid_ingredients', avoid_ingredients,
    'memo', memo,
    'pantry_selections', pantry_selections,
    'captured_at', captured_at
  ) from public.get_ai_generation_submission_snapshot(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    '10000000-0000-4000-8000-000000000001'
  )),
  jsonb_build_object(
    'draft_id', '30000000-0000-4000-8000-000000000001'::uuid,
    'draft_revision', 1,
    'meal_type', 'dinner',
    'main_ingredients', array['鶏肉'],
    'cuisine_genre', 'japanese',
    'target_member_ids', array['10000000-0000-4000-8000-000000000001'::uuid],
    'time_limit_minutes', 30,
    'budget_preference', 'standard',
    'avoid_ingredients', array[]::text[],
    'memo', '',
    'pantry_selections', '[]'::jsonb,
    'captured_at', '2026-07-10 15:00:00+00'::timestamptz
  ),
  'the typed RPC returns the exact immutable submission for its request and owner'
);
select is(
  (select count(*) from public.get_ai_generation_submission_snapshot(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    '10000000-0000-4000-8000-000000000002'
  )),
  0::bigint,
  'the snapshot RPC returns no row for a wrong owner'
);

update public.generation_drafts
set deleted_at = '2026-07-10 15:00:00.500+00'
where id = '30000000-0000-4000-8000-000000000001';
select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu', '30000000-0000-4000-8000-000000000001',
    1, 5, 45, 180, '2026-07-10 15:00:01+00'
  )->>'replayed',
  'true'
);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 1);
select is((select reserved_count from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'), 1);

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'regenerate_menu', null, null, 5, 45, 180, '2026-07-10 15:00:02+00'
  )->>'failure_code',
  'generation_in_progress'
);

select lives_ok($$
  select public.mark_ai_global_sent(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    '2026-07-10 15:00:03+00'
  )
$$);
select is((select jsonb_build_object(
  'status', status,
  'repair_attempted', repair_attempted,
  'global_reserved_day', global_reserved_day,
  'global_sent_calls', global_sent_calls
) from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'status', 'processing',
    'repair_attempted', false,
    'global_reserved_day', null,
    'global_sent_calls', 1
  ));
select is((select jsonb_build_object(
  'reserved_count', reserved_count,
  'sent_count', sent_count
) from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'),
  jsonb_build_object('reserved_count', 0, 'sent_count', 1));
select throws_ok($$
  select public.reserve_ai_repair_call(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    0, '2026-07-10 15:00:04+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a zero global limit before repair reservation');
select throws_ok($$
  select public.reserve_ai_repair_call(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    46, '2026-07-10 15:00:05+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a global limit above the release maximum before repair reservation');
select is((select jsonb_build_object(
  'status', status,
  'repair_attempted', repair_attempted,
  'global_reserved_day', global_reserved_day,
  'global_sent_calls', global_sent_calls
) from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'status', 'processing',
    'repair_attempted', false,
    'global_reserved_day', null,
    'global_sent_calls', 1
  ));
select is((select jsonb_build_object(
  'reserved_count', reserved_count,
  'sent_count', sent_count
) from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'),
  jsonb_build_object('reserved_count', 0, 'sent_count', 1));

select lives_ok($$
  select public.finalize_ai_generation_failure(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000001'),
    'model_unavailable', '2026-07-10 15:05:00+00', '2026-07-10 15:00:03+00'
  )
$$);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 0);

update public.generation_drafts
set meal_type = 'breakfast', main_ingredients = array['ごはん'], cuisine_genre = 'any',
    target_member_ids = array['10000000-0000-4000-8000-000000000002'::uuid],
    time_limit_minutes = null, budget_preference = null, avoid_ingredients = array[]::text[],
    memo = '', pantry_selections = '[]'::jsonb, revision = 3, deleted_at = null
where id = '30000000-0000-4000-8000-000000000002';
select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    'new_menu', '30000000-0000-4000-8000-000000000002',
    3, 5, 45, 180, '2026-07-10 15:10:00+00'
  )->>'status',
  'processing',
  'a new-menu reservation accepts nullable optional submission fields'
);
select is(
  (select jsonb_build_object(
    'time_limit_minutes', time_limit_minutes,
    'budget_preference', budget_preference
  ) from public.get_ai_generation_submission_snapshot(
    (select id from private.ai_generation_requests
      where idempotency_key = '20000000-0000-4000-8000-000000000003'),
    '10000000-0000-4000-8000-000000000002'
  )),
  jsonb_build_object('time_limit_minutes', null, 'budget_preference', null),
  'nullable optional submission fields round-trip through the typed RPC'
);
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_member_ids,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', array['10000000-0000-4000-8000-000000000002'::uuid], 20,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'the immutable snapshot rejects an invalid time limit');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_member_ids,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', array['10000000-0000-4000-8000-000000000002'::uuid], 15,
    'luxury', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'the immutable snapshot rejects an invalid budget preference');
select is(
  (select count(*) from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'get_ai_generation_submission_snapshot'
      and grantee in ('PUBLIC', 'anon', 'authenticated')),
  0::bigint,
  'the snapshot RPC has no broad routine grants'
);
select is(
  (select count(*) from information_schema.routines
    where routine_schema = 'public'
      and routine_name = 'get_ai_generation_submission_snapshot'
      and security_type = 'DEFINER'),
  1::bigint,
  'the snapshot RPC is a security-definer owner boundary'
);

select * from finish();
rollback;
