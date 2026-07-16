create or replace function public.add_custom_member_allergy(
  p_member_id uuid,
  p_custom_name text,
  p_custom_aliases text[] default array[]::text[]
)
returns public.member_allergies
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_name text := btrim(normalize(p_custom_name, NFKC));
  normalized_aliases text[];
  inserted public.member_allergies;
begin
  select coalesce(array_agg(btrim(normalize(alias, NFKC)) order by ordinal), array[]::text[])
  into normalized_aliases
  from unnest(coalesce(p_custom_aliases, array[]::text[]))
    with ordinality as aliases(alias, ordinal);

  if normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or cardinality(normalized_aliases) > 10
    or exists (
      select 1
      from unnest(normalized_aliases) as alias
      where alias is null or char_length(alias) not between 1 and 80
    )
    or cardinality(normalized_aliases) <> (
      select count(distinct alias)
      from unnest(normalized_aliases) as alias
    ) then
    raise exception using errcode = '23514', message = 'invalid_custom_allergy';
  end if;

  if not exists (
    select 1
    from public.household_members member
    where member.id = p_member_id
      and member.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'member_not_accessible';
  end if;

  -- 加工品語は原材料ラベル確認用であり、本人の標準アレルゲン候補にはしない。
  if exists (
    select 1
    from unnest(array_prepend(normalized_name, normalized_aliases)) as submitted(term)
    join public.allergen_aliases alias
      on alias.alias_kind in ('direct', 'derived')
      and private.normalize_allergen_term(alias.normalized_alias)
        = private.normalize_allergen_term(submitted.term)
  ) then
    raise exception using errcode = '23514', message = 'custom_allergy_matches_standard';
  end if;

  -- 同一メンバーが同じカスタムアレルギーを名称・別名のどちらの側からでも重複登録できないようにする。
  if exists (
    select 1
    from public.member_allergies existing
    where existing.member_id = p_member_id
      and existing.allergen_id is null
      and exists (
        select 1
        from unnest(array_prepend(normalized_name, normalized_aliases)) as submitted(term)
        where private.normalize_allergen_term(existing.custom_name) = private.normalize_allergen_term(submitted.term)
          or private.normalize_allergen_term(submitted.term) = any (
            select private.normalize_allergen_term(existing_alias)
            from unnest(existing.custom_aliases) as existing_alias
          )
      )
  ) then
    raise exception using errcode = '23514', message = 'custom_allergy_already_registered';
  end if;

  insert into public.member_allergies (
    user_id,
    member_id,
    allergen_id,
    custom_name,
    custom_aliases,
    custom_confirmed
  ) values (
    auth.uid(),
    p_member_id,
    null,
    normalized_name,
    normalized_aliases,
    true
  )
  returning * into inserted;

  return inserted;
end;
$function$;
