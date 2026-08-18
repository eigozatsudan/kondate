\ir 000_helpers.sql
-- =============================================================================
-- AP2: publish_shared_emergency_recipe の同意判定と revoke の交差。
--
-- このファイルは begin/rollback 規約から外れ、明示 commit する。
-- 理由は shopping_lists_races.test.sql と同じ: dblink 別バックエンドは
-- 未 commit の fixture を見られない。
--
-- シナリオ: 本セッションが user 日次台帳を FOR UPDATE で掴んだまま、
-- 別セッションの publish を usage ロック待ちまで進める。その窓で revoke を
-- COMMIT し、台帳ロックを解放する。撤回後に pool INSERT してはならない。
-- =============================================================================
select plan(1);

delete from private.shared_emergency_recipe_origins
where contributor_user_id = 'a1000000-0000-4000-8000-0000000000f2';
delete from private.shared_emergency_recipes
where menu_payload ->> 'menuId' = 'c1000000-0000-4000-8000-0000000000f2';
delete from private.share_generalization_jobs
where source_menu_id = 'b1000000-0000-4000-8000-0000000000f2';
delete from public.menus
where id = 'b1000000-0000-4000-8000-0000000000f2';
delete from auth.users
where id = 'a1000000-0000-4000-8000-0000000000f2';

do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'share_pgtap_dblink_test') then
    create role share_pgtap_dblink_test with login password 'share_pgtap_dblink_test_only'
      nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end;
$block$;
revoke all on schema public from share_pgtap_dblink_test;
grant usage on schema public to share_pgtap_dblink_test;
grant execute on function public.publish_shared_emergency_recipe(
  uuid, jsonb, text, integer, text[], text[], integer, text, text
) to share_pgtap_dblink_test;

select tests.create_supabase_user(
  'a1000000-0000-4000-8000-0000000000f2'::uuid,
  'share-ap2-race@example.invalid'
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b1000000-0000-4000-8000-0000000000f2',
  'a1000000-0000-4000-8000-0000000000f2',
  'dinner', 'japanese', 2, 15,
  '{}', '{}', repeat('8', 64), 'household',
  'allergens-v1', 'food-v1', 'menu-v1',
  'b1000000-0000-4000-8000-0000000000c8', 1
);

insert into public.user_share_consents (
  user_id, consent_version, accepted_at, revoked_at, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-0000000000f2',
  '2026-08-01.v1',
  clock_timestamp(),
  null,
  clock_timestamp(),
  clock_timestamp()
);

insert into private.share_user_daily_usage (
  contributor_user_id, usage_day, attempt_count, success_count, updated_at
) values (
  'a1000000-0000-4000-8000-0000000000f2',
  private.ai_jst_day(clock_timestamp()),
  0,
  0,
  clock_timestamp()
);

insert into private.share_generalization_jobs (
  id,
  source_menu_id,
  contributor_user_id,
  status,
  claimed_at,
  heartbeat_at,
  created_at
) values (
  'd1000000-0000-4000-8000-0000000000f2',
  'b1000000-0000-4000-8000-0000000000f2',
  'a1000000-0000-4000-8000-0000000000f2',
  'running',
  clock_timestamp(),
  clock_timestamp(),
  clock_timestamp()
);

do $test$
declare
  v_user constant uuid := 'a1000000-0000-4000-8000-0000000000f2';
  v_job constant uuid := 'd1000000-0000-4000-8000-0000000000f2';
  v_menu_id constant text := 'c1000000-0000-4000-8000-0000000000f2';
  v_connstr constant text :=
    'host=db port=5432 dbname=postgres user=share_pgtap_dblink_test '
    || 'password=share_pgtap_dblink_test_only';
  v_pub jsonb;
  v_wait_event text;
  v_attempt integer;
  v_drained integer;
  v_pool integer;
