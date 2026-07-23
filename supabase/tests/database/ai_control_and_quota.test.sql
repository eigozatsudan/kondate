\ir 000_helpers.sql
begin;
select no_plan();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-a@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'quota-b@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
  servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'dinner', array['鶏肉'], 'japanese', 'household',
  array['10000000-0000-4000-8000-000000000001'::uuid],
  null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1
);

insert into public.generation_drafts (
  id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
  servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
  pantry_selections, revision
) values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'lunch', array['豆腐'], 'chinese', 'household',
  array['10000000-0000-4000-8000-000000000002'::uuid],
  null, 15, 'economy', array['えび'], '辛さ控えめ', '[]'::jsonb, 2
);

select tests.create_supabase_user(
  '15000000-0000-4000-8000-000000000001',
  'fingerprint-owner-a@example.invalid'
);
select tests.create_supabase_user(
  '15000000-0000-4000-8000-000000000002',
  'fingerprint-owner-b@example.invalid'
);

-- UUID順と逆順で作成し、物理的な挿入順へ依存しないことを固定する。
insert into public.household_members (
  id, user_id, status, display_name, age_band, allergy_status,
  required_safety_constraints, unsupported_diet_status, unsupported_diet_kinds
) values
  (
    '15100000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    'complete', '大人', 'adult', 'none',
    '{}', 'none', '{}'
  ),
  (
    '15100000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    'draft', '子ども', 'age_3_5', 'registered',
    array['remove_bones', 'cut_small'],
    'present',
    array['therapeutic_diet', 'swallowing_concern']
  ),
  (
    '15100000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    'draft', '下書き', null, null,
    '{}', null, '{}'
  ),
  (
    '15200000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000002',
    'complete', '別世帯', 'adult', 'none',
    '{}', 'none', '{}'
  );

-- allergen ID順と異なる順序で作成する。
insert into public.member_allergies (
  id, user_id, member_id, allergen_id,
  custom_name, custom_aliases, custom_confirmed
) values
  (
    '15300000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'wheat', null, '{}', false
  ),
  (
    '15300000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    null, '独自食材', array['独自別名'], true
  ),
  (
    '15300000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'egg', null, '{}', false
  );

-- 登録済みアレルギーを要求する即時triggerを満たしてから、対象memberを完了状態にする。
update public.household_members
set status = 'complete'
where id = '15100000-0000-4000-8000-000000000001';

select has_function(
  'private',
  'current_safety_fingerprint',
  array['uuid', 'uuid[]'],
  'current fingerprint helper has the exact input signature'
);
select function_returns(
  'private',
  'current_safety_fingerprint',
  array['uuid', 'uuid[]'],
  'text',
  'current fingerprint helper returns text'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'current_safety_fingerprint'
  ),
  1,
  'current fingerprint helper has no overload'
);

select has_function(
  'private',
  'lock_and_assert_current_safety_fingerprint',
  array['uuid', 'uuid[]', 'text'],
  'locking fingerprint helper has the exact input signature'
);
select function_returns(
  'private',
  'lock_and_assert_current_safety_fingerprint',
  array['uuid', 'uuid[]', 'text'],
  'void',
  'locking fingerprint helper returns void'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'lock_and_assert_current_safety_fingerprint'
  ),
  1,
  'locking fingerprint helper has no overload'
);

select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  'current fingerprint helper is SECURITY INVOKER'
);
select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
  ),
  'locking fingerprint helper is SECURITY INVOKER'
);
select is(
  (
    select procedure_.provolatile::text
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  's',
  'current fingerprint helper is STABLE'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
  ),
  array['search_path=""']::text[],
  'current fingerprint helper has an empty search_path'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
  ),
  array['search_path=""']::text[],
  'locking fingerprint helper has an empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure_
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_.proacl,
        pg_catalog.acldefault('f', procedure_.proowner)
      )
    ) privilege_
    where procedure_.oid =
      to_regprocedure('private.current_safety_fingerprint(uuid,uuid[])')
      and privilege_.grantee = 0
      and privilege_.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.current_safety_fingerprint(uuid,uuid[])',
    'EXECUTE'
  ),
  'PUBLIC and every external role cannot execute the current helper'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure_
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_.proacl,
        pg_catalog.acldefault('f', procedure_.proowner)
      )
    ) privilege_
    where procedure_.oid = to_regprocedure(
      'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
    )
      and privilege_.grantee = 0
      and privilege_.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)',
    'EXECUTE'
  ),
  'PUBLIC and every external role cannot execute the locking helper'
);

select is(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'fingerprint matches the canonical TypeScript-compatible SHA-256'
);
select is(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000002',
      '15100000-0000-4000-8000-000000000001'
    ]::uuid[]
  ),
  'fca553a2d6bcaeabbe6b5725a9330d358564e542dd1e333c0316a1c43564f3b4',
  'anonymous references follow input ordinality before UUID encoding order'
);

select throws_ok($$
  select private.current_safety_fingerprint(
    null::uuid,
    array['15100000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null owner is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', null::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null member array is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', '{}'::uuid[]
  )
$$, '22023', 'invalid_target_members', 'an empty member array is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001', array[null]::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a null member element is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000001'
    ]::uuid[]
  )
$$, '22023', 'invalid_target_members', 'duplicate members are rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15900000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a missing member is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15200000-0000-4000-8000-000000000001']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a foreign member is rejected');
select throws_ok($$
  select private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array['15100000-0000-4000-8000-000000000003']::uuid[]
  )
$$, '22023', 'invalid_target_members', 'a draft member is rejected');

-- 登録済みmemberの最後のallergy削除を防ぐtriggerに従い、再構築中だけ未確認へ戻す。
update public.household_members
set allergy_status = 'unconfirmed'
where id = '15100000-0000-4000-8000-000000000001';

delete from public.member_allergies
where member_id = '15100000-0000-4000-8000-000000000001';

-- 同じlogical setを異なる順序で再作成し、row insertion order非依存を固定する。
insert into public.member_allergies (
  id, user_id, member_id, allergen_id,
  custom_name, custom_aliases, custom_confirmed
) values
  (
    '15300000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'egg', null, '{}', false
  ),
  (
    '15300000-0000-4000-8000-000000000003',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    null, '独自食材', array['独自別名'], true
  ),
  (
    '15300000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    '15100000-0000-4000-8000-000000000001',
    'wheat', null, '{}', false
  );

update public.household_members
set allergy_status = 'registered'
where id = '15100000-0000-4000-8000-000000000001';

select is(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'member and allergy insertion order does not change the fingerprint'
);

select lives_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[],
    'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69'
  )
$$, 'the locking helper accepts the exact current fingerprint');
select throws_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[], null
  )
$$, '22023', 'current_safety_changed',
  'the locking helper rejects a null expected fingerprint');

delete from public.member_allergies
where id = '15300000-0000-4000-8000-000000000001';

select isnt(
  private.current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[]
  ),
  'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69',
  'an allergy mutation changes the fingerprint'
);
select throws_ok($$
  select private.lock_and_assert_current_safety_fingerprint(
    '15000000-0000-4000-8000-000000000001',
    array[
      '15100000-0000-4000-8000-000000000001',
      '15100000-0000-4000-8000-000000000002'
    ]::uuid[],
    'afde2ad162c9a24e82e5c6dc95ab60f458fcf317e39f5dee10d91963c05e5a69'
  )
$$, 'P0001', 'current_safety_changed',
  'the locking helper rejects a stale expected fingerprint');

select ok(
  (
    select
      pg_catalog.strpos(definition_, 'from public.household_members member') > 0
      and pg_catalog.strpos(
        definition_, 'from public.member_allergies allergy'
      ) > pg_catalog.strpos(
        definition_, 'from public.household_members member'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.allergen_catalog in share mode'
      ) > pg_catalog.strpos(
        definition_, 'from public.member_allergies allergy'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.allergen_aliases in share mode'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.allergen_catalog in share mode'
      )
      and pg_catalog.strpos(
        definition_, 'lock table public.food_safety_rules in share mode'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.allergen_aliases in share mode'
      )
      and pg_catalog.strpos(
        definition_, 'v_actual:=private.current_safety_fingerprint'
      ) > pg_catalog.strpos(
        definition_, 'lock table public.food_safety_rules in share mode'
      )
    from (
      select pg_catalog.pg_get_functiondef(
        to_regprocedure(
          'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
        )
      ) as definition_
    ) function_
  ),
  'locking helper keeps member, allergy, catalog, alias, rule, recalculation order'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      to_regprocedure(
        'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
      )
    ),
    'order by member.id for update'
  ) > 0,
  'locking helper takes member row locks in UUID order with FOR UPDATE'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      to_regprocedure(
        'private.lock_and_assert_current_safety_fingerprint(uuid,uuid[],text)'
      )
    ),
    'order by allergy.member_id,allergy.id for share'
  ) > 0,
  'locking helper takes allergy row locks in member and allergy order with FOR SHARE'
);

select has_function(
  'private',
  'assign_regeneration_lineage',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'lineage hook has the exact input signature'
);
select function_returns(
  'private',
  'assign_regeneration_lineage',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'void',
  'lineage hook returns void'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'private'
      and procedure_.proname = 'assign_regeneration_lineage'
  ),
  1,
  'lineage hook has no overload'
);
-- Plan 4 Task 1 が SECURITY DEFINER + search_path=pg_catalog,pg_temp で本体を置換した
select ok(
  (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  'lineage hook is SECURITY DEFINER'
);
select is(
  (
    select procedure_.provolatile::text
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  'v',
  'lineage hook is VOLATILE'
);
select is(
  (
    select procedure_.proconfig
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  array['search_path=pg_catalog, pg_temp']::text[],
  'lineage hook pins search_path to pg_catalog, pg_temp'
);
select ok(
  coalesce(
    not exists (
      select 1
      from pg_catalog.pg_proc procedure_
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_.proacl,
          pg_catalog.acldefault('f', procedure_.proowner)
        )
      ) privilege_
      where procedure_.oid = to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      )
        and privilege_.grantee = 0
        and privilege_.privilege_type = 'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      to_regprocedure(
        'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
      ),
      'EXECUTE'
    ),
    false
  ),
  'PUBLIC and every external role cannot execute the lineage hook'
);
select lives_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    null::text
  )
$$, 'the lineage hook accepts an all-null new-menu lineage');
-- Plan 4 本体: 部分 lineage / 不正 reason は invalid_*（P0001 スタブは廃止）
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000003'::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    null::text
  )
$$, '22023', 'invalid_change_reason',
  'the lineage hook rejects a source-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    'simpler'::text,
    null::text
  )
$$, '22023', 'invalid_regeneration_lineage',
  'the lineage hook rejects a reason-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    '自由記述'::text
  )
$$, '22023', 'invalid_regeneration_lineage',
  'the lineage hook rejects a custom-reason-only lineage');
