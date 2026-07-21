alter table public.menus
  add column version integer check (version > 0),
  add column selected_at timestamptz;

with ranked as (
  select id, row_number() over (
    partition by user_id, derivation_group_id order by created_at, id
  )::integer as calculated_version
  from public.menus
)
update public.menus as menu
set version = ranked.calculated_version,
    selected_at = case when menu.is_selected then menu.created_at else null end
from ranked
where ranked.id = menu.id;

alter table public.menus alter column version set not null;
alter table public.menus alter column version set default 1;
alter table public.menus add constraint menus_selected_timestamp_consistent
  check (is_selected = (selected_at is not null));
alter table public.menus
  drop constraint menus_parent_owner_fkey,
  add constraint menus_parent_owner_fkey
    foreign key (parent_menu_id,user_id) references public.menus(id,user_id)
    on delete set null (parent_menu_id);

-- 正規化子行、adaptation の分岐、ingredient/step に結び付く safety action の
-- 最終 owner-composite CASCADE 契約は Plan 2 が所有する。Plan 4 は上で契約を
-- 検査するだけで、該当する外部キーを削除・再作成しない。

create unique index menus_group_version_unique
  on public.menus(user_id, derivation_group_id, version);
create index menus_history_order
  on public.menus(user_id, created_at desc);

create table public.menu_revalidations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_id uuid not null,
  safety_fingerprint text not null,
  allergen_catalog_version text not null,
  food_rule_version text not null,
  status text not null check (status in ('valid', 'changed', 'invalid')),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  created_at timestamptz not null default now(),
  constraint menu_revalidations_one_per_menu_owner unique (menu_id,user_id),
  constraint menu_revalidations_menu_owner_fkey
    foreign key (menu_id,user_id) references public.menus(id,user_id) on delete cascade
);

alter table public.menu_revalidations enable row level security;
revoke all on public.menu_revalidations from anon, authenticated;
grant select on public.menu_revalidations to authenticated;

create policy menu_revalidations_select_own
  on public.menu_revalidations for select to authenticated
  using ((select auth.uid()) = user_id);
-- Plan 3 が replace_dish_id uuid を既に所有する。ADD COLUMN すると衝突するため FK のみ追加する。
alter table private.ai_generation_requests
  add constraint ai_generation_requests_replace_dish_id_fkey
  foreign key (replace_dish_id) references public.dishes(id) on delete set null;

-- reserve_ai_regeneration は作成しない。Plan 3 の canonical reservation RPC が完全な
-- GenerationCommand を受け取り、冪等性用には server-secret HMAC だけを保存し、success、
-- user daily attempt、short-window、global state を原子的に予約する。理由テキストは
-- finalization 成功までメモリ内だけに保持し、完了した menu にだけ保存する。

create or replace function private.assign_regeneration_lineage(
  p_user_id uuid,p_source_menu_id uuid,p_completed_menu_id uuid,
  p_change_reason text,p_change_reason_custom text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_group_id uuid;
  v_next_version integer;
begin
  if p_source_menu_id is null and p_change_reason is null
     and p_change_reason_custom is null then
    return; -- Plan 3 new-menu finalization uses this same hook.
  end if;
  if p_source_menu_id is null then
    raise exception using errcode='22023',message='invalid_regeneration_lineage';
  end if;
  if p_change_reason is null or p_change_reason not in (
    'simpler','different_ingredient','child_friendly','different_flavor','custom'
  ) or ((p_change_reason='custom')<>(p_change_reason_custom is not null))
    or (p_change_reason_custom is not null and
      char_length(btrim(p_change_reason_custom)) not between 1 and 200) then
    raise exception using errcode='22023',message='invalid_change_reason';
  end if;

  select derivation_group_id into v_group_id
  from public.menus
  where id = p_source_menu_id and user_id = p_user_id
  for update;
  if v_group_id is null then
    raise exception using errcode = 'P0002', message = 'source_menu_not_found';
  end if;

  perform 1 from public.menus
  where user_id = p_user_id and derivation_group_id = v_group_id
  order by id for update;
  select coalesce(max(version), 0) + 1 into v_next_version
  from public.menus
  where user_id = p_user_id and derivation_group_id = v_group_id;

  update public.menus
  set derivation_group_id = v_group_id,
      parent_menu_id = p_source_menu_id,
      version = v_next_version,
      change_reason = p_change_reason,
      change_reason_custom = p_change_reason_custom,
      is_selected = false,
      selected_at = null
  where id = p_completed_menu_id and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'completed_menu_not_found';
  end if;
  return;
end;
$$;
revoke all on function private.assign_regeneration_lineage(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;

create or replace function public.accept_menu_version(p_menu_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_group uuid;
begin
  select derivation_group_id into v_group
  from public.menus
  where id = p_menu_id and user_id = (select auth.uid())
  for update;

  if v_group is null then
    raise exception using errcode = 'P0002', message = 'menu_not_found';
  end if;

  perform 1
  from public.menus
  where user_id = (select auth.uid()) and derivation_group_id = v_group
  order by id
  for update;

  update public.menus
  set is_selected = false, selected_at = null
  where user_id = (select auth.uid()) and derivation_group_id = v_group and is_selected;

  update public.menus
  set is_selected = true, selected_at = now()
  where id = p_menu_id and user_id = (select auth.uid());
end;
$$;

revoke all on function public.accept_menu_version(uuid) from public, anon;
grant execute on function public.accept_menu_version(uuid) to authenticated;

create or replace function public.delete_menu_group(p_derivation_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.menus
  where user_id = (select auth.uid())
    and derivation_group_id = p_derivation_group_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_menu_group(uuid) from public, anon;
grant execute on function public.delete_menu_group(uuid) to authenticated;
