-- dblink は supabase/tests/database/shopping_lists.test.sql の並行実行（race）テストが
-- 別セッションを開いて安全フィンガープリントの再チェックを検証するために必要。
-- 本番コードパスはdblinkを一切使用しない（pgTAPテスト専用の依存）。
create extension if not exists dblink with schema extensions;

-- dblink はスーパーユーザー以外の呼び出し元にパスワード（またはGSSAPI委任クレデンシャル）を
-- 要求する固定ポリシーを持ち、pg_hba.confのtrust/peer設定とは独立している。この環境の
-- postgres/service_roleロールはいずれもスーパーユーザーではないため、pgTAPの並行実行
-- （race）テストがdblink_connectで自己接続するには専用ロールが必要。
-- 権限は「並行race検証で他セッションから直接書き込む対象テーブルのみ」に絞り、
-- 固定パスワードはこのロール専用でどのシークレット管理下にも置かない
-- （本番コードパス・本番データへの影響はない、テストDBのみで作成されるテスト専用ロール）。
do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'shopping_pgtap_dblink_test') then
    create role shopping_pgtap_dblink_test with login password 'shopping_pgtap_dblink_test_only'
      nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
end;
$block$;
revoke all on schema public from shopping_pgtap_dblink_test;
grant usage on schema public to shopping_pgtap_dblink_test;
grant select, insert, update on public.household_members, public.member_allergies
  to shopping_pgtap_dblink_test;

alter table public.dish_ingredients
  add constraint dish_ingredients_id_user_unique unique (id,user_id);
alter table public.menu_label_confirmations
  add constraint menu_label_confirmations_id_user_unique unique (id,user_id);

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id)
);
create unique index shopping_lists_one_active_per_user
  on public.shopping_lists(user_id) where status='active';

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 100),
  store_section text not null check (store_section in
    ('produce','meat_fish','dairy_eggs','dry_goods','seasonings','other')),
  quantity_value numeric(12,3) check (quantity_value > 0),
  quantity_text text not null check (char_length(btrim(quantity_text)) between 1 and 60),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  pantry_check_required boolean not null default false,
  is_checked boolean not null default false,
  is_manual boolean not null default false,
  is_manually_edited boolean not null default false,
  is_removed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade
);

create table public.shopping_list_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  menu_id uuid,
  source_menu_id_snapshot uuid not null,
  source_menu_version integer not null check (source_menu_version > 0),
  source_derivation_group_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  unique (list_id,source_menu_id_snapshot,source_menu_version),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  foreign key (menu_id,user_id) references public.menus(id,user_id) on delete set null (menu_id)
);

create table public.shopping_item_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  dish_ingredient_id uuid,
  source_ingredient_id_snapshot uuid not null,
  source_dish_id_snapshot uuid not null,
  source_dish_name text not null,
  source_name text not null,
  source_quantity_value numeric(12,3),
  source_quantity_text text not null,
  source_unit text,
  created_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  foreign key (dish_ingredient_id,user_id)
    references public.dish_ingredients(id,user_id) on delete set null (dish_ingredient_id)
);

create table public.shopping_label_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  item_id uuid,
  menu_label_confirmation_id uuid,
  source_confirmation_id_snapshot uuid,
  source_warning_key text not null check (source_warning_key ~ '^[a-f0-9]{64}$'),
  source_menu_id_snapshot uuid not null,
  source_derivation_group_id uuid not null,
  source_type text not null check (source_type in ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id_snapshot uuid not null,
  source_path text not null,
  source_display_name text not null check (char_length(btrim(source_display_name)) between 1 and 500),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  allergen_display_name text not null check (char_length(btrim(allergen_display_name)) between 1 and 100),
  anonymous_member_ref text not null,
  member_display_name text not null check (char_length(btrim(member_display_name)) between 1 and 100),
  dictionary_version text not null,
  confirmation_status text not null check (confirmation_status in ('pending','confirmed')),
  created_at timestamptz not null default now(),
  unique (id,user_id),
  foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  foreign key (menu_label_confirmation_id,user_id)
    references public.menu_label_confirmations(id,user_id)
    on delete set null (menu_label_confirmation_id)
);
create unique index shopping_label_warning_snapshot_unique
  on public.shopping_label_confirmations(
    list_id,coalesce(item_id,'00000000-0000-0000-0000-000000000000'::uuid),source_warning_key
  );

