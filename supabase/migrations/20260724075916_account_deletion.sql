-- Plan 6 Task 1: すべての public/private.user_id が auth.users(id) への
-- 単一列 ON DELETE CASCADE を持つことを保証する前方修正。
-- 競合する Auth FK（非 cascade / 複合）を落とし、不足している cascade を追加し、
-- デプロイ時ガードで不変条件を再検査する。
-- 既存の Plans 1–5 / Plan 7 マイグレーションは編集しない。

do $correction$
declare target record; existing_fk record; constraint_name text;
begin
  for target in
    select n.nspname as schema_name,c.relname as table_name,c.oid as table_oid,
      a.attnum,auth_id.attnum as auth_id_attnum
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id'
      and a.attnum>0 and not a.attisdropped
    join pg_attribute auth_id on auth_id.attrelid='auth.users'::regclass
      and auth_id.attname='id' and auth_id.attnum>0 and not auth_id.attisdropped
    where n.nspname in('public','private') and c.relkind in('r','p')
  loop
    -- user_id を含む競合 Auth FK をすべて除去する。非 cascade や複合参照が
    -- 共存すると「正確な単一列 cascade」不変条件が満たされたように見えてしまう。
    -- アプリ関係への owner 複合 FK はテナントグラフを独立に守るため保持する。
    for existing_fk in select conname from pg_constraint where contype='f'
      and conrelid=target.table_oid and confrelid='auth.users'::regclass
      and target.attnum=any(conkey)
      and not (confdeltype='c'
        and conkey=array[target.attnum]::smallint[]
        and confkey=array[target.auth_id_attnum]::smallint[])
    loop
      execute format('alter table %I.%I drop constraint %I',target.schema_name,
        target.table_name,existing_fk.conname);
    end loop;
    if not exists(select 1 from pg_constraint fk where fk.contype='f'
      and fk.conrelid=target.table_oid and fk.confrelid='auth.users'::regclass
      and fk.confdeltype='c'
      and fk.conkey=array[target.attnum]::smallint[]
      and fk.confkey=array[target.auth_id_attnum]::smallint[])
    then
      constraint_name:=left(target.table_name||'_user_id_auth_users_cascade_fkey',63);
      execute format('alter table %I.%I add constraint %I foreign key (user_id) '
        'references auth.users(id) on delete cascade',target.schema_name,target.table_name,constraint_name);
    end if;
  end loop;
end;
$correction$;

do $$
declare
  expected_tables constant text[] := array[
    'profiles','household_members','member_allergies','member_dislikes','privacy_consents',
    'pantry_items','generation_drafts','menus','menu_target_members',
    'generation_pantry_selections','dishes','dish_ingredients','recipe_steps',
    'menu_timeline_steps','menu_member_adaptations','menu_safety_actions','menu_label_confirmations',
    'menu_revalidations','shopping_lists','shopping_list_sources','shopping_items',
    'shopping_item_sources','shopping_label_confirmations','shopping_current_label_warnings'
  ];
  missing_user_id text[];
  offenders text[];
begin
  select coalesce(array_agg(expected_table order by expected_table), '{}')
    into missing_user_id
  from unnest(expected_tables) as expected_table
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = expected_table
      and column_name = 'user_id'
  );
  if cardinality(missing_user_id) > 0 then
    raise exception 'account deletion requires user_id columns: %', array_to_string(missing_user_id, ', ');
  end if;

  select coalesce(array_agg(format('%I.%I', n.nspname, c.relname) order by n.nspname, c.relname), '{}')
    into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = 'user_id'
   and a.attnum > 0
   and not a.attisdropped
  join pg_attribute auth_id
    on auth_id.attrelid = 'auth.users'::regclass
   and auth_id.attname = 'id'
   and auth_id.attnum > 0
   and not auth_id.attisdropped
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p')
    and (not exists (
      select 1
      from pg_constraint fk
      where fk.contype = 'f'
        and fk.conrelid = c.oid
        and fk.confrelid = 'auth.users'::regclass
        and fk.confdeltype = 'c'
        and fk.conkey = array[a.attnum]::smallint[]
        and fk.confkey = array[auth_id.attnum]::smallint[]
    ) or exists (
      select 1
      from pg_constraint competing
      where competing.contype = 'f'
        and competing.conrelid = c.oid
        and competing.confrelid = 'auth.users'::regclass
        and a.attnum = any(competing.conkey)
        and not (competing.confdeltype = 'c'
          and competing.conkey = array[a.attnum]::smallint[]
          and competing.confkey = array[auth_id.attnum]::smallint[])
    ));

  if cardinality(offenders) > 0 then
    raise exception 'account deletion requires exact non-competing user_id Auth FKs: %', array_to_string(offenders, ', ');
  end if;
end;
$$;
