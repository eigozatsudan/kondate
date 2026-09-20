\ir 000_helpers.sql

begin;
select plan(7);

create extension if not exists pgtap with schema extensions;

select tests.isolate_local_ai_global_usage();

select tests.create_supabase_user(
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'reserve-deleted-member@example.invalid'
);

-- 生存側 / 削除側の2メンバー（complete 必須列を満たす）
insert into public.household_members (
  id, user_id, status, display_name, age_band,
  allergy_status, unsupported_diet_status
) values
  (
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'complete', 'いき', 'adult', 'none', 'none'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    'complete', 'さくじょ', 'adult', 'none', 'none'
  );

-- household モードの source menu（servings は menus 側 not null / context 側も数値必須）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'dinner', 'japanese', 2, 30,
  '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'household',
  'dict-v1', 'rule-v1', 'menu-v1',
  'b5000000-0000-4000-8000-000000000001', 1
);

insert into public.dishes (
  id, menu_id, user_id, role, position, name, description, cooking_time_minutes
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'main', 1, 'さかな', 'やく', 20
);

insert into public.menu_target_members (
  menu_id, user_id, household_member_id, household_member_user_id,
  anonymous_ref, member_display_name_snapshot
) values
  (
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'member_1', 'いき'
  ),
  (
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000001',
    'member_2', 'さくじょ'
  );

-- メンバー削除: on delete set null でリンク行が household_member_id NULL のまま残る
delete from public.household_members
where id = 'b2000000-0000-4000-8000-000000000002'
  and user_id = 'b1000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)::integer
    from public.menu_target_members
    where menu_id = 'b3000000-0000-4000-8000-000000000001'
      and household_member_id is null
  ),
  1,
  'deleted member leaves a NULL household_member_id link row'
);

-- 修正前は {生存uuid,NULL} vs payload {生存uuid} で source_menu_changed に永久失敗
select lives_ok(
  $$select public.reserve_ai_generation(
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'b6000000-0000-4000-8000-000000000001'::uuid,
    'regenerate_menu', null, null,
    'b3000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('c', 64),
    '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["b2000000-0000-4000-8000-000000000001"],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  )$$,
  'regenerate_menu reserve succeeds after deleting one targeted member'
);

select is(
  (
    select status
    from private.ai_generation_requests
    where user_id = 'b1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'b6000000-0000-4000-8000-000000000001'
  ),
  'processing',
  'menu regeneration request is processing'
);

select is(
  (
    select target_member_ids
    from private.generation_regeneration_snapshots
    where user_id = 'b1000000-0000-4000-8000-000000000001'
      and source_menu_id = 'b3000000-0000-4000-8000-000000000001'
      and kind = 'regenerate_menu'
  ),
  array['b2000000-0000-4000-8000-000000000001']::uuid[],
  'snapshot target_member_ids contains only the surviving member'
);

-- processing 一意制約を避けるため既存 request を掃除してから dish 再生成を検証
delete from private.ai_generation_requests
where user_id = 'b1000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.reserve_ai_generation(
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'b6000000-0000-4000-8000-000000000002'::uuid,
    'regenerate_dish', null, null,
    'b3000000-0000-4000-8000-000000000001'::uuid,
    'b4000000-0000-4000-8000-000000000001'::uuid, 'simpler',
    'generation-command.v3', repeat('d', 64),
    '{"kind":"regenerate_dish","target_mode":"household","servings":2,"target_member_ids":["b2000000-0000-4000-8000-000000000001"],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  )$$,
  'regenerate_dish reserve succeeds after deleting one targeted member'
);

select is(
  (
    select status
    from private.ai_generation_requests
    where user_id = 'b1000000-0000-4000-8000-000000000001'
      and idempotency_key = 'b6000000-0000-4000-8000-000000000002'
  ),
  'processing',
  'dish regeneration request is processing'
);

delete from private.ai_generation_requests
where user_id = 'b1000000-0000-4000-8000-000000000001';

-- 削除済みメンバーを含む古い payload は引き続き source_menu_changed で拒否
select throws_ok(
  $$select public.reserve_ai_generation(
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'b6000000-0000-4000-8000-000000000003'::uuid,
    'regenerate_menu', null, null,
    'b3000000-0000-4000-8000-000000000001'::uuid, null, 'simpler',
    'generation-command.v3', repeat('e', 64),
    '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["b2000000-0000-4000-8000-000000000001","b2000000-0000-4000-8000-000000000002"],"source_menu_version":1}'::jsonb,
    tests.quota_identity_key('b1000000-0000-4000-8000-000000000001'::uuid),
    5, 20, 8, 20, false, false, 180, now()
  )$$,
  'P0001',
  'source_menu_changed',
  'stale payload containing the deleted member still fails'
);

select finish();
rollback;