select ok(
  (
    select
      pg_catalog.strpos(
        definition_, 'v_menu_id := private.persist_validated_menu('
      ) > 0
      and pg_catalog.strpos(
        definition_, 'perform private.assign_regeneration_lineage('
      ) > pg_catalog.strpos(
        definition_, 'v_menu_id := private.persist_validated_menu('
      )
      and pg_catalog.strpos(
        definition_, 'perform private.soft_delete_generation_draft('
      ) > pg_catalog.strpos(
        definition_, 'perform private.assign_regeneration_lineage('
      )
      and pg_catalog.strpos(
        definition_, 'update private.ai_user_daily_usage set'
      ) > pg_catalog.strpos(
        definition_, 'perform private.soft_delete_generation_draft('
      )
      and pg_catalog.strpos(
        definition_, 'update private.ai_generation_requests set'
      ) > pg_catalog.strpos(
        definition_, 'update private.ai_user_daily_usage set'
      )
    from (
      select pg_catalog.pg_get_functiondef(
        to_regprocedure(
          'public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz)'
        )
      ) as definition_
    ) function_
  ),
  'success finalization keeps persist, lineage, draft, quota, request order'
);

select has_table('private'::name, 'ai_generation_requests'::name);
select has_table('private'::name, 'generation_draft_submission_versions'::name);
select has_table('private'::name, 'ai_user_daily_usage'::name);
select has_table('private'::name, 'ai_global_daily_usage'::name);
select has_table('private'::name, 'ai_user_daily_external_attempts'::name);
select has_table('private'::name, 'ai_user_rate_windows'::name);
select hasnt_table('public'::name, 'ai_generation_requests'::name);
select has_function('public'::name, 'reserve_ai_generation'::name);
select has_function('public'::name, 'reserve_ai_repair_call'::name);
select has_function('public'::name, 'mark_ai_global_sent'::name);
select has_function('public'::name, 'finalize_ai_generation_failure'::name);
select has_function('public'::name, 'finalize_ai_generation_conflict'::name);
select has_function('public'::name, 'cleanup_stale_ai_generations'::name);
select has_function('public'::name, 'get_ai_generation_submission_snapshot'::name);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,integer,integer,integer,timestamptz)'
  ) is not null,
  'the final reservation RPC has the exact fifteen-argument signature'
);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,integer,integer,integer,timestamptz)'
  ) is null,
  'the obsolete fourteen-argument reservation RPC is absent'
);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
  ) is null,
  'the obsolete nine-argument reservation RPC is absent'
);
select ok(
  to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,integer,integer,integer,timestamptz)'
  ) is null,
  'the obsolete eight-argument reservation RPC is absent'
);
select ok(
  to_regprocedure(
    'public.finalize_ai_generation_conflict(uuid,text[],timestamptz)'
  ) is not null,
  'the final conflict RPC accepts validated text[] codes only'
);
select ok(
  to_regprocedure(
    'public.finalize_ai_generation_conflict(uuid,jsonb,timestamptz)'
  ) is null,
  'the obsolete jsonb conflict overload is absent'
);
select ok(
  to_regprocedure(
    'public.finalize_ai_generation_success(uuid,jsonb,jsonb,jsonb,text,text,text,jsonb,jsonb,uuid,text,text,timestamptz)'
  ) is not null,
  'the final 13-argument success finalizer exists'
);
select ok(
  (
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'private.ai_generation_requests'::regclass
      and attname = 'request_hmac_version'
      and not attisdropped
  ),
  'request_hmac_version is required'
);
select ok(
  (
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'private.ai_generation_requests'::regclass
      and attname = 'request_hmac'
      and not attisdropped
  ),
  'request_hmac is required'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_attribute
    where attrelid = 'private.ai_generation_requests'::regclass
      and not attisdropped
      and attname in (
        'request_body',
        'request_json',
        'prompt',
        'change_reason_custom'
      )
  ),
  0,
  'the request ledger stores neither raw request bodies nor free-text custom reasons'
);
select ok(
  coalesce(
    not has_function_privilege(
      'service_role',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,text,jsonb,jsonb)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,text,jsonb,jsonb)'
      ),
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      to_regprocedure(
        'private.persist_validated_menu(private.ai_generation_requests,jsonb,jsonb,jsonb,text,text,text,text,jsonb,jsonb)'
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
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    to_regprocedure(
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,integer,integer,integer,timestamptz)'
    ),
    'EXECUTE'
  ),
  'only service_role can execute the final reservation RPC'
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
select throws_ok($$
  set local role anon;
  select * from public.get_ai_generation_submission_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'anon is actually denied snapshot RPC execution');
select throws_ok($$
  set local role authenticated;
  select * from public.get_ai_generation_submission_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'authenticated is actually denied snapshot RPC execution');
select lives_ok($$
  set local role service_role;
  select * from public.get_ai_generation_submission_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  );
  reset role
$$, 'service_role can actually execute the snapshot RPC');
select table_privs_are('private', 'ai_generation_requests', 'authenticated', array[]::text[]);
select is(private.ai_jst_day('2026-07-10 14:59:59+00'), date '2026-07-10');
select is(private.ai_jst_day('2026-07-10 15:00:00+00'), date '2026-07-11');

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099',
    'new_menu', null, null, null, null, null,
    'generation-command.v2', repeat('9', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb, 6, 45, 180,
    '2026-07-10 15:00:00+00'
  )
$$, '22023', 'release_quota_mismatch',
  'the database rejects an environment-only success-limit override');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000096',
    'new_menu', null, null, null, null, null,
    'generation-command.v0', repeat('9', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb, 5, 45, 180,
    '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_request_hmac',
  'the database rejects a non-v2 request HMAC version');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000096',
    'new_menu', null, null, null, null, null,
    'generation-command.v2', repeat('g', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb, 5, 45, 180,
    '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_request_hmac',
  'the database rejects a non-hex request HMAC');

select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
-- グローバル表は user_id を持たない。拒否された予約が使う JST 日だけを密封する。
select is(
  (select count(*) from private.ai_global_daily_usage
    where usage_day = date '2026-07-11'),
  0::bigint,
  'invalid request HMAC creates no global usage for the attempted JST day'
);
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000097',
    'regenerate_menu', null, null, null, null, null,
    'generation-command.v2', repeat('7', 64), '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":1}'::jsonb, 5, 0, 180,
    '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a zero global limit before generation reservation');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000098',
    'regenerate_menu', null, null, null, null, null,
    'generation-command.v2', repeat('8', 64), '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":1}'::jsonb, 5, 46, 180,
    '2026-07-10 15:00:00+00'
  )
$$, '22023', 'invalid_quota_configuration',
  'the database rejects a global limit above the release maximum before generation reservation');
select is((select count(*) from private.ai_generation_requests
  where idempotency_key in (
    '20000000-0000-4000-8000-000000000097',
    '20000000-0000-4000-8000-000000000098'
  )), 0::bigint);
select is(
  (select count(*) from private.ai_global_daily_usage
    where usage_day = date '2026-07-11'),
  0::bigint,
  'invalid global quota configuration creates no global usage for the attempted JST day'
);

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
  request_hmac_version, request_hmac,
  user_quota_reserved, global_reserved_day, processing_expires_at, started_at
) values (
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000090',
  'regenerate_menu', 'processing', date '2026-07-11',
  'generation-command.v2', repeat('0', 64),
  true, date '2026-07-11',
  '2026-07-10 15:30:00+00', '2026-07-10 15:00:00+00'
);

