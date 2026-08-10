-- H4/S6: customAllergies / aliases の ORDER BY を COLLATE "C" に固定する。
-- TS createCurrentSafetyFingerprint は locale 非依存の code-point 昇順
-- （compareFingerprintText / JS `<`）を使う。DB 既定 collation は locale 依存のため、
-- 明示 "C"（UTF-8 バイト順≒Unicode 符号点順）で同型にする。
-- shopping_safety_fingerprint も同趣旨で揃える。

create or replace function private.current_safety_fingerprint(
  p_user_id uuid,p_target_member_ids uuid[]
) returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_requested_count integer;
  v_member_count integer;
  v_members text;
  v_payload text;
begin
  if p_user_id is null or p_target_member_ids is null
     or pg_catalog.cardinality(p_target_member_ids)=0
     or pg_catalog.array_position(p_target_member_ids,null::uuid) is not null then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;
  select pg_catalog.count(distinct requested.member_id)::integer
    into v_requested_count
  from pg_catalog.unnest(p_target_member_ids) as requested(member_id);
  if v_requested_count<>pg_catalog.cardinality(p_target_member_ids) then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;

  with requested as (
    select target.member_id,target.ordinality
    from pg_catalog.unnest(p_target_member_ids) with ordinality
      as target(member_id,ordinality)
  ), canonical_members as (
    select member.id,
      'member_'||requested.ordinality::text as anonymous_ref,
      member.age_band,member.allergy_status,
      coalesce(array(select allergy.allergen_id
        from public.member_allergies allergy
        where allergy.user_id=p_user_id and allergy.member_id=member.id
          and allergy.allergen_id is not null
        order by allergy.allergen_id collate "C"),array[]::text[]) as allergen_ids,
      exists(select 1 from public.member_allergies allergy
        where allergy.user_id=p_user_id and allergy.member_id=member.id
          and allergy.allergen_id is null) as has_unmapped_custom_allergy,
      -- カスタムは name COLLATE "C" 昇順、aliases も COLLATE "C"。空は []。
      -- to_json 直列化でスペース無しにし、TS JSON.stringify と同型にする。
      coalesce(
        (
          select '[' || pg_catalog.string_agg(
            '{"name":' || pg_catalog.to_json(allergy.custom_name)::text ||
            ',"aliases":' || coalesce(
              (
                select pg_catalog.to_json(
                  pg_catalog.array_agg(alias_value order by alias_value collate "C")
                )::text
                from pg_catalog.unnest(coalesce(allergy.custom_aliases, array[]::text[]))
                  as aliases(alias_value)
              ),
              '[]'
            ) || '}',
            ',' order by allergy.custom_name collate "C"
          ) || ']'
          from public.member_allergies allergy
          where allergy.user_id=p_user_id
            and allergy.member_id=member.id
            and allergy.allergen_id is null
            and allergy.custom_name is not null
        ),
        '[]'
      ) as custom_allergies,
      array(select value from pg_catalog.unnest(member.required_safety_constraints)
        as constraints_(value) order by value collate "C") as required_constraints,
      member.unsupported_diet_status,
      array(select value from pg_catalog.unnest(member.unsupported_diet_kinds)
        as diets(value) order by value collate "C") as unsupported_diet_kinds
    from requested
    join public.household_members member
      on member.id=requested.member_id and member.user_id=p_user_id
     and member.status='complete'
  ), encoded as (
    select id,
      '{"householdMemberId":'||pg_catalog.to_json(id::text)::text||
      ',"anonymousRef":'||pg_catalog.to_json(anonymous_ref)::text||
      ',"ageBand":'||pg_catalog.to_json(age_band)::text||
      ',"allergyStatus":'||pg_catalog.to_json(allergy_status)::text||
      ',"allergenIds":'||pg_catalog.to_json(allergen_ids)::text||
      ',"hasUnmappedCustomAllergy":'||
        pg_catalog.to_json(has_unmapped_custom_allergy)::text||
      ',"customAllergies":'||custom_allergies::text||
      ',"requiredSafetyConstraints":'||pg_catalog.to_json(required_constraints)::text||
      ',"unsupportedDietStatus":'||pg_catalog.to_json(unsupported_diet_status)::text||
      ',"unsupportedDietKinds":'||pg_catalog.to_json(unsupported_diet_kinds)::text||'}'
      as encoded_member
    from canonical_members
  )
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.string_agg(encoded_member,',' order by id::text collate "C"),'')
    into v_member_count,v_members
  from encoded;
  if v_member_count<>v_requested_count then
    raise exception using errcode='22023',message='invalid_target_members';
  end if;

  v_payload := '{"dictionaryVersion":"jp-caa-2026-04.v1"'
    ||',"foodRuleVersion":"jp-caa-child-shape-2026-07.v1"'
    ||',"members":['||v_members||']}';
  return pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_payload,'UTF8'),'sha256'),'hex');
end
$function$;

create or replace function public.shopping_safety_fingerprint(p_user_id uuid, p_menu_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'householdMemberId', m.id,
        'anonymousRef', t.anonymous_ref,
        'ageBand', m.age_band,
        'allergyStatus', m.allergy_status,
        'allergenIds', coalesce((
          select jsonb_agg(a.allergen_id order by a.allergen_id collate "C")
          from public.member_allergies a
          where a.user_id = m.user_id
            and a.member_id = m.id
            and a.allergen_id is not null
        ), '[]'::jsonb),
        'hasUnmappedCustomAllergy', exists(
          select 1
          from public.member_allergies a
          where a.user_id = m.user_id
            and a.member_id = m.id
            and a.allergen_id is null
        ),
        -- カスタムは name COLLATE "C" 昇順・aliases COLLATE "C"。文言変更で fingerprint が変わること。
        'customAllergies', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', a.custom_name,
              'aliases', coalesce((
                select jsonb_agg(alias_value order by alias_value collate "C")
                from unnest(coalesce(a.custom_aliases, array[]::text[])) as aliases(alias_value)
              ), '[]'::jsonb)
            )
            order by a.custom_name collate "C"
          )
          from public.member_allergies a
          where a.user_id = m.user_id
            and a.member_id = m.id
            and a.allergen_id is null
            and a.custom_name is not null
        ), '[]'::jsonb),
        'requiredSafetyConstraints', to_jsonb(
          array(
            select constraint_value
            from unnest(m.required_safety_constraints) as constraints_(constraint_value)
            order by constraint_value collate "C"
          )
        ),
        'unsupportedDietStatus', m.unsupported_diet_status,
        'unsupportedDietKinds', to_jsonb(
          array(
            select diet_value
            from unnest(m.unsupported_diet_kinds) as diets(diet_value)
            order by diet_value collate "C"
          )
        )
      ) order by m.id)
      from public.household_members m
      join public.menu_target_members t
        on t.household_member_id = m.id
       and t.user_id = m.user_id
      where t.menu_id = p_menu_id
        and m.user_id = p_user_id
    ), '[]'::jsonb),
    'dictionaryVersion', coalesce((select max(dictionary_version) from public.allergen_aliases), ''),
    'foodRuleVersion', coalesce((select max(rule_version) from public.food_safety_rules), '')
  )::text, 'UTF8'), 'sha256'), 'hex');
$function$;
