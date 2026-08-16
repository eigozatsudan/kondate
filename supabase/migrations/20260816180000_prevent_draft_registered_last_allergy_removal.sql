-- H-R3: draft registered の最終 1 件削除も拒否する。
-- 既存 trigger は complete + registered のみだった。UI の fresh fetch 後も
-- 2 タブが別 id を消すと draft registered+0 が残る。
-- complete_household_member / enforce_registered_member_allergy は緩めない。
-- 既存 migration 20260712000300 は書き換えない。関数本体の置換のみ。

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
