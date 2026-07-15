create table public.menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  cuisine_genre text not null check (cuisine_genre in ('japanese', 'western', 'chinese', 'any')),
  servings smallint not null check (servings between 1 and 20),
  total_elapsed_minutes smallint not null check (total_elapsed_minutes between 1 and 180),
  preference_snapshot jsonb not null,
  safety_snapshot jsonb not null,
  safety_fingerprint text not null check (safety_fingerprint ~ '^[a-f0-9]{64}$'),
  allergen_dictionary_version text not null,
  food_safety_rule_version text not null,
  output_schema_version text not null,
  derivation_group_id uuid not null,
  parent_menu_id uuid,
  change_reason text check (change_reason in ('simpler','different_ingredient','child_friendly','different_flavor','custom')),
  change_reason_custom text check (
    change_reason_custom is null or (
      change_reason_custom = btrim(
        change_reason_custom,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      )
      and char_length(change_reason_custom) between 1 and 200
    )
  ),
  is_selected boolean not null default false,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    (parent_menu_id is null and change_reason is null and change_reason_custom is null)
    or (
      parent_menu_id is not null and change_reason is not null
      and ((change_reason = 'custom') = (change_reason_custom is not null))
    )
  )
);

create index menus_owner_created_idx on public.menus (user_id, created_at desc);
create index menus_owner_derivation_idx on public.menus (user_id, derivation_group_id);
create unique index menus_one_selected_per_group_idx
  on public.menus (user_id, derivation_group_id) where is_selected;

