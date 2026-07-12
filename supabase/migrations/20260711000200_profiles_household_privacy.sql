create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'in_progress', 'complete')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (onboarding_status = 'complete' and onboarding_completed_at is not null)
    or (onboarding_status <> 'complete' and onboarding_completed_at is null)
  )
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'draft' check (status in ('draft', 'complete')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 30),
  age_band text check (
    age_band is null or age_band in (
      'post_weaning_to_2', 'age_3_5', 'age_6_8', 'age_9_12',
      'age_13_17', 'adult', 'senior'
    )
  ),
  portion_size text check (portion_size is null or portion_size in ('small', 'regular', 'large')),
  spice_level text check (spice_level is null or spice_level in ('none', 'mild', 'regular')),
  ease_preferences text[] not null default '{}'
    check (ease_preferences <@ array['small_pieces', 'boneless', 'soft']::text[]),
  required_safety_constraints text[] not null default '{}'
    check (required_safety_constraints <@ array['remove_bones', 'cut_small']::text[]),
  allergy_status text check (allergy_status is null or allergy_status in ('none', 'registered', 'unconfirmed')),
  unsupported_diet_status text check (
    unsupported_diet_status is null or unsupported_diet_status in ('none', 'present', 'unconfirmed')
  ),
  unsupported_diet_kinds text[] not null default '{}'
    check (
      unsupported_diet_kinds <@ array[
        'weaning_food', 'swallowing_concern', 'therapeutic_diet'
      ]::text[]
    ),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    status = 'draft'
    or (age_band is not null and allergy_status is not null and unsupported_diet_status is not null)
  ),
  check (
    (unsupported_diet_status = 'present' and cardinality(unsupported_diet_kinds) > 0)
    or (unsupported_diet_status is distinct from 'present' and cardinality(unsupported_diet_kinds) = 0)
  )
);

create table public.member_allergies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  member_id uuid not null,
  allergen_id text,
  custom_name text check (custom_name is null or char_length(btrim(custom_name)) between 1 and 80),
  custom_aliases text[] not null default '{}',
  custom_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (member_id, user_id)
    references public.household_members(id, user_id) on delete cascade,
  check (
    (allergen_id is not null and custom_name is null and not custom_confirmed and cardinality(custom_aliases) = 0)
    or (allergen_id is null and custom_name is not null and custom_confirmed)
  )
);

create unique index member_allergies_standard_unique
  on public.member_allergies(member_id, allergen_id)
  where allergen_id is not null;

create table public.member_dislikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  member_id uuid not null,
  ingredient_name text not null check (char_length(btrim(ingredient_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  foreign key (member_id, user_id)
    references public.household_members(id, user_id) on delete cascade
);

create unique index member_dislikes_name_unique
  on public.member_dislikes(member_id, lower(btrim(ingredient_name)));

create table public.privacy_consents (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  notice_version text not null check (char_length(notice_version) between 1 and 50),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, notice_version)
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles(user_id) values (new.id);
  return new;
end;
$function$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

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
        select 1 from public.member_allergies
        where member_id = p_member_id and user_id = auth.uid()
      )
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

alter table public.profiles enable row level security;
alter table public.household_members enable row level security;
alter table public.member_allergies enable row level security;
alter table public.member_dislikes enable row level security;
alter table public.privacy_consents enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated using (user_id = auth.uid());
create policy profiles_update_own on public.profiles
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy members_select_own on public.household_members
for select to authenticated using (user_id = auth.uid());
create policy members_insert_own on public.household_members
for insert to authenticated with check (user_id = auth.uid());
create policy members_update_own on public.household_members
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete_own on public.household_members
for delete to authenticated using (user_id = auth.uid());

create policy allergies_select_own on public.member_allergies
for select to authenticated using (user_id = auth.uid());
create policy allergies_insert_own on public.member_allergies
for insert to authenticated with check (user_id = auth.uid());
create policy allergies_update_own on public.member_allergies
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy allergies_delete_own on public.member_allergies
for delete to authenticated using (user_id = auth.uid());

create policy dislikes_select_own on public.member_dislikes
for select to authenticated using (user_id = auth.uid());
create policy dislikes_insert_own on public.member_dislikes
for insert to authenticated with check (user_id = auth.uid());
create policy dislikes_update_own on public.member_dislikes
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dislikes_delete_own on public.member_dislikes
for delete to authenticated using (user_id = auth.uid());

create policy consents_select_own on public.privacy_consents
for select to authenticated using (user_id = auth.uid());
create policy consents_insert_own on public.privacy_consents
for insert to authenticated with check (user_id = auth.uid());

revoke all on public.profiles, public.household_members, public.member_allergies,
  public.member_dislikes, public.privacy_consents from anon;
revoke all on public.profiles, public.household_members, public.member_allergies,
  public.member_dislikes, public.privacy_consents from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.member_allergies to authenticated;
grant select, insert, update, delete on public.member_dislikes to authenticated;
grant select, insert on public.privacy_consents to authenticated;

revoke all on function public.complete_household_member(uuid) from public, anon;
grant execute on function public.complete_household_member(uuid) to authenticated;
