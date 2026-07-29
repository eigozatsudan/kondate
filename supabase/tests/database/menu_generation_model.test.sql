\ir 000_helpers.sql
-- get_menu_generation_model: 所有者のみ最終モデル ID を返す

begin;
select plan(6);

create extension if not exists pgtap with schema extensions;

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'menu-model-owner@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'menu-model-other@example.invalid'
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id
) values (
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'dinner', 'japanese', 2, 20,
  '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'household',
  'dict', 'rule', 'schema',
  'a2000000-0000-4000-8000-000000000001'::uuid
);

insert into private.ai_generation_requests (
  id, user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac, user_usage_day,
  completed_menu_id, actual_model_ids, started_at, completed_at
) values (
  'a3000000-0000-4000-8000-000000000001'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'a3000000-0000-4000-8000-0000000000a1'::uuid,
  'regenerate_menu',
  'succeeded',
  'generation-command.v2',
  repeat('1', 64),
  date '2026-07-11',
  'a2000000-0000-4000-8000-000000000001'::uuid,
  array['mock/primary:free', 'mock/repair:free']::text[],
  '2026-07-11 00:00:00+00',
  '2026-07-11 00:00:01+00'
);

-- 未認証は null
select tests.clear_authentication();
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000001'::uuid),
  null,
  'unauthenticated caller gets null'
);

-- 所有者は配列末尾（最終モデル）を得る
select tests.authenticate_as('a1000000-0000-4000-8000-000000000001'::uuid);
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000001'::uuid),
  'mock/repair:free',
  'owner gets last actual_model_ids entry'
);

-- 他人の献立は null（存在漏洩しない）
select tests.authenticate_as('a1000000-0000-4000-8000-000000000002'::uuid);
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000001'::uuid),
  null,
  'non-owner gets null'
);

-- 存在しない menu は null
select tests.authenticate_as('a1000000-0000-4000-8000-000000000001'::uuid);
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000099'::uuid),
  null,
  'missing menu returns null'
);

-- モデル未記録の成功行は null
-- idea 行は allergen/food_safety version を NULL にする（menus_target_mode_versions_check）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id
) values (
  'a2000000-0000-4000-8000-000000000002'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'lunch', 'any', 1, 10,
  '{}'::jsonb, '{}'::jsonb, repeat('b', 64), 'idea',
  null, null, 'schema',
  'a2000000-0000-4000-8000-000000000002'::uuid
);
insert into private.ai_generation_requests (
  id, user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac, user_usage_day,
  completed_menu_id, actual_model_ids, started_at, completed_at
) values (
  'a3000000-0000-4000-8000-000000000002'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'a3000000-0000-4000-8000-0000000000a2'::uuid,
  'regenerate_menu',
  'succeeded',
  'generation-command.v2',
  repeat('2', 64),
  date '2026-07-11',
  'a2000000-0000-4000-8000-000000000002'::uuid,
  array[]::text[],
  '2026-07-11 00:00:00+00',
  '2026-07-11 00:00:01+00'
);
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000002'::uuid),
  null,
  'empty actual_model_ids returns null'
);

-- 失敗行だけなら null
-- idea 行は allergen/food_safety version を NULL にする（menus_target_mode_versions_check）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id
) values (
  'a2000000-0000-4000-8000-000000000003'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'breakfast', 'western', 1, 15,
  '{}'::jsonb, '{}'::jsonb, repeat('c', 64), 'idea',
  null, null, 'schema',
  'a2000000-0000-4000-8000-000000000003'::uuid
);
insert into private.ai_generation_requests (
  id, user_id, identity_key, personal_quota_disabled, idempotency_key, request_kind, status,
  request_hmac_version, request_hmac, user_usage_day,
  completed_menu_id, actual_model_ids, failure_code, started_at, completed_at
) values (
  'a3000000-0000-4000-8000-000000000003'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  tests.quota_identity_key('a1000000-0000-4000-8000-000000000001'::uuid),
  false,
  'a3000000-0000-4000-8000-0000000000a3'::uuid,
  'regenerate_menu',
  'failed',
  'generation-command.v2',
  repeat('3', 64),
  date '2026-07-11',
  'a2000000-0000-4000-8000-000000000003'::uuid,
  array['mock/primary:free']::text[],
  'generation_timeout',
  '2026-07-11 00:00:00+00',
  '2026-07-11 00:00:01+00'
);
select is(
  public.get_menu_generation_model('a2000000-0000-4000-8000-000000000003'::uuid),
  null,
  'failed request is ignored even with model ids'
);

select * from finish();
rollback;
