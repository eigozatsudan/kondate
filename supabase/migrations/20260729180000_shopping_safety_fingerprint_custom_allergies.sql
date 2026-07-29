-- F-SAF-002 完了: shopping_safety_fingerprint にカスタムアレルギーの name/aliases を載せる。
-- 生成側 current_safety_fingerprint と同趣旨で、カスタム文言変更時に買い物ロックが無効化する。

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
          select jsonb_agg(a.allergen_id order by a.allergen_id)
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
        -- カスタムは name 昇順・aliases 昇順。文言変更で fingerprint が変わること。
        'customAllergies', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', a.custom_name,
              'aliases', coalesce((
                select jsonb_agg(alias_value order by alias_value)
                from unnest(coalesce(a.custom_aliases, array[]::text[])) as aliases(alias_value)
              ), '[]'::jsonb)
            )
            order by a.custom_name
          )
          from public.member_allergies a
          where a.user_id = m.user_id
            and a.member_id = m.id
            and a.allergen_id is null
            and a.custom_name is not null
        ), '[]'::jsonb),
        'requiredSafetyConstraints', to_jsonb(
          array(select unnest(m.required_safety_constraints) order by 1)
        ),
        'unsupportedDietStatus', m.unsupported_diet_status,
        'unsupportedDietKinds', to_jsonb(
          array(select unnest(m.unsupported_diet_kinds) order by 1)
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
