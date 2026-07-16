create or replace function public.get_current_safety_snapshot(
  p_user_id uuid,
  p_target_member_ids uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with
  input_validation as (
    select
      p_user_id is not null
      and p_target_member_ids is not null
      and array_ndims(p_target_member_ids) = 1
      and cardinality(p_target_member_ids) between 1 and 20
      and cardinality(p_target_member_ids) = (
        select count(distinct target.member_id)
        from unnest(p_target_member_ids) as target(member_id)
      ) as is_valid
  ),
  requested_members as (
    select target.member_id, target.ordinality
    from unnest(p_target_member_ids) with ordinality as target(member_id, ordinality)
    where (select is_valid from input_validation)
  ),
  eligible_members as (
    select
      requested.ordinality,
      member.id,
      member.display_name,
      member.age_band,
      member.portion_size,
      member.spice_level,
      member.ease_preferences,
      member.allergy_status,
      member.required_safety_constraints,
      member.unsupported_diet_status,
      member.unsupported_diet_kinds
    from requested_members requested
    join public.household_members member
      on member.id = requested.member_id
      and member.user_id = p_user_id
      and member.status = 'complete'
      and member.display_name is not null
      and member.allergy_status in ('none', 'registered')
      and member.unsupported_diet_status in ('none', 'present')
  ),
  member_snapshot as (
    select jsonb_agg(
      jsonb_build_object(
        'id', member.id,
        'display_name', member.display_name,
        'age_band', member.age_band,
        'portion_size', member.portion_size,
        'spice_level', member.spice_level,
        'ease_preferences', to_jsonb(member.ease_preferences),
        'allergy_status', member.allergy_status,
        'required_safety_constraints', to_jsonb(member.required_safety_constraints),
        'unsupported_diet_status', member.unsupported_diet_status,
        'unsupported_diet_kinds', to_jsonb(member.unsupported_diet_kinds),
        'allergies', coalesce((
          select jsonb_agg(
            allergy.dto order by allergy.sort_kind, allergy.sort_value, allergy.sort_id
          )
          from (
            select
              0 as sort_kind,
              registered.allergen_id as sort_value,
              registered.id as sort_id,
              jsonb_build_object(
                'kind', 'standard',
                'allergen_id', registered.allergen_id
              ) as dto
            from public.member_allergies registered
            where registered.user_id = p_user_id
              and registered.member_id = member.id
              and registered.allergen_id is not null
            union all
            select
              1 as sort_kind,
              registered.custom_name as sort_value,
              registered.id as sort_id,
              jsonb_build_object(
                'kind', 'custom',
                'name', registered.custom_name,
                'aliases', to_jsonb(array(
                  select custom_alias.alias
                  from unnest(registered.custom_aliases) as custom_alias(alias)
                  order by custom_alias.alias
                ))
              ) as dto
            from public.member_allergies registered
            where registered.user_id = p_user_id
              and registered.member_id = member.id
              and registered.allergen_id is null
              and registered.custom_confirmed
          ) allergy
        ), '[]'::jsonb)
      )
      order by member.ordinality
    ) as members
    from eligible_members member
  ),
  catalog_snapshot as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', catalog.id,
        'display_name', catalog.display_name,
        'regulatory_class', catalog.regulatory_class,
        'catalog_version', catalog.catalog_version
      ) order by catalog.id
    ), '[]'::jsonb) as catalog
    from public.allergen_catalog catalog
    where catalog.catalog_version = 'jp-caa-2026-04.v1'
  ),
  alias_snapshot as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'allergen_id', alias.allergen_id,
        'alias', alias.alias,
        'normalized_alias', alias.normalized_alias,
        'alias_kind', alias.alias_kind,
        'requires_label_confirmation', alias.requires_label_confirmation,
        'dictionary_version', alias.dictionary_version
      ) order by alias.allergen_id, alias.normalized_alias, alias.alias_kind, alias.alias
    ), '[]'::jsonb) as aliases
    from public.allergen_aliases alias
    where alias.dictionary_version = 'jp-caa-2026-04.v1'
  ),
  rule_snapshot as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', rule.id,
        'applies_to_age_bands', to_jsonb(rule.applies_to_age_bands),
        'match_terms', to_jsonb(rule.match_terms),
        'rule_kind', rule.rule_kind,
        'required_safety_tag', rule.required_safety_tag,
        'user_message', rule.user_message,
        'rule_version', rule.rule_version
      ) order by rule.id
    ), '[]'::jsonb) as rules
    from public.food_safety_rules rule
    where rule.rule_version = 'jp-caa-child-shape-2026-07.v1'
  )
  select case
    when not (select is_valid from input_validation)
      or (select count(*) from eligible_members) <> cardinality(p_target_member_ids)
    then jsonb_build_object('status', 'unavailable')
    else jsonb_build_object(
      'status', 'available',
      'dictionary_version', 'jp-caa-2026-04.v1',
      'food_rule_version', 'jp-caa-child-shape-2026-07.v1',
      'members', (select members from member_snapshot),
      'catalog', (select catalog from catalog_snapshot),
      'aliases', (select aliases from alias_snapshot),
      'rules', (select rules from rule_snapshot)
    )
  end;
$function$;

revoke all on function public.get_current_safety_snapshot(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_current_safety_snapshot(uuid, uuid[])
  to service_role;