select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000091',
    'new_menu', '30000000-0000-4000-8000-000000000099', 1,
    null, null, null, 'generation-command.v2', repeat('1', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a missing draft is rejected before lifecycle mutation');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000092',
    'new_menu', '30000000-0000-4000-8000-000000000001', 1,
    null, null, null, 'generation-command.v2', repeat('2', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a foreign draft is rejected without revealing ownership');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000093',
    'new_menu', '30000000-0000-4000-8000-000000000002', 1,
    null, null, null, 'generation-command.v2', repeat('3', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
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
    null, null, null, 'generation-command.v2', repeat('4', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_unavailable',
  'a deleted draft is rejected');
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000095',
    'regenerate_menu', '30000000-0000-4000-8000-000000000002', 2,
    null, null, null, 'generation-command.v2', repeat('5', 64), '{"kind":"regenerate_menu","target_mode":"household","servings":2,"target_member_ids":["10000000-0000-4000-8000-000000000002"],"source_menu_version":1}'::jsonb,
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
  (select count(*) from private.generation_draft_submission_versions
    where user_id = '10000000-0000-4000-8000-000000000002'),
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

-- Task 3 ブリッジ: idea / 未選択 draft は request・quota 行を作る前に拒否する
-- generation_drafts は user_id 一意のため、user2 の既存行を一時的に mode だけ差し替える。
update public.generation_drafts
set deleted_at = null,
    target_mode = 'idea',
    target_member_ids = array[]::uuid[],
    servings = 2
where id = '30000000-0000-4000-8000-000000000002';
-- idea draft は matching integrity で予約できる（Task 4）。mode 不一致は draft_revision_conflict。
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-0000000000a0',
    'new_menu', '30000000-0000-4000-8000-000000000002', 2,
    null, null, null, 'generation-command.v2', repeat('a', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000002"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_revision_conflict',
  'an idea draft rejects household integrity before request or quota mutation');
select lives_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-0000000000a2',
    'new_menu', '30000000-0000-4000-8000-000000000002', 2,
    null, null, null, 'generation-command.v2', repeat('f', 64), '{"kind":"new_menu","target_mode":"idea","servings":2,"target_member_ids":[],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'an idea draft can reserve with matching idea integrity');
-- 後続テストのため idea 予約を片付け
delete from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-0000000000a2';
delete from private.generation_draft_submission_versions
  where draft_id = '30000000-0000-4000-8000-000000000002';
delete from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000002';
delete from private.ai_user_daily_external_attempts
  where user_id = '10000000-0000-4000-8000-000000000002';
delete from private.ai_global_daily_usage where usage_day = date '2026-07-11';

update public.generation_drafts
set target_mode = null,
    target_member_ids = array[]::uuid[],
    servings = null
where id = '30000000-0000-4000-8000-000000000002';
select throws_ok($$
  select public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-0000000000a1',
    'new_menu', '30000000-0000-4000-8000-000000000002', 2,
    null, null, null, 'generation-command.v2', repeat('b', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000002"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 16:00:00+00'
  )
$$, 'P0001', 'draft_revision_conflict',
  'an unselected-mode draft is rejected before request or quota mutation');

select is(
  (select count(*) from private.ai_generation_requests
    where idempotency_key in (
      '20000000-0000-4000-8000-0000000000a0',
      '20000000-0000-4000-8000-0000000000a1'
    )),
  0::bigint,
  'unsupported target modes create no request ledger rows'
);
select is(
  (select count(*) from private.generation_draft_submission_versions
    where draft_id = '30000000-0000-4000-8000-000000000002'),
  0::bigint,
  'unsupported target modes create no immutable snapshots'
);
select is(
  (select count(*) from private.ai_user_daily_usage
    where user_id = '10000000-0000-4000-8000-000000000002'
      and usage_day = date '2026-07-11'),
  0::bigint,
  'unsupported target modes create no user quota rows'
);
select is(
  (select count(*) from private.ai_global_daily_usage
    where usage_day = date '2026-07-11'),
  0::bigint,
  'unsupported target modes create no global quota rows'
);

-- 後続ケース向けに household 契約へ戻し、削除済み状態を再設定する
update public.generation_drafts
set target_mode = 'household',
    target_member_ids = array['10000000-0000-4000-8000-000000000002'::uuid],
    servings = null,
    deleted_at = '2026-07-10 15:45:00+00'
where id = '30000000-0000-4000-8000-000000000002';

select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu', '30000000-0000-4000-8000-000000000001', 1,
    null, null, null, 'generation-command.v2', repeat('1', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 15:00:00+00'
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
    'target_mode', target_mode,
    'target_member_ids', target_member_ids,
    'servings', servings,
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
    'target_mode', 'household',
    'target_member_ids', array['10000000-0000-4000-8000-000000000001'::uuid],
    'servings', null,
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
    'target_mode', target_mode,
    'target_member_ids', target_member_ids,
    'servings', servings,
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
    'target_mode', 'household',
    'target_member_ids', array['10000000-0000-4000-8000-000000000001'::uuid],
    'servings', null,
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
select is(
  (select count(*) from public.get_ai_generation_submission_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'the snapshot RPC returns no row for a wrong request ID'
);

update public.generation_drafts
set deleted_at = '2026-07-10 15:00:00.500+00'
where id = '30000000-0000-4000-8000-000000000001';
select is(
  public.reserve_ai_generation(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'new_menu', '30000000-0000-4000-8000-000000000001', 1,
    null, null, null, 'generation-command.v2', repeat('1', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 15:00:01+00'
  )->>'replayed',
  'true'
);
select is((select reserved_count from private.ai_user_daily_usage
  where user_id = '10000000-0000-4000-8000-000000000001'), 1);
select is((select reserved_count from private.ai_global_daily_usage
  where usage_day = date '2026-07-11'), 1);
select is(
  (
    select jsonb_build_object(
      'version', request_hmac_version,
      'hmac', request_hmac
    )
    from private.ai_generation_requests
    where idempotency_key = '20000000-0000-4000-8000-000000000001'
  ),
  jsonb_build_object(
    'version', 'generation-command.v2',
    'hmac', repeat('1', 64)
  ),
  'a successful reservation stores the versioned request HMAC'
);

-- generation_in_progress 検証のため、先の soft-delete を戻して draft を再利用する
update public.generation_drafts
set deleted_at = null
where id = '30000000-0000-4000-8000-000000000001';

select is(
  (
    select public.reserve_ai_generation(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'new_menu', '30000000-0000-4000-8000-000000000001', 1,
      null, null, null,
      'generation-command.v2', repeat('2', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
      5, 45, 180, '2026-07-10 15:00:02+00'
    )
  ) - 'started_at' - 'completed_at' - 'retry_at' - 'processing_expires_at'
    - 'remaining' - 'user_daily_limit' - 'consumed',
  (
    select jsonb_build_object(
      'request_id', id,
      'idempotency_key', '20000000-0000-4000-8000-000000000002'::uuid,
      'status', 'failed',
      'failure_code', 'generation_in_progress',
      'completed_menu_id', null,
      'replayed', false
    )
    from private.ai_generation_requests
    where idempotency_key = '20000000-0000-4000-8000-000000000001'
  ),
  'generation_in_progress surfaces active request_id without a new ledger row'
);
select is(
  (select count(*) from private.ai_generation_requests
    where idempotency_key = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'generation_in_progress does not create a request ledger row'
);
-- p_now を処理期限内に固定しないと cleanup_stale が active を generation_timeout にする
select is(
  public.get_ai_generation_status(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    5,
    '2026-07-10 15:00:02+00'
  )->>'status',
  'not_started',
  'rejected key remains not_started in the ledger status RPC'
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
    'new_menu', '30000000-0000-4000-8000-000000000002', 3,
    null, null, null, 'generation-command.v2', repeat('3', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000002"],"source_menu_version":null}'::jsonb,
    5, 45, 180, '2026-07-10 15:10:00+00'
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
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'household', array['10000000-0000-4000-8000-000000000002'::uuid], null, 20,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'the immutable snapshot rejects an invalid time limit');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'household', array['10000000-0000-4000-8000-000000000002'::uuid], null, 15,
    'luxury', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'the immutable snapshot rejects an invalid budget preference');

-- 凍結提出テーブル自体の target_mode / servings / members 契約
select lives_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000020',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'household', array['10000000-0000-4000-8000-000000000002'::uuid], null, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, 'household freeze accepts 1-20 members with null servings');
select lives_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'idea', array[]::uuid[], 2::smallint, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, 'idea freeze accepts empty members with servings 1-20');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'idea', array['10000000-0000-4000-8000-000000000002'::uuid], 2::smallint, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'idea freeze rejects target members');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000023',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'household', array['10000000-0000-4000-8000-000000000002'::uuid], 2::smallint, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'household freeze rejects non-null servings');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000024',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'idea', array[]::uuid[], null, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'idea freeze rejects null servings');
select throws_ok($$
  insert into private.generation_draft_submission_versions(
    draft_id,user_id,draft_revision,meal_type,main_ingredients,cuisine_genre,
    target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,
    pantry_selections
  ) values (
    '30000000-0000-4000-8000-000000000025',
    '10000000-0000-4000-8000-000000000002', 1, 'breakfast', array['ごはん'],
    'any', 'household', array[]::uuid[], null, 15,
    'standard', array[]::text[], '', '[]'::jsonb
  )
$$, '23514', null, 'household freeze rejects empty target members');
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

-- 同一 key で異なる HMAC は cleanup/quota より先に拒否し、台帳・カウンタを一切動かさない
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000001';
  v_key constant uuid := '20000000-0000-4000-8000-000000000010';
  v_stale_key constant uuid := '20000000-0000-4000-8000-000000000011';
  v_before jsonb;
  v_after jsonb;
begin
  insert into private.ai_generation_requests (
    user_id, idempotency_key, request_kind, status, user_usage_day,
    request_hmac_version, request_hmac,
    user_quota_reserved, global_reserved_day, processing_expires_at, started_at
  ) values (
    v_owner, v_stale_key, 'regenerate_menu', 'processing', date '2026-07-11',
    'generation-command.v2', repeat('a', 64),
    true, date '2026-07-11',
    '2026-07-10 14:00:00+00', '2026-07-10 13:00:00+00'
  );
  insert into private.ai_generation_requests (
    user_id, idempotency_key, request_kind, status,
    draft_id, draft_revision, user_usage_day,
    request_hmac_version, request_hmac,
    user_quota_reserved, started_at, completed_at, failure_code
  ) values (
    v_owner, v_key, 'new_menu', 'failed',
    '30000000-0000-4000-8000-000000000001', 1, date '2026-07-11',
    'generation-command.v2', repeat('b', 64),
    false, '2026-07-10 15:20:00+00', '2026-07-10 15:20:01+00', 'model_unavailable'
  );

  select jsonb_build_object(
    'requests', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global', coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_before;

  begin
    perform public.reserve_ai_generation(
      v_owner, v_key, 'new_menu',
      '30000000-0000-4000-8000-000000000001', 1,
      null, null, null, 'generation-command.v2', repeat('c', 64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
      5, 45, 180, '2026-07-10 16:00:00+00'
    );
    raise exception using errcode = 'XX000', message = 'expected_idempotency_payload_mismatch';
  exception when sqlstate '22023' then
    if sqlerrm <> 'idempotency_payload_mismatch' then raise; end if;
  end;

  select jsonb_build_object(
    'requests', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global', coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'mismatched HMAC reservation changed ledger, snapshot, quota, or counter state';
  end if;
  if (select status from private.ai_generation_requests where idempotency_key = v_stale_key)
      is distinct from 'processing' then
    raise exception 'mismatched HMAC cleaned an unrelated stale processing request';
  end if;
end
$test$;
select pass('mismatched HMAC rejects before cleanup and leaves every counter unchanged');

-- 閉じた conflict 永続化: 無効・重複・12 超は無変更、許可コードは codes-only DTO のみ
do $test$
declare
  v_request_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_payload jsonb;
  v_codes text[];
begin
  select id into strict v_request_id
  from private.ai_generation_requests
  where idempotency_key = '20000000-0000-4000-8000-000000000003'
    and status = 'processing';

  select to_jsonb(r) into v_before
  from private.ai_generation_requests r where r.id = v_request_id;

  begin
    perform public.finalize_ai_generation_conflict(
      v_request_id, array['not_a_real_conflict'], '2026-07-10 15:20:00+00'
    );
    raise exception using errcode = 'XX000', message = 'expected_invalid_terminal_details';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid_terminal_details' then raise; end if;
  end;

  begin
    perform public.finalize_ai_generation_conflict(
      v_request_id,
      array['must_use_conflict', 'must_use_conflict'],
      '2026-07-10 15:20:00+00'
    );
    raise exception using errcode = 'XX000', message = 'expected_invalid_terminal_details';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid_terminal_details' then raise; end if;
  end;

  v_codes := array[
    'must_use_conflict',
    'allergen_pantry_conflict',
    'dish_count_conflict',
    'mandatory_safety_conflict',
    'current_safety_changed',
    'must_use_conflict',
    'allergen_pantry_conflict',
    'dish_count_conflict',
    'mandatory_safety_conflict',
    'current_safety_changed',
    'must_use_conflict',
    'allergen_pantry_conflict',
    'dish_count_conflict'
  ];
  begin
    perform public.finalize_ai_generation_conflict(
      v_request_id, v_codes, '2026-07-10 15:20:00+00'
    );
    raise exception using errcode = 'XX000', message = 'expected_invalid_terminal_details';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid_terminal_details' then raise; end if;
  end;

  select to_jsonb(r) into v_after
  from private.ai_generation_requests r where r.id = v_request_id;
  if v_after is distinct from v_before then
    raise exception 'invalid conflict codes mutated the request row';
  end if;

  v_payload := public.finalize_ai_generation_conflict(
    v_request_id,
    array['must_use_conflict', 'current_safety_changed'],
    '2026-07-10 15:20:00+00'
  );
  if v_payload->>'status' is distinct from 'constraint_conflict' then
    raise exception 'allowed conflict did not terminalize the request';
  end if;
  if (select terminal_details from private.ai_generation_requests where id = v_request_id)
      is distinct from jsonb_build_object(
        'conflictCodes',
        jsonb_build_array('must_use_conflict', 'current_safety_changed')
      ) then
    raise exception 'allowed conflict did not persist the closed conflict-code DTO';
  end if;

  begin
    update private.ai_generation_requests
    set terminal_details = jsonb_build_object(
      'conflictCodes', jsonb_build_array('must_use_conflict'),
      'message', 'forbidden prose'
    )
    where id = v_request_id;
    raise exception using errcode = 'XX000', message = 'expected_terminal_details_constraint';
  exception when check_violation then
    null;
  end;

  begin
    update private.ai_generation_requests
    set terminal_details = jsonb_build_object(
      'conflictCodes',
      jsonb_build_array(
        jsonb_build_object('code', 'must_use_conflict', 'message', 'nested')
      )
    )
    where id = v_request_id;
    raise exception using errcode = 'XX000', message = 'expected_terminal_details_constraint';
  exception when check_violation then
    null;
  end;
end
$test$;
select pass('conflict RPC rejects invalid codes and persists only closed conflictCodes');

-- 削除済み draft は最終シグネチャでも副作用ゼロ
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000071';
  v_draft_id constant uuid := '20000000-0000-4000-8000-000000000071';
  v_key constant uuid := '30000000-0000-4000-8000-000000000071';
  v_revision constant bigint := 7;
  v_deleted public.generation_drafts;
  v_before jsonb;
  v_after jsonb;
begin
  if to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,uuid,uuid,text,text,text,jsonb,integer,integer,integer,timestamptz)'
  ) is null then
    raise exception 'the final reservation signature is missing';
  end if;
  if to_regprocedure(
    'public.reserve_ai_generation(uuid,uuid,text,uuid,bigint,integer,integer,integer,timestamptz)'
  ) is not null then
    raise exception 'the obsolete reservation overload still exists';
  end if;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','deleted-reserve@example.invalid','','{}','{}',now(),now());
  insert into public.generation_drafts(
    id,user_id,meal_type,main_ingredients,cuisine_genre,target_mode,target_member_ids,servings,
    time_limit_minutes,budget_preference,avoid_ingredients,memo,pantry_selections,revision
  ) values(v_draft_id,v_owner,'dinner',array['鶏肉'],'japanese','household',
    array['10000000-0000-4000-8000-000000000001'::uuid],null,
    30,'standard',array[]::text[],'','[]',v_revision);

  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft_id,v_revision);
  if v_deleted.revision is distinct from v_revision + 1 then
    raise exception 'deleted reserve fixture did not advance the draft revision';
  end if;

  select jsonb_build_object(
    'requests',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global',coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_before;

  begin
    perform public.reserve_ai_generation(
      v_owner,v_key,'new_menu',v_draft_id,v_revision,
      null,null,null,'generation-command.v2',repeat('a',64), '{"kind":"new_menu","target_mode":"household","servings":null,"target_member_ids":["10000000-0000-4000-8000-000000000001"],"source_menu_version":null}'::jsonb,
      5,45,180,'2026-07-11 00:00:00+00');
    raise exception using errcode='XX000',message='expected_draft_unavailable';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_unavailable' then raise; end if;
  end;

  select jsonb_build_object(
    'requests',coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from private.ai_generation_requests t),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(t)
      order by t.draft_id,t.user_id,t.draft_revision)
      from private.generation_draft_submission_versions t),'[]'::jsonb),
    'success',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_usage t),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.usage_day)
      from private.ai_user_daily_external_attempts t),'[]'::jsonb),
    'windows',coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id,t.window_started_at)
      from private.ai_user_rate_windows t),'[]'::jsonb),
    'global',coalesce((select jsonb_agg(to_jsonb(t) order by t.usage_day)
      from private.ai_global_daily_usage t),'[]'::jsonb)
  ) into v_after;
  if v_after is distinct from v_before then
    raise exception 'deleted draft reservation changed ledger, snapshot, quota, or counter state';
  end if;