create table public.shopping_current_label_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id uuid not null,
  item_id uuid,
  warning_key text not null check (warning_key ~ '^[a-f0-9]{64}$'),
  source_menu_id uuid not null,
  source_derivation_group_id uuid not null,
  source_type text not null check (source_type in
    ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id uuid not null,
  source_path text not null check (char_length(btrim(source_path)) between 1 and 200),
  source_display_name text not null check (char_length(btrim(source_display_name)) between 1 and 500),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  allergen_display_name text not null check (char_length(btrim(allergen_display_name)) between 1 and 100),
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  member_display_name text not null check (char_length(btrim(member_display_name)) between 1 and 100),
  dictionary_version text not null check (char_length(btrim(dictionary_version)) between 1 and 80),
  checked_at timestamptz not null default now(),
  unique (id,user_id),
  constraint shopping_current_label_warnings_list_owner_fk
    foreign key (list_id,user_id) references public.shopping_lists(id,user_id) on delete cascade,
  constraint shopping_current_label_warnings_item_owner_fk
    foreign key (item_id,user_id) references public.shopping_items(id,user_id) on delete cascade,
  constraint shopping_current_label_warnings_menu_owner_fk
    foreign key (source_menu_id,user_id) references public.menus(id,user_id) on delete cascade
);
create unique index shopping_current_label_warnings_list_item_key_unique
  on public.shopping_current_label_warnings(
    list_id,coalesce(item_id,'00000000-0000-0000-0000-000000000000'::uuid),warning_key
  );

create table private.shopping_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_at timestamptz not null default now(),
  primary key (user_id,idempotency_key)
);
create index shopping_mutations_created_at_idx
  on private.shopping_mutations(created_at);
create index shopping_mutations_owner_created_at_idx
  on private.shopping_mutations(user_id,created_at,idempotency_key);

create or replace function private.cleanup_expired_shopping_mutations(
  p_user_id uuid,p_limit integer default 100
)
returns bigint language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_deleted bigint;
begin
  if p_user_id is null or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='invalid_cleanup_limit';
  end if;
  delete from private.shopping_mutations target where target.ctid in (
    select candidate.ctid from private.shopping_mutations candidate
      where candidate.user_id=p_user_id
        and candidate.created_at < now()-interval '30 days'
      order by candidate.created_at,candidate.idempotency_key limit p_limit
  );
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$function$;

do $block$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='household_members') then
    execute 'alter publication supabase_realtime add table public.household_members';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='member_allergies') then
    execute 'alter publication supabase_realtime add table public.member_allergies';
  end if;
end;
$block$;
alter table public.household_members replica identity full;
alter table public.member_allergies replica identity full;

create or replace function private.enforce_shopping_item_provenance()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $function$
begin
  if old.is_manual <> new.is_manual
    or (old.is_manually_edited and not new.is_manually_edited) then
    raise exception using errcode='22023',message='shopping_provenance_is_monotonic';
  end if;
  return new;
end;
$function$;
create trigger shopping_items_provenance_monotonic before update on public.shopping_items
for each row execute function private.enforce_shopping_item_provenance();

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_list_sources enable row level security;
alter table public.shopping_item_sources enable row level security;
alter table public.shopping_label_confirmations enable row level security;
alter table public.shopping_current_label_warnings enable row level security;

