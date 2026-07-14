create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  quantity numeric(12,3) check (quantity > 0),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  expires_on date,
  expiration_type text check (expiration_type in ('use_by', 'best_before', 'other', 'unknown')),
  opened_state text check (opened_state in ('unopened', 'opened', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check ((quantity is null and unit is null) or (quantity is not null and unit is not null))
);

create index pantry_items_owner_expiry_idx
  on public.pantry_items (user_id, expires_on nulls last, created_at desc);

create or replace function private.is_valid_draft_pantry_selections(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  v_item jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;

  for v_item in
    select item from jsonb_array_elements(p_value) as items(item)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;

    if not (v_item ? 'pantryItemId')
      or not (v_item ? 'priority')
      or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item -> 'pantryItemId') <> 'string'
      or jsonb_typeof(v_item -> 'priority') <> 'string'
      or (v_item ->> 'priority') not in ('must_use', 'prefer_use') then
      return false;
    end if;

    begin
      perform (v_item ->> 'pantryItemId')::uuid;
    exception
      when invalid_text_representation then
        return false;
    end;
  end loop;

  return true;
end;
$function$;
revoke all on function private.is_valid_draft_pantry_selections(jsonb)
  from public, anon, authenticated;

create table public.generation_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner')),
  main_ingredients text[] not null default '{}',
  cuisine_genre text check (cuisine_genre in ('japanese', 'western', 'chinese', 'any')),
  target_member_ids uuid[] not null default '{}',
  time_limit_minutes smallint check (time_limit_minutes in (15, 30, 45)),
  budget_preference text check (budget_preference in ('economy', 'standard')),
  avoid_ingredients text[] not null default '{}',
  memo text not null default '' check (char_length(memo) <= 200),
  pantry_selections jsonb not null default '[]'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(main_ingredients) <= 8),
  check (cardinality(target_member_ids) <= 20),
  check (cardinality(avoid_ingredients) <= 20),
  check (private.is_valid_draft_pantry_selections(pantry_selections)),
  check (jsonb_array_length(pantry_selections) <= 50),
  check (pg_column_size(pantry_selections) <= 32768),
  check (
    not jsonb_path_exists(
      pantry_selections,
      '$[*] ? (exists(@.checkedAt) || exists(@.checkedOnJst) || exists(@.idempotencyKey))'
    )
  )
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger pantry_items_touch_updated_at
before update on public.pantry_items
for each row execute function private.touch_updated_at();

create trigger generation_drafts_touch_updated_at
before update on public.generation_drafts
for each row execute function private.touch_updated_at();

alter table public.pantry_items enable row level security;
alter table public.generation_drafts enable row level security;
revoke all on public.pantry_items from anon, authenticated;
revoke all on public.generation_drafts from anon, authenticated;
grant select, insert, update, delete on public.pantry_items to authenticated;
grant select, delete on public.generation_drafts to authenticated;

create policy pantry_items_owner_select on public.pantry_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy pantry_items_owner_insert on public.pantry_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_update on public.pantry_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy pantry_items_owner_delete on public.pantry_items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy generation_drafts_owner_select on public.generation_drafts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy generation_drafts_owner_insert on public.generation_drafts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy generation_drafts_owner_update on public.generation_drafts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy generation_drafts_owner_delete on public.generation_drafts
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.save_generation_draft(
  p_expected_revision bigint,p_meal_type text,p_main_ingredients text[],
  p_cuisine_genre text,p_target_member_ids uuid[],p_time_limit_minutes smallint,
  p_budget_preference text,p_avoid_ingredients text[],p_memo text,
  p_pantry_selections jsonb
) returns public.generation_drafts
language plpgsql security definer set search_path='' as $function$
declare v_user_id uuid:=(select auth.uid());v_saved public.generation_drafts;
begin
  if v_user_id is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='invalid_draft_save';
  end if;
  if p_expected_revision=0 then
    insert into public.generation_drafts(user_id,meal_type,main_ingredients,cuisine_genre,
      target_member_ids,time_limit_minutes,budget_preference,avoid_ingredients,memo,
      pantry_selections,revision)
    values(v_user_id,p_meal_type,p_main_ingredients,p_cuisine_genre,p_target_member_ids,
      p_time_limit_minutes,p_budget_preference,p_avoid_ingredients,p_memo,
      p_pantry_selections,1)
    on conflict(user_id) do nothing returning * into v_saved;
    if found then return v_saved;end if;
  end if;
  update public.generation_drafts set meal_type=p_meal_type,
    main_ingredients=p_main_ingredients,cuisine_genre=p_cuisine_genre,
    target_member_ids=p_target_member_ids,time_limit_minutes=p_time_limit_minutes,
    budget_preference=p_budget_preference,avoid_ingredients=p_avoid_ingredients,
    memo=p_memo,pantry_selections=p_pantry_selections,revision=revision+1
  where user_id=v_user_id and revision=p_expected_revision
  returning * into v_saved;
  if not found then
    raise exception using errcode='P0001',message='draft_revision_conflict';
  end if;
  return v_saved;
end;
$function$;
revoke all on function public.save_generation_draft(
  bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb
) from public,anon;
grant execute on function public.save_generation_draft(
  bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb
) to authenticated;