end
$test$;
select pass('deleted draft reservation rejects with the final signature and zero side effects');

-- C4: 唯一の canonical finalizer success fixture
create temporary table finalize_fixture_context(
  preference_snapshot jsonb not null,
  safety_snapshot jsonb not null,
  safety_fingerprint text not null,
  allergen_version text not null,
  food_rule_version text not null,
  target_members jsonb not null
) on commit drop;

create function pg_temp.finalize_ordering_success(
  p_request_id uuid,p_menu_id uuid,p_dish_id uuid,p_ingredient_id uuid,
  p_step_id uuid,p_timeline_id uuid,p_pantry_selection_id uuid,
  p_pantry_item_id uuid,p_checked_at timestamptz,p_now timestamptz,
  p_source_menu_id uuid default null,p_change_reason text default null,
  p_change_reason_custom text default null
) returns jsonb language plpgsql as $fixture$
declare
  v_context pg_temp.finalize_fixture_context;
  v_adaptation_id uuid := pg_catalog.gen_random_uuid();
  v_side1_dish_id uuid := pg_catalog.gen_random_uuid();
  v_side1_ingredient_id uuid := pg_catalog.gen_random_uuid();
  v_side1_step_id uuid := pg_catalog.gen_random_uuid();
  v_side2_dish_id uuid := pg_catalog.gen_random_uuid();
  v_side2_ingredient_id uuid := pg_catalog.gen_random_uuid();
  v_side2_step_id uuid := pg_catalog.gen_random_uuid();
  v_unchecked_selection_id uuid := pg_catalog.gen_random_uuid();
begin
  select * into strict v_context from pg_temp.finalize_fixture_context;
  return public.finalize_ai_generation_success(
    p_request_id,
    jsonb_build_object(
      'schemaVersion','2026-07-11.v1','menuId',p_menu_id,
      'mealType','dinner','cuisineGenre','japanese','servings',2,
      'totalElapsedMinutes',15,'safetyTags','[]'::jsonb,
      'dishes',jsonb_build_array(jsonb_build_object(
        'id',p_dish_id,'role','main','position',1,'name','白菜のクリーム煮',
        'description','短時間の煮物','cookingTimeMinutes',15,
        'ingredients',jsonb_build_array(jsonb_build_object(
          'id',p_ingredient_id,'position',1,'name','ホワイトソース',
          'quantityValue',200,'quantityText','200g','unit','g',
          'storeSection','seasonings','pantrySelectionId',p_pantry_selection_id,
          'labelConfirmationRequired',true)),
        'steps',jsonb_build_array(jsonb_build_object(
          'id',p_step_id,'position',1,'instruction','材料を中心まで加熱する'))),
        jsonb_build_object(
          'id',v_side1_dish_id,'role','side','position',2,'name','白菜のおひたし',
          'description','副菜','cookingTimeMinutes',10,
          'ingredients',jsonb_build_array(jsonb_build_object(
            'id',v_side1_ingredient_id,'position',1,'name','白菜',
            'quantityValue',100,'quantityText','100g','unit','g',
            'storeSection','produce','pantrySelectionId',null,
            'labelConfirmationRequired',false)),
          'steps',jsonb_build_array(jsonb_build_object(
            'id',v_side1_step_id,'position',1,'instruction','白菜をゆでる'))),
        jsonb_build_object(
          'id',v_side2_dish_id,'role','soup','position',3,'name','わかめ汁',
          'description','汁物','cookingTimeMinutes',10,
          'ingredients',jsonb_build_array(jsonb_build_object(
            'id',v_side2_ingredient_id,'position',1,'name','わかめ',
            'quantityValue',10,'quantityText','10g','unit','g',
            'storeSection','dry_goods','pantrySelectionId',null,
            'labelConfirmationRequired',false)),
          'steps',jsonb_build_array(jsonb_build_object(
            'id',v_side2_step_id,'position',1,'instruction','わかめを煮る')))),
      'timeline',jsonb_build_array(jsonb_build_object(
        'id',p_timeline_id,'position',1,'startMinute',0,'durationMinutes',15,
        'instruction','主菜を作る','dishId',p_dish_id,'recipeStepId',p_step_id)),
      'adaptations',jsonb_build_array(jsonb_build_object(
        'id',v_adaptation_id,'dishId',p_dish_id,
        'anonymousMemberRef','member_1','portionText','通常量',
        'branchBeforeRecipeStepId',p_step_id,
        'additionalCutting',null,'additionalHeating','中心まで十分に加熱する',
        'additionalSeasoning',null,'servingCheck','中心部の加熱を確認する',
        'safetyTags',jsonb_build_array('heat_thoroughly'),
        'safetyActions',jsonb_build_array(jsonb_build_object(
          'kind','heat_thoroughly','dishId',p_dish_id,
          'ingredientId',p_ingredient_id,'anonymousMemberRef','member_1',
          'beforeRecipeStepId',p_step_id,
          'instruction','材料を中心まで十分に加熱する')))),
      'pantryUsage',jsonb_build_array(jsonb_build_object(
        'selectionId',p_pantry_selection_id,'pantryItemId',p_pantry_item_id,
        'pantryItemName','ホワイトソース','priority','must_use','usageStatus','used',
        'plannedQuantity',200,'inventoryQuantity',200,'shortageQuantity',0,'unit','g',
        'dishIds',jsonb_build_array(p_dish_id),'unusedReason',null),
        jsonb_build_object(
          'selectionId',v_unchecked_selection_id,'pantryItemId',null,
          'pantryItemName','確認不要食材','priority','prefer_use','usageStatus','unused',
          'plannedQuantity',null,'inventoryQuantity',null,'shortageQuantity',null,
          'unit',null,'dishIds','[]'::jsonb,'unusedReason','今回は使わない')),
      'labelConfirmations',jsonb_build_array(jsonb_build_object(
        'sourceType','ingredient','sourceId',p_ingredient_id,
        'sourcePath','dishes.0.ingredients.0.name','sourceText','ホワイトソース',
        'allergenId','milk','anonymousMemberRef','member_1',
        'dictionaryVersion',v_context.allergen_version,
        'confirmationStatus','pending'))),
    v_context.preference_snapshot,v_context.safety_snapshot,v_context.safety_fingerprint,
    v_context.allergen_version,v_context.food_rule_version,
    v_context.target_members,jsonb_build_array(jsonb_build_object(
      'pantryItemId',p_pantry_item_id,'checkedAt',p_checked_at)),
    p_source_menu_id,p_change_reason,p_change_reason_custom,p_now);
end
$fixture$;

