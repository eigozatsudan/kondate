\ir 000_helpers.sql
begin;
select plan(28);

select tests.create_supabase_user(
  '70000000-0000-4000-8000-000000000001',
  'snapshot-owner-a@example.invalid'
);
select tests.create_supabase_user(
  '70000000-0000-4000-8000-000000000002',
  'snapshot-owner-b@example.invalid'
);

insert into public.household_members (
  id, user_id, status, display_name, age_band, portion_size, spice_level,
  ease_preferences, allergy_status, required_safety_constraints,
  unsupported_diet_status, unsupported_diet_kinds
) values
  (
    '71000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'draft', '子ども', 'age_3_5', 'small', 'none', array['small_pieces'],
    'registered', array['cut_small'], 'none', '{}'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'complete', '大人', 'adult', null, null, '{}',
    'none', '{}', 'present', array['therapeutic_diet']
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    'draft', '下書き', null, null, null, '{}', null, '{}', null, '{}'
  ),
  (
    '71000000-0000-4000-8000-000000000004',
    '70000000-0000-4000-8000-000000000001',
    'complete', 'アレルギー未確認', 'adult', null, null, '{}',
    'unconfirmed', '{}', 'none', '{}'
  ),
  (
    '71000000-0000-4000-8000-000000000005',
    '70000000-0000-4000-8000-000000000001',
    'complete', '食事制限未確認', 'adult', null, null, '{}',
    'none', '{}', 'unconfirmed', '{}'
  ),
  (
    '72000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002',
    'complete', '別世帯', 'adult', null, null, '{}',
    'none', '{}', 'none', '{}'
  );

insert into public.member_allergies (
  id, user_id, member_id, allergen_id, custom_name, custom_aliases, custom_confirmed
) values
  (
    '73000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'egg', null, '{}', false
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    null, '独自食材', array['別名B', '別名A'], true
  ),
  (
    '73000000-0000-4000-8000-000000000000',
    '70000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    null, '独自食材', array['もう一つの別名'], true
  );

update public.household_members
set status = 'complete'
where id = '71000000-0000-4000-8000-000000000001';

select has_function(
  'public',
  'get_current_safety_snapshot',
  array['uuid', 'uuid[]'],
  'snapshot RPC exists with the expected signature'
);
select ok(
  (select pro.prosecdef
   from pg_catalog.pg_proc pro
   where pro.oid = to_regprocedure('public.get_current_safety_snapshot(uuid,uuid[])')),
  'snapshot RPC is SECURITY DEFINER'
);
select is(
  (select pro.proconfig
   from pg_catalog.pg_proc pro
   where pro.oid = to_regprocedure('public.get_current_safety_snapshot(uuid,uuid[])')),
  array['search_path=""']::text[],
  'snapshot RPC has an empty search_path'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc pro
    cross join lateral aclexplode(coalesce(pro.proacl, acldefault('f', pro.proowner))) acl
    where pro.oid = to_regprocedure('public.get_current_safety_snapshot(uuid,uuid[])')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the snapshot RPC'
);
select ok(
  not has_function_privilege('anon', 'public.get_current_safety_snapshot(uuid,uuid[])', 'execute'),
  'anon cannot execute the snapshot RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_current_safety_snapshot(uuid,uuid[])', 'execute'),
  'authenticated cannot execute the snapshot RPC'
);
select ok(
  has_function_privilege('service_role', 'public.get_current_safety_snapshot(uuid,uuid[])', 'execute'),
  'service_role can execute the snapshot RPC'
);

