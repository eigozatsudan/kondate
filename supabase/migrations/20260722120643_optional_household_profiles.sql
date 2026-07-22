-- 家族設定の進捗（onboarding_status）にAI利用同意なしで完了/スキップできる
-- 'skipped' を追加し、set_onboarding_status を「入力・状態遷移の妥当性」だけを
-- 検査するRPCへ置き換える。privacy consentの有無はこのRPCの判断材料にしない
-- （AI同意はprivacy_consentsで独立に管理される。Plan7設計参照）。

alter table public.profiles drop constraint profiles_onboarding_status_check;
alter table public.profiles drop constraint profiles_check;

alter table public.profiles
  add constraint profiles_onboarding_status_check
  check (onboarding_status in ('not_started', 'in_progress', 'complete', 'skipped'));

alter table public.profiles
  add constraint profiles_onboarding_completed_at_check
  check (
    (onboarding_status in ('complete', 'skipped') and onboarding_completed_at is not null)
    or (onboarding_status in ('not_started', 'in_progress') and onboarding_completed_at is null)
  );

create or replace function public.set_onboarding_status(p_status text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles;
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_status not in ('in_progress', 'complete', 'skipped') then
    raise exception using errcode = '22023', message = 'invalid_onboarding_status';
  end if;

  -- プロフィール行を直列化点にし、start_household_onboardingと同じロック順序を
  -- 共有する。ロック後の現在値に対して冪等判定・遷移判定・家族完全性判定を行う。
  select profile.*
  into current_profile
  from public.profiles profile
  where profile.user_id = auth.uid()
  for update;

  if current_profile.user_id is null then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  if current_profile.onboarding_status = p_status then
    return current_profile;
  end if;

  if not (
    (current_profile.onboarding_status = 'not_started' and p_status in ('in_progress', 'skipped'))
    or (current_profile.onboarding_status = 'in_progress' and p_status in ('complete', 'skipped'))
    or (current_profile.onboarding_status = 'skipped' and p_status in ('in_progress', 'complete'))
  ) then
    raise exception using errcode = '22023', message = 'invalid_onboarding_transition';
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

  update public.profiles
  set onboarding_status = p_status,
      onboarding_completed_at = case
        when p_status in ('complete', 'skipped') then statement_timestamp()
        else null
      end
  where user_id = auth.uid()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.set_onboarding_status(text) from public, anon, authenticated;
grant execute on function public.set_onboarding_status(text) to authenticated;