do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000072';
  v_member constant uuid := '20000000-0000-4000-8000-000000000072';
  v_pantry_item constant uuid := '22000000-0000-4000-8000-000000000072';
  v_draft public.generation_drafts;
  v_deleted public.generation_drafts;
  v_request_id uuid;
  v_result jsonb;
  v_target_ids uuid[];
  v_allergen_version text;
  v_food_rule_version text;
  v_fingerprint text;
  v_before_revision bigint;
  v_recreated_revision bigint;
  v_before jsonb;
  v_after jsonb;
  v_pantry_selections jsonb;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','ordering-finalizer@example.invalid','','{}','{}',now(),now());
  -- registered アレルギーは complete 遷移前に子行が必要（即時 trigger）
  insert into public.household_members(
    id,user_id,status,display_name,age_band,portion_size,spice_level,
    allergy_status,unsupported_diet_status,sort_order
  ) values(v_member,v_owner,'draft','注文確認','adult','regular','mild',
    'registered','none',0);
  insert into public.member_allergies(id,user_id,member_id,allergen_id)
  values('21000000-0000-4000-8000-000000000072',v_owner,v_member,'milk');
  update public.household_members
  set status = 'complete'
  where id = v_member;
  insert into public.pantry_items(
    id,user_id,name,quantity,unit,expires_on,expiration_type,opened_state
  ) values(v_pantry_item,v_owner,'ホワイトソース',200,'g','2026-07-10','use_by','opened');
  v_pantry_selections:=jsonb_build_array(jsonb_build_object(
    'pantryItemId',v_pantry_item,'priority','must_use'));
  select catalog_version into strict v_allergen_version
  from public.allergen_catalog where id='milk';
  select rule_version into strict v_food_rule_version
  from public.food_safety_rules order by id limit 1;
  v_target_ids := array[v_member];
  v_fingerprint := private.current_safety_fingerprint(v_owner,v_target_ids);
  insert into pg_temp.finalize_fixture_context values(
    jsonb_build_object('mealType','dinner'),
    jsonb_build_object('members',jsonb_build_array(jsonb_build_object(
      'householdMemberId',v_member,'anonymousRef','member_1','ageBand','adult',
      'allergyStatus','registered','allergenIds',jsonb_build_array('milk'),
      'requiredSafetyConstraints','[]'::jsonb,'unsupportedDietStatus','none',
      'unsupportedDietKinds','[]'::jsonb))),
    v_fingerprint,v_allergen_version,v_food_rule_version,
    jsonb_build_array(jsonb_build_object(
      'householdMemberId',v_member,'anonymousRef','member_1',
      'displayNameSnapshot','注文確認'))
  );
  perform set_config('request.jwt.claim.sub',v_owner::text,true);

  -- 実在 member/allergy/catalog/rule と最終 13 引数で canonical success を成立させる
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['canonical'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000080',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v2',repeat('e',64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', coalesce(v_draft.target_mode, 'household'),
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),5,45,180,'2026-07-11 00:00:10+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000080';
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:00:11+00');
  v_result := pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000080','61000000-0000-4000-8000-000000000080',
    '62000000-0000-4000-8000-000000000080','63000000-0000-4000-8000-000000000080',
    '64000000-0000-4000-8000-000000000080','65000000-0000-4000-8000-000000000080',
    v_pantry_item,'2026-07-10 15:00:00+00','2026-07-11 00:00:12+00');
  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'canonical finalizer fixture did not succeed';
  end if;
  if (select jsonb_build_object(
      'menus',(select count(*) from public.menus where id='60000000-0000-4000-8000-000000000080'),
      'targets',(select count(*) from public.menu_target_members where menu_id='60000000-0000-4000-8000-000000000080'),
      'dishes',(select count(*) from public.dishes where menu_id='60000000-0000-4000-8000-000000000080'),
      'ingredients',(select count(*) from public.dish_ingredients where menu_id='60000000-0000-4000-8000-000000000080'),
      'steps',(select count(*) from public.recipe_steps where menu_id='60000000-0000-4000-8000-000000000080'),
      'timeline',(select count(*) from public.menu_timeline_steps where menu_id='60000000-0000-4000-8000-000000000080'),
      'adaptations',(select count(*) from public.menu_member_adaptations where menu_id='60000000-0000-4000-8000-000000000080'),
      'actions',(select count(*) from public.menu_safety_actions
        where menu_id='60000000-0000-4000-8000-000000000080'
          and ingredient_id='62000000-0000-4000-8000-000000000080'),
      'labelRequired',(select label_confirmation_required
        from public.dish_ingredients
        where id='62000000-0000-4000-8000-000000000080'),
      'pantryLinked',(select pantry_selection_id='65000000-0000-4000-8000-000000000080'
        from public.dish_ingredients
        where id='62000000-0000-4000-8000-000000000080'),
      'pantryName',(select pantry_name_snapshot
        from public.generation_pantry_selections
        where id='65000000-0000-4000-8000-000000000080'),
      'pantryLiveName',(select name from public.pantry_items
        where id='22000000-0000-4000-8000-000000000072'),
      'reviewedAlias',(select exists(select 1 from public.allergen_aliases alias
        where alias.allergen_id='milk' and alias.normalized_alias='ホワイトソース'
          and alias.alias_kind='processed' and alias.requires_label_confirmation)),
      'targetMode',(select target_mode from public.menus
        where id='60000000-0000-4000-8000-000000000080'),
      'labelAllergen',(select allergen_id
        from public.menu_label_confirmations
        where menu_id='60000000-0000-4000-8000-000000000080'
          and source_id='62000000-0000-4000-8000-000000000080'),
      'sourceSnapshot',(select source_text_snapshot
        from public.menu_label_confirmations
        where menu_id='60000000-0000-4000-8000-000000000080'
          and source_id='62000000-0000-4000-8000-000000000080'),
      'checkDate',(select expired_item_check_jst_date::text
        from public.generation_pantry_selections
        where id='65000000-0000-4000-8000-000000000080'),
      'paired',(select (expired_item_checked_at is null)=(expired_item_check_jst_date is null)
        from public.generation_pantry_selections
        where id='65000000-0000-4000-8000-000000000080'),
      'unchecked',(select count(*) from public.generation_pantry_selections
        where menu_id='60000000-0000-4000-8000-000000000080'
          and pantry_name_snapshot='確認不要食材'
          and expired_item_checked_at is null
          and expired_item_check_jst_date is null)
    )) is distinct from jsonb_build_object(
      'menus',1,'targets',1,'dishes',3,'ingredients',3,'steps',3,
      'timeline',1,'adaptations',1,'actions',1,
      'labelRequired',true,'pantryLinked',true,'pantryName','ホワイトソース',
      'pantryLiveName','ホワイトソース',
      'reviewedAlias',true,'targetMode','household','labelAllergen','milk',
      'sourceSnapshot','ホワイトソース',
      'checkDate','2026-07-11','paired',true,'unchecked',1) then
    raise exception 'canonical finalizer did not commit every normalized child and ingredient-bound action';
  end if;

  -- 有効行削除、NULL、再作成後削除でも revision を単調増加させる
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['helper-1'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,v_draft.revision);
  if v_deleted.revision is distinct from v_draft.revision+1 then
    raise exception 'helper did not increment an active draft revision';
  end if;
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,null);
  if v_deleted is not null then
    raise exception 'helper did not return NULL for an already deleted draft';
  end if;
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['helper-2'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  v_deleted := private.soft_delete_generation_draft(v_owner,v_draft.id,null);
  if v_deleted.revision is distinct from v_draft.revision+1 then
    raise exception 'helper did not advance the recreated draft revision';
  end if;

  -- 手動削除が先でも finalizer は保存して成功する
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['manual-first'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000081',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v2',repeat('b',64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', coalesce(v_draft.target_mode, 'household'),
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),5,45,180,'2026-07-11 00:01:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000081';
  perform public.delete_generation_draft(v_draft.revision);
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:01:01+00');
  v_result := pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000081','61000000-0000-4000-8000-000000000081',
    '62000000-0000-4000-8000-000000000081','63000000-0000-4000-8000-000000000081',
    '64000000-0000-4000-8000-000000000081','65000000-0000-4000-8000-000000000081',
    v_pantry_item,'2026-07-11 00:00:59+00','2026-07-11 00:01:02+00');
  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'manual-delete-first finalizer did not succeed';
  end if;
  if (select count(*) from public.menus
      where id='60000000-0000-4000-8000-000000000081') <> 1 then
    raise exception 'manual-delete-first did not commit the menu';
  end if;

  -- finalizer が先なら、以前の public revision は stale になる
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['finalizer-first'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  v_before_revision := v_draft.revision;
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000082',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v2',repeat('c',64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', coalesce(v_draft.target_mode, 'household'),
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),5,45,180,'2026-07-11 00:02:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000082';
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:02:01+00');
  perform pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000082','61000000-0000-4000-8000-000000000082',
    '62000000-0000-4000-8000-000000000082','63000000-0000-4000-8000-000000000082',
    '64000000-0000-4000-8000-000000000082','65000000-0000-4000-8000-000000000082',
    v_pantry_item,'2026-07-11 00:01:59+00','2026-07-11 00:02:02+00');
  if (select revision from public.generation_drafts where id=v_draft.id)
      is distinct from v_before_revision+1 then
    raise exception 'matching finalizer did not advance the draft revision';
  end if;
  if not coalesce((select deleted_at is not null
      from public.generation_drafts where id=v_draft.id),false) then
    raise exception 'matching finalizer did not soft-delete the draft';
  end if;
  begin
    perform public.delete_generation_draft(v_before_revision);
    raise exception using errcode='XX000',message='expected_draft_revision_conflict';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_revision_conflict' then raise; end if;
  end;

  -- 予約後に別タブ保存された新 revision は finalizer が削除しない
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['reserved'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000083',
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v2',repeat('d',64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', coalesce(v_draft.target_mode, 'household'),
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),5,45,180,'2026-07-11 00:03:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000083';
  v_draft := public.save_generation_draft(v_draft.revision,'dinner',array['updated'],'japanese',
    'household',v_target_ids,null::smallint,30::smallint,'standard',array[]::text[],'',v_pantry_selections);
  v_recreated_revision := v_draft.revision;
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:03:01+00');
  perform pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000083','61000000-0000-4000-8000-000000000083',
    '62000000-0000-4000-8000-000000000083','63000000-0000-4000-8000-000000000083',
    '64000000-0000-4000-8000-000000000083','65000000-0000-4000-8000-000000000083',
    v_pantry_item,'2026-07-11 00:02:59+00','2026-07-11 00:03:02+00');
  if (select revision from public.generation_drafts where id=v_draft.id)
      is distinct from v_recreated_revision then
    raise exception 'finalizer changed the post-reservation draft revision';
  end if;
  if coalesce((select deleted_at is not null
      from public.generation_drafts where id=v_draft.id),true) then
    raise exception 'finalizer deleted the post-reservation draft';
  end if;

  -- draft 参照を持たない再生成は無関係な active draft を変更しない。
  -- Plan 4: lineage 本体により source+reason 付き finalization は成功する（成功枠1枠）。
  -- 日次上限 5 のため null-lineage 再生成の別 success はここに重ねず、
  -- 同一ケースで lineage 付与と draft 保全を同時検証する。
  v_before_revision := v_draft.revision;
  perform public.reserve_ai_generation(v_owner,'30000000-0000-4000-8000-000000000084',
    'regenerate_menu',null,null,'60000000-0000-4000-8000-000000000080',null,'simpler',
    'generation-command.v2',repeat('e',64), jsonb_build_object(
      'kind', 'regenerate_menu',
      'target_mode', 'household',
      'servings', 2,
      'target_member_ids', to_jsonb(v_target_ids),
      'source_menu_version', 1
    ),5,45,180,'2026-07-11 00:14:00+00');
  select id into strict v_request_id from private.ai_generation_requests
    where user_id=v_owner and idempotency_key='30000000-0000-4000-8000-000000000084';
  perform public.mark_ai_global_sent(v_request_id,'2026-07-11 00:14:01+00');
  v_result := pg_temp.finalize_ordering_success(v_request_id,
    '60000000-0000-4000-8000-000000000084','61000000-0000-4000-8000-000000000084',
    '62000000-0000-4000-8000-000000000084','63000000-0000-4000-8000-000000000084',
    '64000000-0000-4000-8000-000000000084','65000000-0000-4000-8000-000000000084',
    v_pantry_item,'2026-07-11 00:13:59+00','2026-07-11 00:14:02+00',
    '60000000-0000-4000-8000-000000000080','simpler',null);
  if v_result->>'status' is distinct from 'succeeded' then
    raise exception 'regeneration lineage finalizer did not succeed: %', v_result;
  end if;
  if (select parent_menu_id::text from public.menus
        where id='60000000-0000-4000-8000-000000000084')
      is distinct from '60000000-0000-4000-8000-000000000080' then
    raise exception 'regeneration lineage did not set parent_menu_id';
  end if;
  if (select change_reason from public.menus
        where id='60000000-0000-4000-8000-000000000084')
      is distinct from 'simpler' then
    raise exception 'regeneration lineage did not set change_reason';
  end if;
  if (select revision from public.generation_drafts where id=v_draft.id)
      is distinct from v_before_revision
     or coalesce((select deleted_at is not null
       from public.generation_drafts where id=v_draft.id),true) then
    raise exception 'regeneration did not preserve the unrelated active draft';
  end if;