select is(
  public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array[
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000001'
    ]::uuid[]
  ) #>> '{status}',
  'available',
  'complete confirmed owned members produce an available snapshot'
);
select is(
  public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array[
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000001'
    ]::uuid[]
  ) #>> '{members,0,id}',
  '71000000-0000-4000-8000-000000000002',
  'member order follows requested ordinality'
);
select is(
  public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array[
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000001'
    ]::uuid[]
  ) #> '{members,0}',
  '{
    "id":"71000000-0000-4000-8000-000000000002",
    "display_name":"大人",
    "age_band":"adult",
    "portion_size":null,
    "spice_level":null,
    "ease_preferences":[],
    "allergy_status":"none",
    "required_safety_constraints":[],
    "unsupported_diet_status":"present",
    "unsupported_diet_kinds":["therapeutic_diet"],
    "allergies":[]
  }'::jsonb,
  'member DTO contains display and safety data without owner fields'
);
select is(
  public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001']::uuid[]
  ) #> '{members,0,allergies}',
  '[{"kind":"standard","allergen_id":"egg"},{"kind":"custom","name":"独自食材","aliases":["もう一つの別名"]},{"kind":"custom","name":"独自食材","aliases":["別名A","別名B"]}]'::jsonb,
  'standard and confirmed custom allergies use the exact ordered DTO'
);
select ok(
  jsonb_array_length(public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001']::uuid[]
  ) -> 'catalog') > 0,
  'snapshot contains catalog data'
);
select ok(
  jsonb_array_length(public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001']::uuid[]
  ) -> 'aliases') > 0,
  'snapshot contains alias data'
);
select ok(
  jsonb_array_length(public.get_current_safety_snapshot(
    '70000000-0000-4000-8000-000000000001',
    array['71000000-0000-4000-8000-000000000001']::uuid[]
  ) -> 'rules') > 0,
  'snapshot contains food safety rules'
);
select ok(
  not jsonb_path_exists(
    public.get_current_safety_snapshot(
      '70000000-0000-4000-8000-000000000001',
      array['71000000-0000-4000-8000-000000000001']::uuid[]
    ),
    '$.catalog[*] ? (@.catalog_version != $.dictionary_version)'
  ),
  'all catalog rows use the top-level dictionary version'
);
select ok(
  not jsonb_path_exists(
    public.get_current_safety_snapshot(
      '70000000-0000-4000-8000-000000000001',
      array['71000000-0000-4000-8000-000000000001']::uuid[]
    ),
    '$.aliases[*] ? (@.dictionary_version != $.dictionary_version)'
  ),
  'all aliases use the top-level dictionary version'
);
select ok(
  not jsonb_path_exists(
    public.get_current_safety_snapshot(
      '70000000-0000-4000-8000-000000000001',
      array['71000000-0000-4000-8000-000000000001']::uuid[]
    ),
    '$.rules[*] ? (@.rule_version != $.food_rule_version)'
  ),
  'all rules use the top-level food rule version'
);

select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001', '{}'::uuid[]
), '{"status":"unavailable"}'::jsonb, 'empty input is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'duplicate input is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['71999999-0000-4000-8000-000000000001']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'missing member input is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['72000000-0000-4000-8000-000000000001']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'foreign member input is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['71000000-0000-4000-8000-000000000003']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'draft member input is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['71000000-0000-4000-8000-000000000004']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'unconfirmed allergy state is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array['71000000-0000-4000-8000-000000000005']::uuid[]
), '{"status":"unavailable"}'::jsonb, 'unconfirmed unsupported diet state is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001', null
), '{"status":"unavailable"}'::jsonb, 'null member array is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001', array[null]::uuid[]
), '{"status":"unavailable"}'::jsonb, 'null member element is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  array_fill('71000000-0000-4000-8000-000000000001'::uuid, array[1, 1])
), '{"status":"unavailable"}'::jsonb, 'multidimensional member array is unavailable');
select is(public.get_current_safety_snapshot(
  '70000000-0000-4000-8000-000000000001',
  (
    select array_agg(
      ('74000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid
      order by value
    )
    from generate_series(1, 21) as values(value)
  )
), '{"status":"unavailable"}'::jsonb, 'more than twenty member IDs is unavailable');

select * from finish();
rollback;
