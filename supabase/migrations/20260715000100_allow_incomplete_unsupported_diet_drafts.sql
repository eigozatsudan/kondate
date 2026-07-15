alter table public.household_members
drop constraint household_members_check1;

alter table public.household_members
add constraint household_members_unsupported_diet_consistency check (
  (
    status = 'draft'
    and unsupported_diet_status = 'present'
    and cardinality(unsupported_diet_kinds) = 0
  )
  or (
    unsupported_diet_status = 'present'
    and cardinality(unsupported_diet_kinds) > 0
  )
  or (
    unsupported_diet_status is distinct from 'present'
    and cardinality(unsupported_diet_kinds) = 0
  )
);

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
