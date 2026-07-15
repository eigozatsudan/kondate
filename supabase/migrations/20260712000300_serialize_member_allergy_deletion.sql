create or replace function private.prevent_last_registered_member_allergy_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- 親行を共通の排他境界にして、同じ家族に対する削除と状態変更を直列化する。
  perform 1
  from public.household_members member
  where member.id = old.member_id
    and member.user_id = old.user_id
  for update;

  if found
    and exists (
      select 1
      from public.household_members member
      where member.id = old.member_id
        and member.user_id = old.user_id
        and member.status = 'complete'
        and member.allergy_status = 'registered'
    )
    and not exists (
      select 1
      from public.member_allergies allergy
      where allergy.member_id = old.member_id
        and allergy.user_id = old.user_id
        and allergy.id <> old.id
    ) then
    raise exception using
      errcode = '23514',
      message = 'member_registered_allergy_required';
  end if;

  return old;
end;
$function$;

create or replace function public.delete_member_allergy(p_allergy_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_member_id uuid;
  target_user_id uuid;
begin
  -- SECURITY DEFINERでも呼出ユーザーの所有行だけを対象にし、他人の存在を応答から漏らさない。
  select allergy.member_id, allergy.user_id
  into target_member_id, target_user_id
  from public.member_allergies allergy
  where allergy.id = p_allergy_id
    and allergy.user_id = auth.uid();

  if target_member_id is null then
    return;
  end if;

  -- DELETEより前に親行をロックし、待機後の最新状態を削除トリガーから検査できるようにする。
  perform 1
  from public.household_members member
  where member.id = target_member_id
    and member.user_id = target_user_id
  for update;

  delete from public.member_allergies allergy
  where allergy.id = p_allergy_id
    and allergy.member_id = target_member_id
    and allergy.user_id = target_user_id;
end;
$function$;

revoke update, delete on public.member_allergies from authenticated;
revoke all on function public.delete_member_allergy(uuid) from public, anon;
grant execute on function public.delete_member_allergy(uuid) to authenticated;