end
$test$;
select pass('canonical finalization preserves matching, updated, and unrelated draft boundaries');

select is(
  (select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'public'
      and procedure_.proname = 'reserve_ai_generation'
      and pg_catalog.pg_get_function_identity_arguments(procedure_.oid)
        not like '%p_request_hmac%'),
  0,
  'zero remaining nine-argument reserve overloads'
);

-- C5: ラベル確認 RPC の overload と grant
select is(
  (select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'public'
      and procedure_.proname = 'confirm_menu_label_confirmation'
      and procedure_.pronargs = 2),
  0,
  'no two-argument confirm_menu_label_confirmation overload'
);
select is(
  (select count(*)::integer
    from pg_catalog.pg_proc procedure_
    join pg_catalog.pg_namespace namespace_
      on namespace_.oid = procedure_.pronamespace
    where namespace_.nspname = 'public'
      and procedure_.proname = 'confirm_menu_label_confirmation'
      and procedure_.pronargs = 3),
  1,
  'exactly one three-argument confirm_menu_label_confirmation'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.confirm_menu_label_confirmation(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.confirm_menu_label_confirmation(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.confirm_menu_label_confirmation(uuid,uuid,text)',
    'execute'
  ),
  'only authenticated may execute confirm_menu_label_confirmation'
);

-- C6: check 制約と retention / attempt 結合
select throws_ok(
  $$insert into private.ai_user_daily_usage(user_id, usage_day, reserved_count, success_count)
    values ('10000000-0000-4000-8000-000000000001', '2099-01-01', 3, 3)$$,
  '23514',
  null,
  'success table rejects reserved+success above 5'
);
select throws_ok(
  $$insert into private.ai_user_daily_external_attempts(user_id, usage_day, reserved_count, sent_count)
    values ('10000000-0000-4000-8000-000000000001', '2099-01-02', 7, 6)$$,
  '23514',
  null,
  'attempt table rejects reserved+sent above 12'
);
select throws_ok(
  $$insert into private.ai_user_rate_windows(user_id, window_started_at, sent_count)
    values ('10000000-0000-4000-8000-000000000001', '2026-07-11 00:00:00+00', 5)$$,
  '23514',
  null,
  'rate window rejects sent_count above 4'
);
select throws_ok(
  $$insert into private.ai_user_rate_windows(user_id, window_started_at, sent_count)
    values ('10000000-0000-4000-8000-000000000001', '2026-07-11 00:00:01+00', 0)$$,
  '23514',
  null,
  'rate window rejects non-600-aligned window_started_at'
);
select has_function('public'::name, 'cleanup_ai_generation_requests'::name);

do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000001';
  v_old uuid := '30000000-0000-4000-8000-0000000000a1';
  v_recent uuid := '30000000-0000-4000-8000-0000000000a2';
  v_processing uuid := '30000000-0000-4000-8000-0000000000a3';
  v_menu_linked uuid := '30000000-0000-4000-8000-0000000000a4';
  v_menu uuid := '60000000-0000-4000-8000-0000000000a4';
  v_deleted integer;
begin
  insert into private.ai_generation_requests(
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    failure_code, started_at, completed_at
  ) values
    (v_old, v_owner, '30000000-0000-4000-8000-0000000000b1', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('1', 64), date '2026-06-01',
     'generation_timeout', '2026-06-01 00:00:00+00', '2026-06-01 00:00:01+00'),
    (v_recent, v_owner, '30000000-0000-4000-8000-0000000000b2', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('2', 64), date '2026-07-01',
     'generation_timeout', '2026-07-01 00:00:00+00', '2026-07-01 00:00:01+00'),
    (v_processing, v_owner, '30000000-0000-4000-8000-0000000000b3', 'regenerate_menu', 'processing',
     'generation-command.v2', repeat('3', 64), date '2026-06-01',
     null, '2026-06-01 00:00:00+00', null);
  insert into public.menus(
    id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
    preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
    allergen_dictionary_version, food_safety_rule_version, output_schema_version,
    derivation_group_id
  ) values (
    v_menu, v_owner, 'dinner', 'japanese', 2, 15,
    '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'household',
    'dict', 'rule', 'schema', v_menu
  );
  insert into private.ai_generation_requests(
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    completed_menu_id, started_at, completed_at
  ) values (
    v_menu_linked, v_owner, '30000000-0000-4000-8000-0000000000b4', 'regenerate_menu', 'succeeded',
    'generation-command.v2', repeat('4', 64), date '2026-06-01',
    v_menu, '2026-06-01 00:00:00+00', '2026-06-01 00:00:01+00'
  );

  v_deleted := public.cleanup_ai_generation_requests('2026-07-11 00:00:00+00'::timestamptz - interval '30 days');
  if v_deleted < 1 then
    raise exception 'cleanup deleted fewer than one terminal row';
  end if;
  if exists(select 1 from private.ai_generation_requests where id = v_old) then
    raise exception '31-day terminal row was not deleted';
  end if;
  if not exists(select 1 from private.ai_generation_requests where id = v_recent) then
    raise exception '29-day terminal row was deleted';
  end if;
  if not exists(select 1 from private.ai_generation_requests where id = v_processing) then
    raise exception 'processing row was deleted';
  end if;
  if not exists(select 1 from private.ai_generation_requests where id = v_menu_linked) then
    raise exception 'menu-referenced terminal row was deleted';
  end if;
end
$test$;
select pass('cleanup_ai_generation_requests deletes only old terminal non-menu rows');

do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-0000000000ee';
  v_draft_id constant uuid := '30000000-0000-4000-8000-0000000000ee';
  v_draft public.generation_drafts;
  v_request_id uuid;
  v_payload jsonb;
  v_i integer;
  v_key uuid;
begin
  -- 先行 fixture の成功枠と独立した専用 owner で attempt / window 結合を検証する
  perform tests.create_supabase_user(v_owner, 'attempt-window@example.invalid');
  insert into public.generation_drafts (
    id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
    servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
    pantry_selections, revision
  ) values (
    v_draft_id, v_owner, 'dinner', array['鶏肉'], 'japanese', 'household',
    array[v_owner], null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1
  );

  select * into strict v_draft from public.generation_drafts where id = v_draft_id;
  v_payload := public.reserve_ai_generation(
    v_owner, '30000000-0000-4000-8000-0000000000c1', 'new_menu',
    v_draft.id, v_draft.revision, null, null, null,
    'generation-command.v2', repeat('c', 64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', v_draft.target_mode,
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),
    5, 45, 180, '2026-07-11 01:00:00+00'
  );
  if v_payload->>'status' is distinct from 'processing' then
    raise exception 'initial reserve did not process: %', v_payload;
  end if;
  select id into strict v_request_id from private.ai_generation_requests
    where idempotency_key = '30000000-0000-4000-8000-0000000000c1';
  if not coalesce((
    select user_attempt_reserved and user_attempt_day = date '2026-07-11'
    from private.ai_generation_requests where id = v_request_id
  ), false) then
    raise exception 'reserve did not flag user_attempt_reserved';
  end if;
  if (select reserved_count from private.ai_user_daily_external_attempts
      where user_id = v_owner and usage_day = date '2026-07-11') is distinct from 1 then
    raise exception 'reserve did not increment attempt reserved_count';
  end if;
  v_payload := public.mark_ai_global_sent(v_request_id, '2026-07-11 01:00:01+00');
  if v_payload->>'sent' is distinct from 'true' then
    raise exception 'markSent did not report sent=true: %', v_payload;
  end if;
  if (select sent_count from private.ai_user_daily_external_attempts
      where user_id = v_owner and usage_day = date '2026-07-11') is distinct from 1 then
    raise exception 'markSent did not convert attempt to sent';
  end if;
  if (select sent_count from private.ai_user_rate_windows
      where user_id = v_owner
        and window_started_at = '2026-07-11 01:00:00+00'::timestamptz) is distinct from 1 then
    raise exception 'markSent did not increment aligned rate window';
  end if;
  perform public.finalize_ai_generation_failure(
    v_request_id, 'invalid_ai_response', null, '2026-07-11 01:00:02+00'
  );

  -- 短期 4 回目まで成功、5 回目は user_short_window_limit（02:00 窓）
  for v_i in 1..4 loop
    update public.generation_drafts
    set deleted_at = null, revision = revision + 1
    where id = v_draft_id;
    select * into strict v_draft from public.generation_drafts where id = v_draft_id;
    v_key := ('30000000-0000-4000-8000-0000000000d' || v_i::text)::uuid;
    v_payload := public.reserve_ai_generation(
      v_owner, v_key, 'new_menu', v_draft.id, v_draft.revision, null, null, null,
      'generation-command.v2', repeat((v_i)::text, 64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', v_draft.target_mode,
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),
      5, 45, 180, '2026-07-11 02:00:00+00'
    );
    if v_payload->>'status' is distinct from 'processing' then
      raise exception 'window reserve % did not process: %', v_i, v_payload;
    end if;
    select id into strict v_request_id from private.ai_generation_requests
      where idempotency_key = v_key;
    v_payload := public.mark_ai_global_sent(
      v_request_id,
      ('2026-07-11 02:00:0' || v_i::text || '+00')::timestamptz
    );
    if v_payload->>'sent' is distinct from 'true' then
      raise exception 'window send % did not succeed: %', v_i, v_payload;
    end if;
    perform public.finalize_ai_generation_failure(
      v_request_id, 'invalid_ai_response', null,
      ('2026-07-11 02:00:1' || v_i::text || '+00')::timestamptz
    );
  end loop;

  update public.generation_drafts
  set deleted_at = null, revision = revision + 1
  where id = v_draft_id;
  select * into strict v_draft from public.generation_drafts where id = v_draft_id;
  v_payload := public.reserve_ai_generation(
    v_owner, '30000000-0000-4000-8000-0000000000d5', 'new_menu',
    v_draft.id, v_draft.revision, null, null, null,
    'generation-command.v2', repeat('a', 64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', v_draft.target_mode,
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', to_jsonb(v_draft.target_member_ids),
      'source_menu_version', null
    ),
    5, 45, 180, '2026-07-11 02:00:20+00'
  );
  if v_payload->>'status' is distinct from 'processing' then
    raise exception 'fifth window reserve did not process: %', v_payload;
  end if;
  select id into strict v_request_id from private.ai_generation_requests
    where idempotency_key = '30000000-0000-4000-8000-0000000000d5';
  v_payload := public.mark_ai_global_sent(v_request_id, '2026-07-11 02:00:21+00');
  if v_payload->>'sent' is distinct from 'false'
     or v_payload->>'code' is distinct from 'user_short_window_limit'
     or v_payload->>'failure_code' is distinct from 'user_short_window_limit' then
    raise exception 'fifth window send did not deny with user_short_window_limit: %', v_payload;
  end if;
end
$test$;
select pass('markSent couples attempt and short-window counters');

-- C5 confirm RPC: invalid fingerprint empty-return + success with reverse member order
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000091';
  v_member2 constant uuid := '20000000-0000-4000-8000-000000000092';
  v_member10 constant uuid := '20000000-0000-4000-8000-00000000009a';
  v_menu constant uuid := '40000000-0000-4000-8000-000000000091';
  v_confirm constant uuid := '48000000-0000-4000-8000-000000000091';
  v_dish constant uuid := '42000000-0000-4000-8000-000000000091';
  v_fingerprint text;
  v_status text;
  v_before jsonb;
  v_after jsonb;
  v_count integer;
begin
  perform tests.create_supabase_user(v_owner, 'confirm-owner@example.invalid');
  -- member_10 を member_2 より先に挿入し、数値 suffix 順だけが fingerprint 入力になることを固定
  insert into public.household_members(
    id, user_id, status, display_name, age_band, allergy_status,
    required_safety_constraints, unsupported_diet_status, unsupported_diet_kinds
  ) values
    (v_member10, v_owner, 'complete', '十郎', 'adult', 'none',
     array[]::text[], 'none', array[]::text[]),
    (v_member2, v_owner, 'complete', '次郎', 'adult', 'none',
     array[]::text[], 'none', array[]::text[]);

  insert into public.menus(
    id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
    preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
    allergen_dictionary_version, food_safety_rule_version, output_schema_version,
    derivation_group_id
  ) values (
    v_menu, v_owner, 'dinner', 'japanese', 2, 15,
    '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'household',
    'jp-caa-2026-04.v1', 'jp-caa-child-shape-2026-07.v1', '2026-07-11.v1', v_menu
  );
  insert into public.menu_target_members(
    menu_id, user_id, household_member_id, household_member_user_id,
    anonymous_ref, member_display_name_snapshot
  ) values
    (v_menu, v_owner, v_member10, v_owner, 'member_10', '十郎'),
    (v_menu, v_owner, v_member2, v_owner, 'member_2', '次郎');
  insert into public.dishes(
    id, menu_id, user_id, role, position, name, description, cooking_time_minutes
  ) values (v_dish, v_menu, v_owner, 'main', 1, '確認料理', '説明', 10);
  -- helper は入力 ordinal で anonymousRef を付ける。numeric suffix 順 member_2, member_10
  v_fingerprint := private.current_safety_fingerprint(
    v_owner, array[v_member2, v_member10]
  );
  insert into public.menu_label_confirmations(
    id, menu_id, user_id, source_type, source_id, source_path, source_text_snapshot,
    allergen_id, anonymous_member_ref, dictionary_version, requirement_safety_fingerprint
  ) values (
    v_confirm, v_menu, v_owner, 'dish', v_dish, 'dishes.0.name', '確認料理',
    'egg', 'member_2', 'jp-caa-2026-04.v1', v_fingerprint
  );

  -- null auth → empty
  perform tests.clear_authentication();
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_fingerprint);
  if v_count <> 0 then raise exception 'null auth returned rows'; end if;

  perform tests.authenticate_as(v_owner);
  set local role authenticated;

  select jsonb_build_object(
    'status', confirmation_status, 'confirmed_at', confirmed_at, 'confirmed_by', confirmed_by
  ) into v_before
  from public.menu_label_confirmations where id = v_confirm;

  -- invalid expected fingerprints: empty before helper, row unchanged
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, null);
  if v_count <> 0 then raise exception 'NULL fingerprint returned rows'; end if;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, ' ');
  if v_count <> 0 then raise exception 'blank fingerprint returned rows'; end if;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(
    v_menu, v_confirm, U&'\3000' || repeat('a', 64) || U&'\3000'
  );
  if v_count <> 0 then raise exception 'padded fingerprint returned rows'; end if;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, repeat('a', 201));
  if v_count <> 0 then raise exception '201-char fingerprint returned rows'; end if;

  select jsonb_build_object(
    'status', confirmation_status, 'confirmed_at', confirmed_at, 'confirmed_by', confirmed_by
  ) into v_after
  from public.menu_label_confirmations where id = v_confirm;
  if v_after is distinct from v_before then
    raise exception 'invalid fingerprint mutated the confirmation row';
  end if;

  -- wrong menu / unknown id → empty
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(
    '40000000-0000-4000-8000-000000000099', v_confirm, v_fingerprint
  );
  if v_count <> 0 then raise exception 'wrong menu returned rows'; end if;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(
    v_menu, '48000000-0000-4000-8000-000000000099', v_fingerprint
  );
  if v_count <> 0 then raise exception 'unknown confirmation returned rows'; end if;

  -- stale stored fingerprint → empty（台帳更新は definer ロールで行う）
  reset role;
  update public.menu_label_confirmations
  set requirement_safety_fingerprint = repeat('b', 64)
  where id = v_confirm;
  set local role authenticated;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_fingerprint);
  if v_count <> 0 then raise exception 'stale stored fingerprint returned rows'; end if;
  reset role;
  update public.menu_label_confirmations
  set requirement_safety_fingerprint = v_fingerprint
  where id = v_confirm;
  set local role authenticated;

  -- success
  select confirmation_status into v_status
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_fingerprint);
  if v_status is distinct from 'confirmed' then
    raise exception 'owner confirm did not succeed';
  end if;
  reset role;
  if (select confirmation_status from public.menu_label_confirmations where id = v_confirm)
     is distinct from 'confirmed' then
    raise exception 'owner confirm did not persist confirmed status';
  end if;

  -- replay → empty
  set local role authenticated;
  select count(*)::integer into v_count
  from public.confirm_menu_label_confirmation(v_menu, v_confirm, v_fingerprint);
  if v_count <> 0 then raise exception 'replay returned rows'; end if;

  reset role;
  perform tests.clear_authentication();
