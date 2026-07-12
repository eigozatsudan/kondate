create or replace function private.normalize_member_allergy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.custom_name is not null then
    new.custom_name := btrim(normalize(new.custom_name, NFKC));
  end if;

  select coalesce(array_agg(btrim(normalize(alias, NFKC)) order by ordinal), array[]::text[])
  into new.custom_aliases
  from unnest(new.custom_aliases) with ordinality as aliases(alias, ordinal);

  if cardinality(new.custom_aliases) > 10
    or exists (
      select 1
      from unnest(new.custom_aliases) as alias
      where alias is null or char_length(alias) not between 1 and 80
    )
    or cardinality(new.custom_aliases) <> (
      select count(distinct alias)
      from unnest(new.custom_aliases) as alias
    ) then
    raise exception using
      errcode = '23514',
      message = 'invalid_custom_allergy_aliases';
  end if;

  return new;
end;
$function$;

drop trigger if exists member_allergies_normalize_before_write on public.member_allergies;
create trigger member_allergies_normalize_before_write
before insert or update of custom_name, custom_aliases on public.member_allergies
for each row execute function private.normalize_member_allergy();

create or replace function private.enforce_registered_member_allergy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'complete'
    and new.allergy_status = 'registered'
    and not exists (
      select 1
      from public.member_allergies allergy
      where allergy.member_id = new.id
        and allergy.user_id = new.user_id
    ) then
    raise exception using
      errcode = '23514',
      message = 'member_registered_allergy_required';
  end if;

  return new;
end;
$function$;

drop trigger if exists household_members_enforce_registered_allergy on public.household_members;
create trigger household_members_enforce_registered_allergy
before insert or update of status, allergy_status, user_id on public.household_members
for each row execute function private.enforce_registered_member_allergy();

create or replace function private.prevent_last_registered_member_allergy_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.household_members member
    where member.id = old.member_id
      and member.user_id = old.user_id
      and member.status = 'complete'
      and member.allergy_status = 'registered'
  ) and not exists (
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

drop trigger if exists member_allergies_prevent_last_registered_removal on public.member_allergies;
create trigger member_allergies_prevent_last_registered_removal
before delete or update of member_id, user_id on public.member_allergies
for each row execute function private.prevent_last_registered_member_allergy_removal();

create index if not exists auth_continuations_expires_at_idx
  on private.auth_continuations(expires_at, id);

create or replace function public.cleanup_auth_continuations(p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare deleted_count bigint;
begin
  with expired as (
    select id
    from private.auth_continuations
    where expires_at <= p_now
    order by expires_at, id
    limit 100
  )
  delete from private.auth_continuations continuation
  using expired
  where continuation.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;
