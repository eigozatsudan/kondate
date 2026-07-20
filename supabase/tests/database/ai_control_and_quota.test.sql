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
select ok(
  not (
    select procedure_.prosecdef
    from pg_catalog.pg_proc procedure_
    where procedure_.oid = to_regprocedure(
      'private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)'
    )
  ),
  'lineage hook is SECURITY INVOKER'
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
  array['search_path=""']::text[],
  'lineage hook has an empty search_path'
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
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000003'::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    null::text
  )
$$, 'P0001', 'regeneration_not_implemented',
  'the lineage hook rejects a source-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    'simpler'::text,
    null::text
  )
$$, 'P0001', 'regeneration_not_implemented',
  'the lineage hook rejects a reason-only lineage');
select throws_ok($$
  select private.assign_regeneration_lineage(
    '16000000-0000-4000-8000-000000000001'::uuid,
    null::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    null::text,
    '自由記述'::text
  )
$$, 'P0001', 'regeneration_not_implemented',
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