end
$test$;
select pass('confirm_menu_label_confirmation enforces fingerprint boundary and reverse member order');

select has_function('public'::name, 'get_ai_usage_today'::name);

-- usageTodayDataSchema の balance を reserved 保持中でも満たすこと
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-0000000000a5';
  v_now timestamptz := '2026-07-10 15:00:00+00';
  v_usage jsonb;
  v_success_consumed integer;
  v_success_remaining integer;
  v_attempt_sent integer;
  v_attempt_remaining integer;
begin
  perform tests.create_supabase_user(v_owner, 'usage-reserved@example.invalid');

  -- reserved のみ（成功 0 / 予約 1）
  insert into private.ai_user_daily_usage(user_id, usage_day, success_count, reserved_count)
  values (v_owner, date '2026-07-11', 0, 1);
  insert into private.ai_user_daily_external_attempts(user_id, usage_day, sent_count, reserved_count)
  values (v_owner, date '2026-07-11', 0, 1);

  v_usage := public.get_ai_usage_today(v_owner, v_now);
  v_success_consumed := (v_usage->'success'->>'consumed')::integer;
  v_success_remaining := (v_usage->'success'->>'remaining')::integer;
  v_attempt_sent := (v_usage->'attempts'->>'sent')::integer;
  v_attempt_remaining := (v_usage->'attempts'->>'remaining')::integer;

  if v_success_consumed <> 1 then
    raise exception 'reserved-only success.consumed expected 1, got %', v_success_consumed;
  end if;
  if v_success_consumed + v_success_remaining <> 5 then
    raise exception 'reserved-only success counts do not balance: % + %',
      v_success_consumed, v_success_remaining;
  end if;
  if v_attempt_sent <> 1 then
    raise exception 'reserved-only attempts.sent expected 1, got %', v_attempt_sent;
  end if;
  if v_attempt_sent + v_attempt_remaining <> 12 then
    raise exception 'reserved-only attempt counts do not balance: % + %',
      v_attempt_sent, v_attempt_remaining;
  end if;
  if (v_usage->'shortWindow'->>'sent')::integer <> 0 then
    raise exception 'shortWindow must stay sent-only while reserved';
  end if;
  if ((v_usage->'shortWindow'->>'sent')::integer
      + (v_usage->'shortWindow'->>'remaining')::integer) <> 4 then
    raise exception 'shortWindow counts do not balance under reserved success/attempt';
  end if;

  -- 成功 2 + 予約 1
  update private.ai_user_daily_usage
  set success_count = 2, reserved_count = 1
  where user_id = v_owner and usage_day = date '2026-07-11';
  update private.ai_user_daily_external_attempts
  set sent_count = 3, reserved_count = 1
  where user_id = v_owner and usage_day = date '2026-07-11';

  v_usage := public.get_ai_usage_today(v_owner, v_now);
  v_success_consumed := (v_usage->'success'->>'consumed')::integer;
  v_success_remaining := (v_usage->'success'->>'remaining')::integer;
  v_attempt_sent := (v_usage->'attempts'->>'sent')::integer;
  v_attempt_remaining := (v_usage->'attempts'->>'remaining')::integer;

  if v_success_consumed <> 3 then
    raise exception 'success+reserved consumed expected 3, got %', v_success_consumed;
  end if;
  if v_success_consumed + v_success_remaining <> 5 then
    raise exception 'success+reserved success counts do not balance: % + %',
      v_success_consumed, v_success_remaining;
  end if;
  if v_attempt_sent <> 4 then
    raise exception 'success+reserved attempts.sent expected 4, got %', v_attempt_sent;
  end if;
  if v_attempt_sent + v_attempt_remaining <> 12 then
    raise exception 'success+reserved attempt counts do not balance: % + %',
      v_attempt_sent, v_attempt_remaining;
  end if;
  -- blocked 時は retryAt 必須、空き時は null（先行 fixture の global 残に依存しない）
  if ((v_usage->>'retryAt') is null)
     = (
       (v_usage->'success'->>'remaining')::integer = 0
       or (v_usage->'attempts'->>'remaining')::integer = 0
       or (v_usage->'shortWindow'->>'remaining')::integer = 0
       or (v_usage->>'globalAvailable') is distinct from 'true'
     ) then
    raise exception 'retryAt / blocker pairing mismatch: %', v_usage;
  end if;
