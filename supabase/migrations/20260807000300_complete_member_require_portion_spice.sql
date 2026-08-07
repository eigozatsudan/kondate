-- H16: complete_household_member が portion_size / spice_level を必須にする。
-- 生成コンテキスト U4-001（requireCompleteMember）と揃え、UI 既定値はそのまま。
-- 未設定のまま complete すると member_required_fields_incomplete で fail-closed。

create or replace function public.complete_household_member(p_member_id uuid)
returns public.household_members
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  result public.household_members;
begin
  update public.household_members
  set status = 'complete'
  where id = p_member_id
    and user_id = auth.uid()
    and age_band is not null
    and portion_size is not null
    and spice_level is not null
    and allergy_status is not null
    and unsupported_diet_status is not null
    and (
      allergy_status <> 'registered'
      or exists (
        select 1
        from public.member_allergies
        where member_id = p_member_id
          and user_id = auth.uid()
      )
    )
    and (
      unsupported_diet_status <> 'present'
      or cardinality(unsupported_diet_kinds) > 0
    )
  returning * into result;

  if result.id is null then
    raise exception using
      errcode = '23514',
      message = 'member_required_fields_incomplete';
  end if;

  return result;
end;
$function$;