create policy shopping_lists_select_own on public.shopping_lists for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_items_select_own on public.shopping_items for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_list_sources_select_own on public.shopping_list_sources for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_item_sources_select_own on public.shopping_item_sources for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_labels_select_own on public.shopping_label_confirmations for select to authenticated
  using ((select auth.uid())=user_id);
create policy shopping_current_labels_select_own on public.shopping_current_label_warnings
  for select to authenticated using ((select auth.uid())=user_id);

revoke all on public.shopping_lists,public.shopping_items,public.shopping_list_sources,
  public.shopping_item_sources,public.shopping_label_confirmations,
  public.shopping_current_label_warnings from public,anon,authenticated;
grant select on public.shopping_lists,public.shopping_items,public.shopping_list_sources,
  public.shopping_item_sources,public.shopping_label_confirmations,
  public.shopping_current_label_warnings to authenticated;
revoke insert,update,delete on public.shopping_items from authenticated;

create or replace function public.shopping_safety_fingerprint(p_user_id uuid,p_menu_id uuid)
returns text language sql stable security definer set search_path=pg_catalog,pg_temp as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'householdMemberId',m.id,'anonymousRef',t.anonymous_ref,'ageBand',m.age_band,
      'allergyStatus',m.allergy_status,
      'allergenIds',coalesce((select jsonb_agg(a.allergen_id order by a.allergen_id)
        from public.member_allergies a where a.user_id=m.user_id and a.member_id=m.id
          and a.allergen_id is not null),'[]'::jsonb),
      'hasUnmappedCustomAllergy',exists(select 1 from public.member_allergies a
        where a.user_id=m.user_id and a.member_id=m.id and a.allergen_id is null),
      'requiredSafetyConstraints',to_jsonb(array(select unnest(m.required_safety_constraints) order by 1)),
      'unsupportedDietStatus',m.unsupported_diet_status,
      'unsupportedDietKinds',to_jsonb(array(select unnest(m.unsupported_diet_kinds) order by 1))
      ) order by m.id)
      from public.household_members m join public.menu_target_members t
        on t.household_member_id=m.id and t.user_id=m.user_id
      where t.menu_id=p_menu_id and m.user_id=p_user_id),'[]'::jsonb),
    'dictionaryVersion',coalesce((select max(dictionary_version) from public.allergen_aliases),''),
    'foodRuleVersion',coalesce((select max(rule_version) from public.food_safety_rules),'')
  )::text,'UTF8'),'sha256'),'hex');
$function$;

