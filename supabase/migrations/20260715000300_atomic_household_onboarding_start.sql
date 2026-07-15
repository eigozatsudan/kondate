create or replace function public.start_household_onboarding(p_sort_order integer)
returns public.household_members
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_profile public.profiles;
  result public.household_members;
begin
  if p_sort_order < 0 then
    raise exception using errcode = '22023', message = 'invalid_household_sort_order';
  end if;

  -- プロフィール行を直列化点にし、同時開始でも同じ下書きを再利用する。
  select profile.*
  into current_profile
  from public.profiles profile
  where profile.user_id = auth.uid()
  for update;

  if current_profile.user_id is null then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  select member.*
  into result
  from public.household_members member
  where member.user_id = auth.uid()
    and member.status = 'draft'
  order by member.sort_order, member.created_at, member.id
  limit 1;

  if result.id is null then
    insert into public.household_members(user_id, status, sort_order)
    values (auth.uid(), 'draft', p_sort_order)
    returning * into result;
  end if;

  -- 完了済みプロフィールは設定画面などから呼ばれても後退させない。
  if current_profile.onboarding_status <> 'complete' then
    update public.profiles
    set onboarding_status = 'in_progress', onboarding_completed_at = null
    where user_id = auth.uid();
  end if;

  return result;
end;
$function$;

revoke all on function public.start_household_onboarding(integer)
from public, anon, authenticated;
grant execute on function public.start_household_onboarding(integer) to authenticated;
