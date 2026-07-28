-- F-SAF-002: current_safety_fingerprint に確認済みカスタムアレルギーの name/aliases を載せる。
-- TS createCurrentSafetyFingerprint と同型にし、生成中のカスタム差し替え TOCTOU を finalize で弾く。

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
        order by allergy.allergen_id),array[]::text[]) as allergen_ids,
      exists(select 1 from public.member_allergies allergy
        where allergy.user_id=p_user_id and allergy.member_id=member.id
          and allergy.allergen_id is null) as has_unmapped_custom_allergy,
      -- カスタムは name 昇順、aliases は各行内で昇順。空配列は常に JSON []。
      coalesce(
        (
          select pg_catalog.json_agg(entry order by entry->>'name')
          from (
            select pg_catalog.json_build_object(
              'name', allergy.custom_name,
              'aliases', coalesce(
                (
                  select pg_catalog.json_agg(alias_value order by alias_value)
                  from pg_catalog.unnest(coalesce(allergy.custom_aliases, array[]::text[]))
                    as aliases(alias_value)
                ),
                '[]'::json
              )
            ) as entry
            from public.member_allergies allergy
            where allergy.user_id=p_user_id
              and allergy.member_id=member.id
              and allergy.allergen_id is null
              and allergy.custom_name is not null
          ) custom_rows
        ),
        '[]'::json
      ) as custom_allergies,
      array(select value from pg_catalog.unnest(member.required_safety_constraints)
        as constraints_(value) order by value) as required_constraints,
      member.unsupported_diet_status,
      array(select value from pg_catalog.unnest(member.unsupported_diet_kinds)
        as diets(value) order by value) as unsupported_diet_kinds
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
    coalesce(pg_catalog.string_agg(encoded_member,',' order by id::text),'')
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