begin
  -- EXCEPTION 節を置かない（サブトランザクション中は COMMIT できない）
  -- 本 TX で user 日次台帳を掴み、publish を cap 判定直前で止める
  perform 1
  from private.share_user_daily_usage
  where contributor_user_id = v_user
    and usage_day = private.ai_jst_day(clock_timestamp())
  for update;

  perform extensions.dblink_connect('share_ap2_pub', v_connstr);
  perform extensions.dblink_send_query(
    'share_ap2_pub',
    format(
      $sql$
        select public.publish_shared_emergency_recipe(
          %L::uuid,
          %L::jsonb,
          'dinner',
          15,
          array[]::text[],
          array['adult']::text[],
          0,
          null,
          null
        )
      $sql$,
      v_job,
      jsonb_build_object(
        'menuId', v_menu_id,
        'dishes', jsonb_build_array(
          jsonb_build_object('role', 'main', 'name', 'AP2交差大根煮', 'position', 1)
        )
      )::text
    )
  );

  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    select wait_event into v_wait_event
    from pg_stat_activity
    where wait_event_type = 'Lock'
      and query ilike '%publish_shared_emergency_recipe%'
      and query ilike '%' || v_job::text || '%'
    limit 1;
    exit when v_wait_event is not null;
  end loop;

  if v_wait_event is null then
    raise exception
      'AP2 race: publish did not block on the user daily usage lock';
  end if;

  -- usage 待ちの窓で revoke を確定させる（upsert と同じ行 UPDATE）
  update public.user_share_consents
  set revoked_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = v_user
    and revoked_at is null;
  if not found then
    raise exception 'AP2 race: consent row was not open for revoke';
  end if;

  commit;

  for v_attempt in 1..40 loop
    perform pg_sleep(0.05);
    exit when extensions.dblink_is_busy('share_ap2_pub') = 0;
  end loop;

  select result into v_pub
  from extensions.dblink_get_result('share_ap2_pub') as t(result jsonb);

  loop
    select count(*) into v_drained
    from extensions.dblink_get_result('share_ap2_pub') as t(result jsonb);
    exit when v_drained = 0;
  end loop;

  perform extensions.dblink_disconnect('share_ap2_pub');

  if coalesce((v_pub ->> 'published')::boolean, true) is not false then
    raise exception
      'AP2 race: intersecting revoke must not publish: %', v_pub;
  end if;
  if v_pub ->> 'reason' is distinct from 'consent_revoked' then
    raise exception
      'AP2 race: expected consent_revoked, got %', v_pub;
  end if;

  select count(*)::integer into v_pool
  from private.shared_emergency_recipes
  where menu_payload ->> 'menuId' = v_menu_id;
  if v_pool is distinct from 0 then
    raise exception 'AP2 race: pool row inserted after revoke, count=%', v_pool;
  end if;

  if not exists (
    select 1
    from private.share_generalization_jobs
    where id = v_job
      and status = 'skipped'
      and skip_reason = 'consent_revoked'
  ) then
    raise exception 'AP2 race: job should be skipped with consent_revoked';
  end if;
end;
$test$;

select ok(
  exists (
    select 1
    from private.share_generalization_jobs
    where id = 'd1000000-0000-4000-8000-0000000000f2'
      and status = 'skipped'
      and skip_reason = 'consent_revoked'
  )
  and not exists (
    select 1
    from private.shared_emergency_recipes
    where menu_payload ->> 'menuId' = 'c1000000-0000-4000-8000-0000000000f2'
  ),
  'AP2: revoke committed during publish usage wait does not insert pool'
);

delete from private.shared_emergency_recipe_origins
where contributor_user_id = 'a1000000-0000-4000-8000-0000000000f2';
delete from private.shared_emergency_recipes
where menu_payload ->> 'menuId' = 'c1000000-0000-4000-8000-0000000000f2';
delete from private.share_generalization_jobs
where source_menu_id = 'b1000000-0000-4000-8000-0000000000f2';
delete from private.share_user_daily_usage
where contributor_user_id = 'a1000000-0000-4000-8000-0000000000f2';
delete from public.menus
where id = 'b1000000-0000-4000-8000-0000000000f2';
delete from auth.users
where id = 'a1000000-0000-4000-8000-0000000000f2';

select * from finish();