create table public.menu_target_members (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_member_id uuid,
  household_member_user_id uuid,
  anonymous_ref text not null check (anonymous_ref ~ '^member_[1-9][0-9]*$'),
  member_display_name_snapshot text not null check (char_length(btrim(member_display_name_snapshot)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (menu_id, household_member_id),
  unique (menu_id, anonymous_ref),
  check ((household_member_id is null) = (household_member_user_id is null)),
  check (household_member_user_id is null or household_member_user_id = user_id)
);

create table public.generation_pantry_selections (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  pantry_item_id uuid,
  pantry_name_snapshot text not null check (char_length(btrim(pantry_name_snapshot)) between 1 and 80),
  priority text not null check (priority in ('must_use', 'prefer_use')),
  idempotency_key uuid not null,
  expired_item_checked_at timestamptz,
  expired_item_check_jst_date date,
  usage_status text not null check (usage_status in ('used', 'unused')),
  planned_quantity numeric(12,3) check (planned_quantity > 0),
  inventory_quantity_snapshot numeric(12,3) check (inventory_quantity_snapshot > 0),
  shortage_quantity numeric(12,3) check (shortage_quantity >= 0),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  unused_reason text check (char_length(btrim(unused_reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (menu_id, pantry_item_id),
  check ((expired_item_checked_at is null) = (expired_item_check_jst_date is null)),
  check (priority <> 'must_use' or usage_status = 'used'),
  check ((usage_status = 'unused' and priority = 'prefer_use') = (unused_reason is not null)),
  check (
    (planned_quantity is null or inventory_quantity_snapshot is null)
    = (shortage_quantity is null)
  ),
  check (
    shortage_quantity is null
    or shortage_quantity = greatest(planned_quantity - inventory_quantity_snapshot, 0)
  )
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('main','side','soup','staple','other')),
  position smallint not null check (position > 0),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  cooking_time_minutes smallint not null check (cooking_time_minutes between 1 and 180),
  created_at timestamptz not null default now(),
  unique (menu_id, position)
);

create table public.dish_ingredients (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  quantity_value numeric(12,3) check (quantity_value > 0),
  quantity_text text not null check (char_length(btrim(quantity_text)) between 1 and 60),
  unit text check (char_length(btrim(unit)) between 1 and 24),
  store_section text not null check (store_section in ('produce','meat_fish','dairy_eggs','dry_goods','seasonings','other')),
  pantry_selection_id uuid,
  label_confirmation_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (dish_id, position)
);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (dish_id, position)
);

create table public.menu_timeline_steps (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null check (position > 0),
  start_minute smallint not null check (start_minute >= 0),
  duration_minutes smallint not null check (duration_minutes > 0),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 500),
  dish_id uuid,
  recipe_step_id uuid,
  created_at timestamptz not null default now(),
  unique (menu_id, position),
  check (recipe_step_id is null or dish_id is not null)
);

create table public.menu_member_adaptations (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  portion_text text not null check (char_length(btrim(portion_text)) between 1 and 80),
  branch_before_recipe_step_id uuid not null,
  additional_cutting text check (char_length(btrim(additional_cutting)) between 1 and 300),
  additional_heating text check (char_length(btrim(additional_heating)) between 1 and 300),
  additional_seasoning text check (char_length(btrim(additional_seasoning)) between 1 and 300),
  serving_check text not null check (char_length(btrim(serving_check)) between 1 and 300),
  safety_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (menu_id, dish_id, anonymous_member_ref),
  unique (menu_id, dish_id, user_id, anonymous_member_ref)
);

create table public.menu_safety_actions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  dish_id uuid not null,
  ingredient_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  before_recipe_step_id uuid not null,
  position smallint not null check (position between 1 and 20),
  kind text not null check (kind in (
    'remove_bones','cut_small','quarter_round_food','soften','heat_thoroughly'
  )),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (menu_id, dish_id, anonymous_member_ref, position)
);

create table public.menu_label_confirmations (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('dish','ingredient','recipe_step','adaptation','timeline')),
  source_id uuid not null,
  source_path text not null check (char_length(source_path) between 1 and 200),
  source_text_snapshot text not null check (
    source_text_snapshot = btrim(
      source_text_snapshot,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    and char_length(source_text_snapshot) between 1 and 500
  ),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  anonymous_member_ref text not null check (anonymous_member_ref ~ '^member_[1-9][0-9]*$'),
  dictionary_version text not null,
  requirement_safety_fingerprint text not null check (
    char_length(btrim(requirement_safety_fingerprint)) between 1 and 200
  ),
  is_current boolean not null default true,
  confirmation_status text not null default 'pending' check (confirmation_status in ('pending','confirmed')),
  confirmed_at timestamptz,
  -- 確認者は同じ所有者であることをCHECKで固定する。auth.usersへの追加FKは、
  -- アカウント削除時のmenus起点CASCADEと競合させないため意図的に持たない。
  confirmed_by uuid,
  created_at timestamptz not null default now(),
  constraint menu_label_confirmations_exact_source_unique
    unique (
      menu_id, source_type, source_id, source_path, allergen_id,
      anonymous_member_ref, dictionary_version, requirement_safety_fingerprint
    ),
  check (
    (confirmation_status = 'pending' and confirmed_at is null and confirmed_by is null)
    or (
      confirmation_status = 'confirmed' and confirmed_at is not null
      and confirmed_by = user_id
    )
  )
);

create unique index menu_label_confirmations_one_current_requirement
  on public.menu_label_confirmations (
    menu_id, source_type, source_id, source_path, allergen_id, anonymous_member_ref
  ) where is_current;

-- 集約内の各親子には所有者複合FKを一つだけ持たせ、PostgRESTの関係推論を一意にする。
alter table public.menus
  add constraint menus_parent_owner_fkey
    foreign key (parent_menu_id, user_id)
    references public.menus(id, user_id) on delete cascade;

alter table public.menu_target_members
  add unique (menu_id, user_id, anonymous_ref),
  add constraint menu_target_members_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint menu_target_members_member_owner_fkey
    foreign key (household_member_id, household_member_user_id)
    references public.household_members(id, user_id)
    on delete set null (household_member_id, household_member_user_id);

alter table public.generation_pantry_selections
  add unique (id, menu_id, user_id),
  add constraint generation_pantry_selections_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint generation_pantry_selections_item_owner_fkey
    foreign key (pantry_item_id, user_id)
    references public.pantry_items(id, user_id)
    on delete set null (pantry_item_id);

alter table public.dishes
  add unique (id, menu_id, user_id),
  add constraint dishes_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade;

alter table public.dish_ingredients
  add unique (id, dish_id, menu_id, user_id),
  add constraint dish_ingredients_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint dish_ingredients_pantry_owner_fkey
    foreign key (pantry_selection_id, menu_id, user_id)
    references public.generation_pantry_selections(id, menu_id, user_id)
    on delete set null (pantry_selection_id);

alter table public.recipe_steps
  add unique (id, dish_id, menu_id, user_id),
  add constraint recipe_steps_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade;

alter table public.menu_timeline_steps
  add unique (id, dish_id, menu_id, user_id),
  add constraint menu_timeline_steps_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint menu_timeline_steps_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_timeline_steps_step_owner_fkey
    foreign key (recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade;

alter table public.menu_member_adaptations
  add constraint menu_member_adaptations_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_member_adaptations_branch_owner_fkey
    foreign key (branch_before_recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_member_adaptations_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade;

alter table public.menu_safety_actions
  add constraint menu_safety_actions_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint menu_safety_actions_dish_owner_fkey
    foreign key (dish_id, menu_id, user_id)
    references public.dishes(id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_ingredient_owner_fkey
    foreign key (ingredient_id, dish_id, menu_id, user_id)
    references public.dish_ingredients(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade,
  add constraint menu_safety_actions_step_owner_fkey
    foreign key (before_recipe_step_id, dish_id, menu_id, user_id)
    references public.recipe_steps(id, dish_id, menu_id, user_id) on delete cascade,
  add constraint menu_safety_actions_adaptation_owner_fkey
    foreign key (menu_id, dish_id, user_id, anonymous_member_ref)
    references public.menu_member_adaptations(menu_id, dish_id, user_id, anonymous_member_ref)
    on delete cascade;

alter table public.menu_label_confirmations
  add constraint menu_label_confirmations_menu_owner_fkey
    foreign key (menu_id, user_id)
    references public.menus(id, user_id) on delete cascade,
  add constraint menu_label_confirmations_member_owner_fkey
    foreign key (menu_id, user_id, anonymous_member_ref)
    references public.menu_target_members(menu_id, user_id, anonymous_ref) on delete cascade;

create or replace function private.assert_menu_label_source_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_exists boolean;
begin
  case new.source_type
    when 'dish' then
      select exists(
        select 1 from public.dishes
        where id = new.source_id and menu_id = new.menu_id and user_id = new.user_id
      ) into v_exists;
    when 'ingredient' then
      select exists(
        select 1 from public.dish_ingredients
        where id = new.source_id and menu_id = new.menu_id and user_id = new.user_id
      ) into v_exists;
    when 'recipe_step' then
      select exists(
        select 1 from public.recipe_steps
        where id = new.source_id and menu_id = new.menu_id and user_id = new.user_id
      ) into v_exists;
    when 'adaptation' then
      select exists(
        select 1 from public.menu_member_adaptations
        where id = new.source_id and menu_id = new.menu_id and user_id = new.user_id
      ) into v_exists;
    when 'timeline' then
      select exists(
        select 1 from public.menu_timeline_steps
        where id = new.source_id and menu_id = new.menu_id and user_id = new.user_id
      ) into v_exists;
  end case;

  if not coalesce(v_exists, false) then
    raise exception using errcode = '23503', message = 'menu_label_source_owner_mismatch';
  end if;
  return new;
end;
$function$;

revoke all on function private.assert_menu_label_source_owner()
  from public, anon, authenticated, service_role;

create trigger menu_label_confirmations_source_owner
before insert or update of menu_id, user_id, source_type, source_id
on public.menu_label_confirmations
for each row execute function private.assert_menu_label_source_owner();

do $$
declare
  owned_table text;
begin
  foreach owned_table in array array[
    'menus', 'menu_target_members', 'generation_pantry_selections', 'dishes',
    'dish_ingredients', 'recipe_steps', 'menu_timeline_steps',
    'menu_member_adaptations', 'menu_safety_actions', 'menu_label_confirmations'
  ]
  loop
    execute format('alter table public.%I enable row level security', owned_table);
    execute format('revoke all on public.%I from anon, authenticated', owned_table);
    execute format('grant select on public.%I to authenticated', owned_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      owned_table || '_owner_select', owned_table
    );
  end loop;
end;
$$;

grant update (is_favorite) on public.menus to authenticated;
create policy menus_owner_update_favorite on public.menus
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
