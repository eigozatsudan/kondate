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

-- Plan 4 Task 3: 現行 canonical ラベル確認要件の reconcile。
-- service_role 専用。Plan 3 の 3 引数 confirm_menu_label_confirmation は触らない。
create or replace function public.reconcile_menu_label_confirmations(
  p_user_id uuid,
  p_menu_id uuid,
  p_expected_safety_fingerprint text,
  p_requirements jsonb
)
returns setof public.menu_label_confirmations
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_menu_owner uuid;
  v_target_member_ids uuid[];
  v_requirement jsonb;
  v_source_type text;
  v_source_id uuid;
  v_source_path text;
  v_source_text text;
  v_allergen_id text;
  v_anonymous_ref text;
  v_dictionary_version text;
  v_identity text;
  v_seen text[] := array[]::text[];
  v_ws text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_allowed_keys text[] := array[
    'sourceType','sourceId','sourcePath','sourceTextSnapshot',
    'allergenId','anonymousMemberRef','dictionaryVersion'
  ];
begin
  if p_user_id is null or p_menu_id is null then
    raise exception using errcode = '22023', message = 'invalid_reconcile_request';
  end if;
  if p_expected_safety_fingerprint is null
     or p_expected_safety_fingerprint is distinct from btrim(p_expected_safety_fingerprint, v_ws)
     or char_length(p_expected_safety_fingerprint) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_safety_fingerprint';
  end if;
  if p_requirements is null or jsonb_typeof(p_requirements) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_requirements';
  end if;
  if jsonb_array_length(p_requirements) > 200 then
    raise exception using errcode = '22023', message = 'requirements_cap_exceeded';
  end if;

  -- 所有者メニューと生存ターゲット行をロックし、数値 suffix 順で target ids を組み立てる
  select menu.user_id into v_menu_owner
  from public.menus menu
  where menu.id = p_menu_id and menu.user_id = p_user_id
  for update;
  if v_menu_owner is null then
    raise exception using errcode = 'P0002', message = 'menu_not_found';
  end if;

  perform 1
  from public.menu_target_members target
  where target.menu_id = p_menu_id
    and target.user_id = p_user_id
    and target.household_member_id is not null
  order by substring(target.anonymous_ref from '^member_([1-9][0-9]*)$')::integer
  for update;

  select array_agg(
    target.household_member_id
    order by substring(target.anonymous_ref from '^member_([1-9][0-9]*)$')::integer
  )
    into v_target_member_ids
  from public.menu_target_members target
  where target.menu_id = p_menu_id
    and target.user_id = p_user_id
    and target.household_member_id is not null;

  if coalesce(cardinality(v_target_member_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'current_target_member_required';
  end if;

  perform private.lock_and_assert_current_safety_fingerprint(
    p_user_id, v_target_member_ids, p_expected_safety_fingerprint
  );

  -- 先に現行フラグを下ろし、partial unique (one current requirement) を空ける
  update public.menu_label_confirmations
  set is_current = false
  where menu_id = p_menu_id
    and user_id = p_user_id
    and is_current;

  for v_requirement in
    select value from jsonb_array_elements(p_requirements)
  loop
    if jsonb_typeof(v_requirement) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid_requirement_shape';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_requirement) as keys(key)
      where keys.key <> all (v_allowed_keys)
    ) or (
      select count(*) from jsonb_object_keys(v_requirement)
    ) <> cardinality(v_allowed_keys) then
      raise exception using errcode = '22023', message = 'invalid_requirement_keys';
    end if;

    v_source_type := v_requirement->>'sourceType';
    begin
      v_source_id := (v_requirement->>'sourceId')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_requirement_source_id';
    end;
    v_source_path := v_requirement->>'sourcePath';
    v_source_text := v_requirement->>'sourceTextSnapshot';
    v_allergen_id := v_requirement->>'allergenId';
    v_anonymous_ref := v_requirement->>'anonymousMemberRef';
    v_dictionary_version := v_requirement->>'dictionaryVersion';

    if v_source_type is null
       or v_source_type not in ('dish','ingredient','recipe_step','adaptation','timeline')
       or v_source_path is null
       or char_length(btrim(v_source_path)) not between 1 and 200
       or v_source_text is null
       or v_source_text is distinct from btrim(v_source_text, v_ws)
       or char_length(v_source_text) not between 1 and 500
       or v_allergen_id is null
       or v_allergen_id !~ '^[a-z][a-z0-9_]*$'
       or v_anonymous_ref is null
       or v_anonymous_ref !~ '^member_[1-9][0-9]*$'
       or v_dictionary_version is null
       or char_length(btrim(v_dictionary_version)) < 1 then
      raise exception using errcode = '22023', message = 'invalid_requirement_fields';
    end if;

    v_identity := concat_ws(
      E'\u0001',
      v_source_type,
      v_source_id::text,
      v_source_path,
      v_allergen_id,
      v_anonymous_ref,
      v_dictionary_version
    );
    if v_identity = any (v_seen) then
      raise exception using errcode = '22023', message = 'duplicate_requirement';
    end if;
    v_seen := array_append(v_seen, v_identity);

    insert into public.menu_label_confirmations (
      menu_id, user_id, source_type, source_id, source_path, source_text_snapshot,
      allergen_id, anonymous_member_ref, dictionary_version,
      requirement_safety_fingerprint, is_current, confirmation_status
    ) values (
      p_menu_id, p_user_id, v_source_type, v_source_id, v_source_path, v_source_text,
      v_allergen_id, v_anonymous_ref, v_dictionary_version,
      p_expected_safety_fingerprint, true, 'pending'
    )
    on conflict (
      menu_id, source_type, source_id, source_path, allergen_id,
      anonymous_member_ref, dictionary_version, requirement_safety_fingerprint
    ) do update set
      -- 同一 fingerprint 再 reconcile では confirmed 証跡と immutable snapshot を保持
      is_current = true,
      source_text_snapshot = public.menu_label_confirmations.source_text_snapshot,
      confirmation_status = public.menu_label_confirmations.confirmation_status,
      confirmed_at = public.menu_label_confirmations.confirmed_at,
      confirmed_by = public.menu_label_confirmations.confirmed_by;
  end loop;

  return query
    select confirmation.*
    from public.menu_label_confirmations confirmation
    where confirmation.menu_id = p_menu_id
      and confirmation.user_id = p_user_id
      and confirmation.is_current
    order by
      confirmation.source_path,
      confirmation.allergen_id,
      confirmation.anonymous_member_ref;
end;
$function$;

revoke all on function public.reconcile_menu_label_confirmations(uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_menu_label_confirmations(uuid,uuid,text,jsonb)
  to service_role;