create or replace function private.lock_and_check_shopping_safety(
  p_user_id uuid,p_menu_id uuid,p_expected text
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
begin
  perform 1 from public.menus where id=p_menu_id and user_id=p_user_id for share;
  if not found then raise exception using errcode='P0002',message='menu_not_found'; end if;
  perform 1 from public.household_members m join public.menu_target_members t
    on t.household_member_id=m.id and t.user_id=m.user_id
    where t.menu_id=p_menu_id and m.user_id=p_user_id for update of m;
  perform 1 from public.member_allergies a join public.menu_target_members t
    on t.household_member_id=a.member_id and t.user_id=a.user_id
    where t.menu_id=p_menu_id and a.user_id=p_user_id for update of a;
  lock table public.allergen_catalog,public.allergen_aliases,public.food_safety_rules in share mode;
  if public.shopping_safety_fingerprint(p_user_id,p_menu_id)<>p_expected then
    raise exception using errcode='P0001',message='safety_fingerprint_changed';
  end if;
end;
$function$;

create or replace function public.shopping_list_safety_fingerprint(
  p_user_id uuid,p_list_id uuid
) returns text language plpgsql stable security definer
set search_path=pg_catalog,pg_temp as $function$
declare v_material text;
begin
  if not exists(select 1 from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active') then return null; end if;
  if exists(select 1 from public.shopping_list_sources
    where list_id=p_list_id and user_id=p_user_id and menu_id is null) then return null; end if;
  select string_agg(source.menu_id::text||':'||
    public.shopping_safety_fingerprint(p_user_id,source.menu_id),'|' order by source.menu_id)
    into v_material from (select distinct menu_id from public.shopping_list_sources
      where list_id=p_list_id and user_id=p_user_id and menu_id is not null) source;
  return encode(extensions.digest(convert_to(coalesce(v_material,'manual-only'),'UTF8'),'sha256'),'hex');
end;
$function$;

create or replace function private.lock_and_check_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected text
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_source record;v_current text;
begin
  perform 1 from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if not found then raise exception using errcode='P0002',message='shopping_list_not_found'; end if;
  for v_source in select menu_id from public.shopping_list_sources
    where list_id=p_list_id and user_id=p_user_id order by source_menu_id_snapshot for share
  loop
    if v_source.menu_id is null then
      raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
    end if;
    v_current:=public.shopping_safety_fingerprint(p_user_id,v_source.menu_id);
    perform private.lock_and_check_shopping_safety(p_user_id,v_source.menu_id,v_current);
  end loop;
  if public.shopping_list_safety_fingerprint(p_user_id,p_list_id) is distinct from p_expected then
    raise exception using errcode='P0001',message='shopping_safety_fingerprint_changed';
  end if;
end;
$function$;

create or replace function public.refresh_shopping_list_safety(
  p_user_id uuid,p_list_id uuid,p_expected_fingerprint text,p_warnings jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_warning jsonb;v_item_user uuid;v_projection jsonb;
begin
  if jsonb_typeof(p_warnings) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  if jsonb_array_length(p_warnings)>300 then
    raise exception using errcode='22023',message='invalid_shopping_warnings';
  end if;
  perform private.lock_and_check_shopping_list_safety(
    p_user_id,p_list_id,p_expected_fingerprint);
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_warning in select value from jsonb_array_elements(p_warnings) loop
    if jsonb_typeof(v_warning) is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if not (v_warning ?& array['warningKey','sourceMenuId','sourceDerivationGroupId',
      'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
      'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId'])
      or v_warning-array['warningKey','sourceMenuId','sourceDerivationGroupId',
        'sourceType','sourceId','sourcePath','sourceDisplayName','allergenId',
        'allergenDisplayName','anonymousMemberRef','memberDisplayName','dictionaryVersion','itemId']
          <> '{}'::jsonb then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    if nullif(v_warning->>'itemId','') is not null then
      select user_id into v_item_user from public.shopping_items
        where id=(v_warning->>'itemId')::uuid and list_id=p_list_id and user_id=p_user_id for share;
      if v_item_user is distinct from p_user_id then
        raise exception using errcode='22023',message='invalid_shopping_warnings';
      end if;
    end if;
    if not exists(select 1 from public.shopping_list_sources where user_id=p_user_id
      and list_id=p_list_id and menu_id=(v_warning->>'sourceMenuId')::uuid for share) then
      raise exception using errcode='22023',message='invalid_shopping_warnings';
    end if;
    insert into public.shopping_current_label_warnings(user_id,list_id,item_id,
      warning_key,source_menu_id,source_derivation_group_id,source_type,source_id,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version)
    values(p_user_id,p_list_id,nullif(v_warning->>'itemId','')::uuid,
      v_warning->>'warningKey',
      (v_warning->>'sourceMenuId')::uuid,(v_warning->>'sourceDerivationGroupId')::uuid,
      v_warning->>'sourceType',(v_warning->>'sourceId')::uuid,v_warning->>'sourcePath',
      v_warning->>'sourceDisplayName',v_warning->>'allergenId',
      v_warning->>'allergenDisplayName',v_warning->>'anonymousMemberRef',
      v_warning->>'memberDisplayName',v_warning->>'dictionaryVersion');
  end loop;
  update public.shopping_lists set safety_fingerprint=p_expected_fingerprint,updated_at=now()
    where id=p_list_id and user_id=p_user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId',item_id,'warningKey',warning_key,'sourceMenuId',source_menu_id,
      'sourceDerivationGroupId',source_derivation_group_id,'sourceType',source_type,
      'sourceId',source_id,'sourcePath',source_path,'sourceDisplayName',source_display_name,
      'allergenId',allergen_id,'allergenDisplayName',allergen_display_name,
      'anonymousMemberRef',anonymous_member_ref,'memberDisplayName',member_display_name,
      'dictionaryVersion',dictionary_version
    ) order by warning_key,item_id nulls first),'[]'::jsonb) into v_projection
    from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  return jsonb_build_object('listId',p_list_id,'safetyFingerprint',p_expected_fingerprint,
    'currentLabelWarnings',v_projection);
