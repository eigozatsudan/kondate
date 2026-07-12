drop policy if exists profiles_update_own on public.profiles;
revoke update on public.profiles from authenticated;

create or replace function public.set_onboarding_status(p_status text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.profiles;
begin
  if p_status not in ('in_progress', 'complete') then
    raise exception using errcode = '22023', message = 'invalid_onboarding_status';
  end if;
  if p_status = 'complete' and not exists (
    select 1
    from public.household_members member
    where member.user_id = auth.uid()
      and member.status = 'complete'
      and member.age_band is not null
      and member.allergy_status is not null
      and member.unsupported_diet_status is not null
      and (
        member.allergy_status <> 'registered'
        or exists (
          select 1
          from public.member_allergies allergy
          where allergy.user_id = auth.uid()
            and allergy.member_id = member.id
        )
      )
      and (
        member.unsupported_diet_status <> 'present'
        or cardinality(member.unsupported_diet_kinds) > 0
      )
  ) then
    raise exception using errcode = '23514', message = 'onboarding_members_incomplete';
  end if;
  if p_status = 'complete' and not exists (
    select 1
    from public.privacy_consents consent
    where consent.user_id = auth.uid()
      and consent.notice_version = '2026-07-11.v1'
  ) then
    raise exception using errcode = '23514', message = 'privacy_consent_required';
  end if;
  update public.profiles
  set onboarding_status = p_status,
      onboarding_completed_at = case when p_status = 'complete' then statement_timestamp() else null end
  where user_id = auth.uid()
  returning * into result;
  if result.user_id is null then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;
  return result;
end;
$$;

revoke all on function public.set_onboarding_status(text) from public, anon, authenticated;
grant execute on function public.set_onboarding_status(text) to authenticated;