end
$test$;
select pass('get_ai_usage_today balances consumed/sent while reservations are held');

-- repair の attempt 上限 deny は reserved/retry_at のみ（code なし）
do $test$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-0000000000a6';
  v_draft_id constant uuid := '30000000-0000-4000-8000-0000000000a6';
  v_key constant uuid := '20000000-0000-4000-8000-0000000000a6';
  v_now timestamptz := '2026-07-10 15:00:00+00';
  v_request_id uuid;
  v_repair jsonb;
begin
  perform tests.create_supabase_user(v_owner, 'repair-attempt-limit@example.invalid');
  insert into public.generation_drafts (
    id, user_id, meal_type, main_ingredients, cuisine_genre, target_mode, target_member_ids,
    servings, time_limit_minutes, budget_preference, avoid_ingredients, memo,
    pantry_selections, revision
  ) values (
    v_draft_id, v_owner, 'dinner', array['鶏肉'], 'japanese', 'household',
    array[v_owner], null, 30, 'standard', array[]::text[], '', '[]'::jsonb, 1
  );
  perform public.reserve_ai_generation(
    v_owner, v_key, 'new_menu', v_draft_id, 1,
    null, null, null, 'generation-command.v2', repeat('e', 64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', 'household',
      'servings', null,
      'target_member_ids', to_jsonb(array[v_owner]),
      'source_menu_version', null
    ),
    5, 45, 180, v_now
  );
  select id into v_request_id from private.ai_generation_requests where idempotency_key = v_key;
  -- markSent 相当: 初回送信を消費し attempt/global 予約を解放した状態へ
  perform public.mark_ai_global_sent(v_request_id, v_now);
  -- 日次 attempt を上限まで埋める（repair 拒否用）
  update private.ai_user_daily_external_attempts
  set reserved_count = 0, sent_count = 12
  where user_id = v_owner and usage_day = private.ai_jst_day(v_now);

  v_repair := public.reserve_ai_repair_call(v_request_id, 45, v_now + interval '1 second');
  if (v_repair->>'reserved')::boolean is distinct from false then
    raise exception 'attempt-limit repair should not reserve';
  end if;
  if v_repair ? 'code' then
    raise exception 'attempt-limit repair deny must omit code field: %', v_repair;
  end if;
  if not (v_repair ? 'retry_at') or (v_repair->>'retry_at') is null then
    raise exception 'attempt-limit repair deny must include retry_at';
  end if;
  if (select repair_attempted from private.ai_generation_requests where id = v_request_id)
     is distinct from true then
    raise exception 'repair_attempted must stick true after attempt-limit deny';
  end if;
end
$test$;
select pass('reserve_ai_repair_call attempt-limit deny omits code for strict DTO');

-- opportunistic cleanup は p_user_id 指定時に他ユーザー終端行を消さない
do $test$
declare
  v_owner_a constant uuid := '10000000-0000-4000-8000-0000000000c1';
  v_owner_b constant uuid := '10000000-0000-4000-8000-0000000000c2';
  v_old_a uuid := '30000000-0000-4000-8000-0000000000c1';
  v_old_b uuid := '30000000-0000-4000-8000-0000000000c2';
  v_before timestamptz := '2026-07-11 00:00:00+00'::timestamptz - interval '30 days';
  v_deleted integer;
begin
  perform tests.create_supabase_user(v_owner_a, 'cleanup-a@example.invalid');
  perform tests.create_supabase_user(v_owner_b, 'cleanup-b@example.invalid');
  insert into private.ai_generation_requests(
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    failure_code, started_at, completed_at
  ) values
    (v_old_a, v_owner_a, '30000000-0000-4000-8000-0000000000d1', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('c', 64), date '2026-06-01',
     'generation_timeout', '2026-06-01 00:00:00+00', '2026-06-01 00:00:01+00'),
    (v_old_b, v_owner_b, '30000000-0000-4000-8000-0000000000d2', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('d', 64), date '2026-06-01',
     'generation_timeout', '2026-06-01 00:00:00+00', '2026-06-01 00:00:01+00');

  v_deleted := public.cleanup_ai_generation_requests(v_before, v_owner_a);
  if v_deleted < 1 then
    raise exception 'user-scoped cleanup deleted fewer than one row';
  end if;
  if exists(select 1 from private.ai_generation_requests where id = v_old_a) then
    raise exception 'user-scoped cleanup left owner A terminal row';
  end if;
  if not exists(select 1 from private.ai_generation_requests where id = v_old_b) then
    raise exception 'user-scoped cleanup deleted other user terminal row';
  end if;

  -- null p_user_id は全体掃除（Plan 6 互換）
  v_deleted := public.cleanup_ai_generation_requests(v_before, null);
  if v_deleted < 1 then
    raise exception 'global cleanup deleted fewer than one row';
  end if;
  if exists(select 1 from private.ai_generation_requests where id = v_old_b) then
    raise exception 'global cleanup left owner B terminal row';
  end if;
end
$test$;
select pass('cleanup_ai_generation_requests scopes opportunistic deletes by user_id');

-- =============================================================================
-- Plan 7 Task 4: regeneration snapshot 不変性 / owner 複合 FK / member 契約 /
-- lookup + regeneration snapshot RPC の privilege
-- =============================================================================
select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.lookup_ai_generation_request(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    to_regprocedure('public.lookup_ai_generation_request(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.lookup_ai_generation_request(uuid,uuid)'),
    'EXECUTE'
  ),
  'only service_role can execute lookup_ai_generation_request'
);
select throws_ok($$
  set local role anon;
  select public.lookup_ai_generation_request(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099'
  )
$$, '42501', null, 'anon is actually denied lookup_ai_generation_request');
select throws_ok($$
  set local role authenticated;
  select public.lookup_ai_generation_request(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000099'
  )
$$, '42501', null, 'authenticated is actually denied lookup_ai_generation_request');

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.get_ai_generation_regeneration_snapshot(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    to_regprocedure('public.get_ai_generation_regeneration_snapshot(uuid,uuid)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.get_ai_generation_regeneration_snapshot(uuid,uuid)'),
    'EXECUTE'
  ),
  'only service_role can execute get_ai_generation_regeneration_snapshot'
);
select throws_ok($$
  set local role anon;
  select public.get_ai_generation_regeneration_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'anon is actually denied regeneration snapshot RPC');
select throws_ok($$
  set local role authenticated;
  select public.get_ai_generation_regeneration_snapshot(
    '20000000-0000-4000-8000-000000000099',
    '10000000-0000-4000-8000-000000000001'
  )
$$, '42501', null, 'authenticated is actually denied regeneration snapshot RPC');

do $snapshot_fixture$
declare
  v_owner constant uuid := '10000000-0000-4000-8000-000000000001';
  v_other constant uuid := '10000000-0000-4000-8000-000000000002';
  v_request constant uuid := 'd1000000-0000-4000-8000-000000000001';
  v_owner_bare constant uuid := 'd1000000-0000-4000-8000-000000000003';
  v_other_request constant uuid := 'd1000000-0000-4000-8000-000000000002';
  v_member constant uuid := '10000000-0000-4000-8000-000000000001';
begin
  -- 既存 processing があれば終端化して snapshot 検証用 request を挿入できるようにする
  update private.ai_generation_requests
  set status = 'failed',
      failure_code = 'generation_timeout',
      completed_at = coalesce(completed_at, now()),
      processing_expires_at = null,
      user_quota_reserved = false,
      user_attempt_reserved = false,
      user_attempt_day = null,
      global_reserved_day = null
  where user_id in (v_owner, v_other) and status = 'processing';

  insert into private.ai_generation_requests(
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    started_at, completed_at
  ) values
    (v_request, v_owner, 'd2000000-0000-4000-8000-000000000001', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('a', 64), date '2026-07-22',
     '2026-07-22 00:00:00+00', '2026-07-22 00:00:01+00'),
    (v_owner_bare, v_owner, 'd2000000-0000-4000-8000-000000000003', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('b', 64), date '2026-07-22',
     '2026-07-22 00:00:00+00', '2026-07-22 00:00:01+00'),
    (v_other_request, v_other, 'd2000000-0000-4000-8000-000000000002', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('c', 64), date '2026-07-22',
     '2026-07-22 00:00:00+00', '2026-07-22 00:00:01+00');

  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids, created_at
  ) values (
    v_request, v_owner, 'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2, array[v_member], '2026-07-22 00:00:00+00'
  );
end
$snapshot_fixture$;

select throws_ok($$
  update private.generation_regeneration_snapshots
  set servings = 3
  where request_id = 'd1000000-0000-4000-8000-000000000001'
$$, '55000', 'generation_regeneration_snapshot_immutable',
  'regeneration snapshot rejects UPDATE');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    array['10000000-0000-4000-8000-000000000001'::uuid]
  )
$$, '23503', null,
  'regeneration snapshot rejects other-owner request composite FK');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    array['10000000-0000-4000-8000-000000000001'::uuid]
  )
$$, '23503', null,
  'regeneration snapshot rejects wrong user_id on existing request');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    (
      select array_agg(
        ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid
        order by g
      )
      from generate_series(1, 21) as g
    )
  )
$$, '23514', null,
  'regeneration snapshot rejects 21 household members');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    array[null::uuid, '10000000-0000-4000-8000-000000000002'::uuid]
  )
$$, '23514', null,
  'regeneration snapshot rejects NULL target member elements');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    array[
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid
    ]
  )
$$, '23514', null,
  'regeneration snapshot rejects duplicate target member ids');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'idea', 2,
    array['10000000-0000-4000-8000-000000000002'::uuid]
  )
$$, '23514', null,
  'regeneration snapshot idea mode rejects non-empty target members');

select throws_ok($$
  insert into private.generation_regeneration_snapshots(
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values (
    'd1000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'regenerate_menu',
    'c4000000-0000-4000-8000-000000000099', 1, null,
    'household', 2,
    array[]::uuid[]
  )
$$, '23514', null,
  'regeneration snapshot household mode rejects empty target members');

-- Task 5: idea_safety_fingerprint は固定 canonical JSON の SHA-256 lowercase hex
select is(
  private.idea_safety_fingerprint(),
  encode(
    extensions.digest(
      convert_to('{"assurance":"none","members":[],"mode":"idea"}', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'idea_safety_fingerprint matches fixed canonical JSON digest'
);
select matches(
  private.idea_safety_fingerprint(),
  '^[0-9a-f]{64}$',
  'idea_safety_fingerprint is 64-char lowercase hex'
);

select * from finish();
rollback;
