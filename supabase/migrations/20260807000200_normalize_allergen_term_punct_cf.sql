-- H12: private.normalize_allergen_term を evaluate 側 normalizeFoodText と同じ
-- 句読点・書式制御 (Cf) strip に揃える。
-- カスタム「卵、」「卵​」が標準卵 alias と衝突して custom_allergy_matches_standard になり、
-- 純句読点/Cf のみは normalize 後 empty として invalid_custom_allergy で拒否する。
-- evaluateAllergens 本体は変更しない。

create or replace function private.normalize_allergen_term(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  -- 1) NFKC  2) カタカナ(ァ-ヶ)→ひらがな  3) lower
  -- 4) normalizeFoodText と同型の空白・句読点除去
  -- 5) 代表的な書式制御 Cf を translate の削除（to が短いと from 余剰文字を削除）で除去。
  --    PG regexp の \x{} は無効のため U& リテラルを使う（JS \p{Cf} の攻撃面: ZWSP 等）。
  select translate(
    regexp_replace(
      lower(
        translate(
          normalize(btrim(p_value), NFKC),
          'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ',
          'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ'
        )
      ),
      -- normalizeFoodText: [\s\u3000、。・,./（）()「」『』']
      '[[:space:]　、。・,./（）()「」『』'']',
      '',
      'g'
    ),
    -- soft hyphen / ZWSP–RLM / bidi embeddings / WJ–FA / bidi isolates / BOM
    U&'\00AD\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2061\2062\2063\2064\2066\2067\2068\2069\206A\206B\206C\206D\206E\206F\FEFF',
    ''
  );
$function$;

-- 純句読点/Cf のみ（normalize 後 empty）を invalid_custom_allergy で拒否する。
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
    or private.normalize_allergen_term(normalized_name) = ''
    or cardinality(normalized_aliases) > 10
    or exists (
      select 1
      from unnest(normalized_aliases) as alias
      where alias is null
        or char_length(alias) not between 1 and 80
        or private.normalize_allergen_term(alias) = ''
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