end;
$function$;

create or replace function private.write_shopping_items(
  p_user_id uuid,p_list_id uuid,p_items jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_item jsonb; v_source jsonb; v_label jsonb; v_item_id uuid;
begin
  if jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_items';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id:=coalesce(nullif(v_item->>'existingItemId','')::uuid,gen_random_uuid());
    insert into public.shopping_items(id,user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required)
    values(v_item_id,p_user_id,p_list_id,v_item->>'displayName',v_item->>'normalizedName',
      v_item->>'storeSection',nullif(v_item->>'quantityValue','')::numeric,
      v_item->>'quantityText',nullif(v_item->>'unit',''),(v_item->>'pantryCheckRequired')::boolean)
    on conflict(id) do update set
      display_name=excluded.display_name,normalized_name=excluded.normalized_name,
      store_section=excluded.store_section,quantity_value=excluded.quantity_value,
      quantity_text=excluded.quantity_text,unit=excluded.unit,
      pantry_check_required=excluded.pantry_check_required,updated_at=now()
    where public.shopping_items.user_id=p_user_id and public.shopping_items.list_id=p_list_id
      and not(public.shopping_items.is_checked or public.shopping_items.is_manual
        or public.shopping_items.is_manually_edited or public.shopping_items.is_removed_by_user);
    if not found then raise exception using errcode='P0001',message='protected_item_conflict'; end if;
    delete from public.shopping_item_sources where item_id=v_item_id and user_id=p_user_id;
    delete from public.shopping_label_confirmations where item_id=v_item_id and user_id=p_user_id;
    for v_source in select value from jsonb_array_elements(v_item->'sourceIngredients') loop
      insert into public.shopping_item_sources(user_id,item_id,dish_ingredient_id,
        source_ingredient_id_snapshot,source_dish_id_snapshot,source_dish_name,source_name,
        source_quantity_value,source_quantity_text,source_unit)
      values(p_user_id,v_item_id,(v_source->>'ingredientId')::uuid,
        (v_source->>'ingredientId')::uuid,(v_source->>'dishId')::uuid,
        v_source->>'dishName',v_source->>'name',nullif(v_source->>'quantityValue','')::numeric,
        v_source->>'quantityText',nullif(v_source->>'unit',''));
    end loop;
    for v_label in select value from jsonb_array_elements(v_item->'labelWarnings') loop
      insert into public.shopping_label_confirmations(user_id,list_id,item_id,
        menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
        source_menu_id_snapshot,
        source_derivation_group_id,source_type,source_id_snapshot,
        source_path,source_display_name,allergen_id,allergen_display_name,
        anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
      values(p_user_id,p_list_id,v_item_id,nullif(v_label->>'confirmationId','')::uuid,
        nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
        (v_label->>'sourceMenuId')::uuid,
        (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
        (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
        v_label->>'allergenId',v_label->>'allergenDisplayName',
        v_label->>'anonymousMemberRef',v_label->>'memberDisplayName',v_label->>'dictionaryVersion',
        'pending');
    end loop;
  end loop;
end;
$function$;

create or replace function public.apply_shopping_draft(
  p_user_id uuid,p_menu_id uuid,p_mode text,p_active_list_id uuid,
  p_expected_list_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_hash text; v_saved private.shopping_mutations; v_active public.shopping_lists;
  v_list public.shopping_lists; v_menu public.menus; v_label jsonb; v_response jsonb;
  v_source_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then raise exception using errcode='22023',message='idempotency_payload_mismatch'; end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  if p_mode not in('new','append') or jsonb_typeof(p_draft->'items')<>'array'
    or jsonb_typeof(p_draft->'listLabelWarnings')<>'array' then
    raise exception using errcode='22023',message='invalid_shopping_draft';
  end if;
  perform private.lock_and_check_shopping_safety(p_user_id,p_menu_id,p_safety_fingerprint);
  select * into v_menu from public.menus where id=p_menu_id and user_id=p_user_id for share;
  select * into v_active from public.shopping_lists
    where user_id=p_user_id and status='active' for update;
  if p_mode='append' then
    if v_active.id is null or v_active.id is distinct from p_active_list_id
      or v_active.version is distinct from p_expected_list_version then
      raise exception using errcode='P0001',message='list_version_conflict';
    end if;
    update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
      updated_at=now() where id=v_active.id returning * into v_list;
  else
    if v_active.id is null then
      if p_active_list_id is not null or p_expected_list_version is not null then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
    else
      if v_active.id is distinct from p_active_list_id
        or v_active.version is distinct from p_expected_list_version then
        raise exception using errcode='P0001',message='list_version_conflict';
      end if;
      update public.shopping_lists set status='archived',updated_at=now() where id=v_active.id;
    end if;
    insert into public.shopping_lists(user_id,safety_fingerprint)
      values(p_user_id,p_safety_fingerprint) returning * into v_list;
  end if;
  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,v_list.id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=v_list.id;
  perform private.write_shopping_items(p_user_id,v_list.id,p_draft->'items');
  for v_label in select value from jsonb_array_elements(p_draft->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,
      source_path,source_display_name,allergen_id,allergen_display_name,
      anonymous_member_ref,member_display_name,dictionary_version,confirmation_status)
    values(p_user_id,v_list.id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

create or replace function public.apply_shopping_reconciliation(
  p_user_id uuid,p_list_id uuid,p_expected_list_version integer,p_source_menu_id uuid,
  p_source_menu_version integer,p_safety_fingerprint text,p_idempotency_key uuid,
  p_request_hash text,p_resolved_diff jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_hash text; v_saved private.shopping_mutations; v_list public.shopping_lists;
  v_menu public.menus; v_id uuid; v_source_id uuid; v_label jsonb; v_response jsonb;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid_request_hash';
  end if;
  v_hash:=p_request_hash;
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then raise exception using errcode='22023',message='idempotency_payload_mismatch'; end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=p_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;
  select * into v_menu from public.menus
    where id=p_source_menu_id and user_id=p_user_id and version=p_source_menu_version for share;
  if v_menu.id is null then raise exception using errcode='P0002',message='source_menu_version_conflict'; end if;
  perform private.lock_and_check_shopping_safety(p_user_id,p_source_menu_id,p_safety_fingerprint);
  insert into public.shopping_list_sources(user_id,list_id,menu_id,source_menu_id_snapshot,
    source_menu_version,source_derivation_group_id)
  values(p_user_id,p_list_id,v_menu.id,v_menu.id,v_menu.version,v_menu.derivation_group_id)
  on conflict(list_id,source_menu_id_snapshot,source_menu_version) do nothing
  returning id into v_source_id;
  if v_source_id is null then
    raise exception using errcode='23505',message='menu_version_already_in_list';
  end if;
  delete from public.shopping_current_label_warnings
    where user_id=p_user_id and list_id=p_list_id;
  for v_id in select (value #>> '{}')::uuid from jsonb_array_elements(p_resolved_diff->'removeIds') loop
    if exists(select 1 from public.shopping_items where id=v_id and user_id=p_user_id
      and (is_checked or is_manual or is_manually_edited or is_removed_by_user)) then
      raise exception using errcode='P0001',message='protected_item_conflict';
    end if;
    delete from public.shopping_items where id=v_id and user_id=p_user_id and list_id=p_list_id;
  end loop;
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'replace');
  perform private.write_shopping_items(p_user_id,p_list_id,p_resolved_diff->'add');
  delete from public.shopping_label_confirmations
    where user_id=p_user_id and list_id=p_list_id and item_id is null
      and source_derivation_group_id=v_menu.derivation_group_id;
  for v_label in select value from jsonb_array_elements(p_resolved_diff->'listLabelWarnings') loop
    insert into public.shopping_label_confirmations(user_id,list_id,item_id,
      menu_label_confirmation_id,source_confirmation_id_snapshot,source_warning_key,
      source_menu_id_snapshot,
      source_derivation_group_id,source_type,source_id_snapshot,source_path,source_display_name,
      allergen_id,allergen_display_name,anonymous_member_ref,member_display_name,
      dictionary_version,confirmation_status)
    values(p_user_id,p_list_id,null,nullif(v_label->>'confirmationId','')::uuid,
      nullif(v_label->>'confirmationId','')::uuid,v_label->>'warningKey',
      (v_label->>'sourceMenuId')::uuid,
      (v_label->>'sourceDerivationGroupId')::uuid,v_label->>'sourceType',
      (v_label->>'sourceId')::uuid,v_label->>'sourcePath',v_label->>'sourceDisplayName',
      v_label->>'allergenId',v_label->>'allergenDisplayName',v_label->>'anonymousMemberRef',
      v_label->>'memberDisplayName',v_label->>'dictionaryVersion','pending');
  end loop;
  update public.shopping_lists set version=version+1,safety_fingerprint=p_safety_fingerprint,
    updated_at=now() where id=p_list_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,'replayed',false);
  insert into private.shopping_mutations values(p_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

revoke all on function public.shopping_safety_fingerprint(uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
create or replace function public.get_shopping_mutation_replay(
  p_user_id uuid,p_idempotency_key uuid,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_saved private.shopping_mutations;
begin
  perform private.cleanup_expired_shopping_mutations(p_user_id,100);
  delete from private.shopping_mutations where user_id=p_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  select * into v_saved from private.shopping_mutations
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if not found then return null; end if;
  if v_saved.request_hash<>p_request_hash then
    raise exception using errcode='22023',message='idempotency_payload_mismatch';
  end if;
  return v_saved.response||jsonb_build_object('replayed',true);
end;
$function$;

create or replace function public.mutate_shopping_item(
  p_list_id uuid,p_expected_list_version integer,p_expected_safety_fingerprint text,
  p_operation text,p_item_id uuid,
  p_idempotency_key uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $function$
declare v_user_id uuid:=(select auth.uid());v_saved private.shopping_mutations;
  v_list public.shopping_lists;v_item public.shopping_items;v_item_id uuid;v_response jsonb;v_hash text;
begin
  if v_user_id is null then raise exception using errcode='42501',message='auth_required'; end if;
  perform private.cleanup_expired_shopping_mutations(v_user_id,100);
  delete from private.shopping_mutations where user_id=v_user_id
    and idempotency_key=p_idempotency_key and created_at<now()-interval '30 days';
  if jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='invalid_item_mutation';
  end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('listId',p_list_id,
    'expectedListVersion',p_expected_list_version,
    'expectedSafetyFingerprint',p_expected_safety_fingerprint,'operation',p_operation,
    'itemId',p_item_id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
  select * into v_saved from private.shopping_mutations
    where user_id=v_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_saved.request_hash<>v_hash then
      raise exception using errcode='22023',message='idempotency_payload_mismatch';
    end if;
    return v_saved.response||jsonb_build_object('replayed',true);
  end if;
  perform private.lock_and_check_shopping_list_safety(
    v_user_id,p_list_id,p_expected_safety_fingerprint
  );
  select * into v_list from public.shopping_lists
    where id=p_list_id and user_id=v_user_id and status='active' for update;
  if v_list.id is null or v_list.version<>p_expected_list_version then
    raise exception using errcode='P0001',message='list_version_conflict';
  end if;
  if p_operation='add_manual' then
    if p_item_id is not null or not (p_payload ?& array[
      'displayName','normalizedName','storeSection','quantityText','pantryCheckRequired']) then
      raise exception using errcode='22023',message='invalid_item_mutation';
    end if;
    insert into public.shopping_items(user_id,list_id,display_name,normalized_name,store_section,
      quantity_value,quantity_text,unit,pantry_check_required,is_manual)
    values(v_user_id,p_list_id,p_payload->>'displayName',p_payload->>'normalizedName',
      p_payload->>'storeSection',nullif(p_payload->>'quantityValue','')::numeric,
      p_payload->>'quantityText',nullif(p_payload->>'unit',''),
      (p_payload->>'pantryCheckRequired')::boolean,true) returning id into v_item_id;
  else
    select * into v_item from public.shopping_items
      where id=p_item_id and list_id=p_list_id and user_id=v_user_id for update;
    if v_item.id is null then raise exception using errcode='P0002',message='shopping_item_not_found'; end if;
    v_item_id:=v_item.id;
    case p_operation
      when 'set_checked' then
        update public.shopping_items set is_checked=(p_payload->>'isChecked')::boolean,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      when 'edit' then
        update public.shopping_items set display_name=p_payload->>'displayName',
          normalized_name=p_payload->>'normalizedName',store_section=p_payload->>'storeSection',
          quantity_value=nullif(p_payload->>'quantityValue','')::numeric,
          quantity_text=p_payload->>'quantityText',unit=nullif(p_payload->>'unit',''),
          is_manually_edited=true,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      when 'remove' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'mark_at_home' then
        if v_item.is_manual then
          delete from public.shopping_items where id=v_item.id and user_id=v_user_id;
        else
          update public.shopping_items set is_removed_by_user=true,is_manually_edited=true,
            updated_at=now() where id=v_item.id and user_id=v_user_id;
        end if;
      when 'undo' then
        if v_item.is_manual or not v_item.is_removed_by_user then
          raise exception using errcode='22023',message='invalid_item_mutation';
        end if;
        update public.shopping_items set is_removed_by_user=false,updated_at=now()
          where id=v_item.id and user_id=v_user_id;
      else raise exception using errcode='22023',message='invalid_item_mutation';
    end case;
  end if;
  update public.shopping_lists set version=version+1,updated_at=now()
    where id=p_list_id and user_id=v_user_id returning * into v_list;
  v_response:=jsonb_build_object('listId',v_list.id,'version',v_list.version,
    'itemId',v_item_id,'replayed',false);
  insert into private.shopping_mutations values(v_user_id,p_idempotency_key,v_hash,v_response,now());
  return v_response;
end;
$function$;

revoke all on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.get_shopping_mutation_replay(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.shopping_safety_fingerprint(uuid,uuid) to service_role;
revoke all on function public.shopping_list_safety_fingerprint(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.shopping_list_safety_fingerprint(uuid,uuid) to service_role;
revoke all on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.refresh_shopping_list_safety(uuid,uuid,text,jsonb)
  to service_role;
grant execute on function public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.get_shopping_mutation_replay(uuid,uuid,text) to service_role;
grant execute on function public.mutate_shopping_item(uuid,integer,text,text,uuid,uuid,jsonb)
  to authenticated;
revoke all on function private.lock_and_check_shopping_safety(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function private.lock_and_check_shopping_list_safety(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function private.write_shopping_items(uuid,uuid,jsonb)
  from public,anon,authenticated;
revoke all on function private.cleanup_expired_shopping_mutations(uuid,integer)
  from public,anon,authenticated;
