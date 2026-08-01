-- Task 3: 共有プール schema / public definer RPC / 削除 / reaper
\ir 000_helpers.sql
begin;
select plan(27);

create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-0000000000a1'::uuid,
  'share-owner@example.invalid'
);
select tests.create_supabase_user(
  'a1000000-0000-4000-8000-0000000000a2'::uuid,
  'share-other@example.invalid'
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b1000000-0000-4000-8000-0000000000b1',
  'a1000000-0000-4000-8000-0000000000a1',
  'dinner', 'japanese', 2, 15,
  '{}', '{}', repeat('a', 64), 'household',
  'allergens-v1', 'food-v1', 'menu-v1',
  'b1000000-0000-4000-8000-0000000000c1', 1
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b1000000-0000-4000-8000-0000000000b2',
  'a1000000-0000-4000-8000-0000000000a1',
  'lunch', 'japanese', 2, 10,
  '{}', '{}', repeat('b', 64), 'household',
  'allergens-v1', 'food-v1', 'menu-v1',
  'b1000000-0000-4000-8000-0000000000c2', 1
);

insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b1000000-0000-4000-8000-0000000000b3',
  'a1000000-0000-4000-8000-0000000000a1',
  'breakfast', 'japanese', 1, 12,
  '{}', '{}', repeat('c', 64), 'household',
  'allergens-v1', 'food-v1', 'menu-v1',
  'b1000000-0000-4000-8000-0000000000c3', 1
);

-- ---------------------------------------------------------------------------
-- Schema presence
-- ---------------------------------------------------------------------------
select has_table('public', 'user_share_consents', 'user_share_consents exists');
select has_table('private', 'share_generalization_jobs', 'share_generalization_jobs exists');
select has_table('private', 'shared_emergency_recipes', 'shared_emergency_recipes exists');
select has_table('private', 'shared_emergency_recipe_origins', 'shared_emergency_recipe_origins exists');
select has_table('private', 'share_user_daily_usage', 'share_user_daily_usage exists');
select has_table('private', 'share_app_daily_usage', 'share_app_daily_usage exists');

-- private 表に service_role TABLE GRANT が無い
select ok(
  not has_table_privilege('service_role', 'private.share_generalization_jobs', 'select')
  and not has_table_privilege('service_role', 'private.shared_emergency_recipes', 'select')
  and not has_table_privilege('service_role', 'private.shared_emergency_recipe_origins', 'select')
  and not has_table_privilege('service_role', 'private.share_user_daily_usage', 'select')
  and not has_table_privilege('service_role', 'private.share_app_daily_usage', 'select'),
  'service_role has no direct table grants on share private tables'
);

-- jobs / origins / pool に列名 user_id が 0 本
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'share_generalization_jobs',
        'shared_emergency_recipes',
        'shared_emergency_recipe_origins'
      )
      and column_name = 'user_id'
  ),
  0,
  'jobs/origins/pool have zero columns named user_id'
);

-- authenticated が pool/jobs/origins を SELECT できない
select ok(
  not has_table_privilege('authenticated', 'private.share_generalization_jobs', 'select')
  and not has_table_privilege('authenticated', 'private.shared_emergency_recipes', 'select')
  and not has_table_privilege('authenticated', 'private.shared_emergency_recipe_origins', 'select'),
  'authenticated cannot SELECT pool/jobs/origins'
);

-- RPC grants
select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_my_share_consent(text,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.get_my_share_consent()',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_my_shared_emergency_recipes()',
    'execute'
  ),
  'authenticated can execute consent/list_my RPCs'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.try_enqueue_share_job(uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_share_generalization_jobs(integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.publish_shared_emergency_recipe(uuid,jsonb,text,integer,text[],text[],integer,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.reap_stale_share_jobs(timestamptz,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.try_enqueue_share_job(uuid)',
    'execute'
  ),
  'service_role-only RPCs are locked to service_role'
);

-- ---------------------------------------------------------------------------
-- Consent + enqueue / revoke
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    select tests.authenticate_as('a1000000-0000-4000-8000-0000000000a1'::uuid);
    select set_config('role', 'authenticated', true);
    select public.upsert_my_share_consent('2026-08-01.v1', true);
    select set_config('role', 'postgres', true);
    select tests.clear_authentication();
  $$,
  'owner can accept share consent'
);

-- 抽選を当てる: setseed(0.0005) の次の random()*100 < 20
select ok(
  (
    select setseed(0.0005)::text is not null
  ),
  'setseed for deterministic lottery win'
);

select is(
  (public.try_enqueue_share_job('b1000000-0000-4000-8000-0000000000b1'::uuid) ->> 'enqueued')::boolean,
  true,
  'try_enqueue wins lottery and creates pending job'
);

select is(
  (
    select count(*)::integer
    from private.share_generalization_jobs
    where source_menu_id = 'b1000000-0000-4000-8000-0000000000b1'
      and status = 'pending'
  ),
  1,
  'exactly one pending job for source menu'
);

select is(
  (
    select attempt_count
    from private.share_user_daily_usage
    where contributor_user_id = 'a1000000-0000-4000-8000-0000000000a1'
      and usage_day = private.ai_jst_day(clock_timestamp())
  ),
  1,
  'attempt ledger increments only after job insert'
);

-- revoke 後は enqueue しない
select lives_ok(
  $$
    select tests.authenticate_as('a1000000-0000-4000-8000-0000000000a1'::uuid);
    select set_config('role', 'authenticated', true);
    select public.upsert_my_share_consent('2026-08-01.v1', false);
    select set_config('role', 'postgres', true);
    select tests.clear_authentication();
  $$,
  'owner can revoke share consent'
);

select is(
  public.try_enqueue_share_job('b1000000-0000-4000-8000-0000000000b2'::uuid) ->> 'reason',
  'no_consent',
  'try_enqueue after revoke does not create job'
);

select is(
  (
    select count(*)::integer
    from private.share_generalization_jobs
    where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
  ),
  0,
  'no job row after revoke enqueue attempt'
);

-- 再同意して m2 / m3 を投入（unique / reaper 用）
select lives_ok(
  $$
    select tests.authenticate_as('a1000000-0000-4000-8000-0000000000a1'::uuid);
    select set_config('role', 'authenticated', true);
    select public.upsert_my_share_consent('2026-08-01.v1', true);
    select set_config('role', 'postgres', true);
    select tests.clear_authentication();
  $$,
  'owner re-accepts share consent'
);

-- m2 は attempt 枠が残っている（attempt=1, cap=2）。lottery を再度 seed
select ok(setseed(0.0005)::text is not null, 'reset seed for second enqueue');
select is(
  (public.try_enqueue_share_job('b1000000-0000-4000-8000-0000000000b2'::uuid) ->> 'enqueued')::boolean,
  true,
  'second menu enqueues after re-accept'
);

-- ---------------------------------------------------------------------------
-- publish + list_my isolation
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    do $pub$
    declare
      v_job uuid;
      v_claim jsonb;
      v_pub jsonb;
    begin
      -- m1 job を claim → publish
      select id into v_job
      from private.share_generalization_jobs
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b1'
        and status = 'pending';

      v_claim := public.claim_share_generalization_jobs(10);
      if jsonb_array_length(v_claim -> 'jobs') < 1 then
        raise exception 'claim returned no jobs';
      end if;

      select id into v_job
      from private.share_generalization_jobs
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b1'
        and status = 'running';

      v_pub := public.publish_shared_emergency_recipe(
        v_job,
        jsonb_build_object(
          'menuId', 'c1000000-0000-4000-8000-0000000000d1',
          'dishes', jsonb_build_array(
            jsonb_build_object('role', 'main', 'name', '肉じゃが', 'position', 1)
          )
        ),
        'dinner',
        15,
        array['egg']::text[],
        array['adult']::text[],
        2,
        'mock/pass1',
        'mock/pass2'
      );
      if coalesce((v_pub ->> 'published')::boolean, false) is not true then
        raise exception 'publish failed: %', v_pub;
      end if;
    end;
    $pub$;
  $$,
  'publish inserts pool+origin and marks job succeeded'
);

select is(
  (
    select count(*)::integer from private.shared_emergency_recipes where status = 'active'
  ),
  1,
  'one active pool recipe after publish'
);

-- list_my as other user → 0 rows
select lives_ok(
  $$
    do $list$
    declare
      v_rows jsonb;
    begin
      perform tests.authenticate_as('a1000000-0000-4000-8000-0000000000a2'::uuid);
      v_rows := public.list_my_shared_emergency_recipes();
      if jsonb_array_length(v_rows) is distinct from 0 then
        raise exception 'other user should see 0 rows, got %', v_rows;
      end if;
      perform tests.clear_authentication();

      perform tests.authenticate_as('a1000000-0000-4000-8000-0000000000a1'::uuid);
      v_rows := public.list_my_shared_emergency_recipes();
      if jsonb_array_length(v_rows) is distinct from 1 then
        raise exception 'owner should see 1 row, got %', v_rows;
      end if;
      if v_rows -> 0 ->> 'title' is distinct from '肉じゃが' then
        raise exception 'unexpected title: %', v_rows;
      end if;
      if v_rows -> 0 ? 'recipe_id' or v_rows -> 0 ? 'source_menu_id' then
        raise exception 'list_my must not expose ids: %', v_rows;
      end if;
      perform tests.clear_authentication();
    end;
    $list$;
  $$,
  'list_my isolates by auth.uid and returns title+date only'
);

-- ---------------------------------------------------------------------------
-- reaper: running + old heartbeat → failed lease_expired / unique blocks re-enqueue
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    do $reap$
    declare
      v_job uuid;
      v_claim jsonb;
      v_reaped integer;
      v_enq jsonb;
    begin
      select id into v_job
      from private.share_generalization_jobs
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
        and status = 'pending';

      v_claim := public.claim_share_generalization_jobs(10);

      update private.share_generalization_jobs
      set claimed_at = clock_timestamp() - interval '20 minutes',
          heartbeat_at = clock_timestamp() - interval '20 minutes'
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
        and status = 'running';

      v_reaped := public.reap_stale_share_jobs(clock_timestamp(), 100);
      if v_reaped < 1 then
        raise exception 'reaper reaped 0 jobs';
      end if;

      if not exists (
        select 1 from private.share_generalization_jobs
        where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
          and status = 'failed'
          and failure_code = 'lease_expired'
      ) then
        raise exception 'job not marked lease_expired';
      end if;

      -- 日次 cap を空けて unique(source_menu_id) だけを検証する
      update private.share_user_daily_usage
      set attempt_count = 0, success_count = 0
      where contributor_user_id = 'a1000000-0000-4000-8000-0000000000a1';
      update private.share_app_daily_usage
      set success_count = 0, ai_call_count = 0
      where usage_day = private.ai_jst_day(clock_timestamp());

      perform setseed(0.0005);
      v_enq := public.try_enqueue_share_job('b1000000-0000-4000-8000-0000000000b2'::uuid);
      if coalesce((v_enq ->> 'enqueued')::boolean, true) then
        raise exception 're-enqueue after terminal should fail, got %', v_enq;
      end if;
      if v_enq ->> 'reason' is distinct from 'duplicate' then
        raise exception 'expected duplicate after terminal job, got %', v_enq;
      end if;
    end;
    $reap$;
  $$,
  'reap_stale_share_jobs marks lease_expired and blocks re-enqueue'
);

-- ---------------------------------------------------------------------------
-- auth.users 削除: consent 消滅、pool 不変、origins.contributor_user_id IS NULL
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    do $del$
    declare
      v_pool_before integer;
      v_pool_after integer;
    begin
      select count(*)::integer into v_pool_before from private.shared_emergency_recipes;

      delete from auth.users where id = 'a1000000-0000-4000-8000-0000000000a1';

      if exists (
        select 1 from public.user_share_consents
        where user_id = 'a1000000-0000-4000-8000-0000000000a1'
      ) then
        raise exception 'consent should cascade-delete';
      end if;

      select count(*)::integer into v_pool_after from private.shared_emergency_recipes;
      if v_pool_after is distinct from v_pool_before then
        raise exception 'pool row count changed on auth delete: % -> %', v_pool_before, v_pool_after;
      end if;

      if exists (
        select 1 from private.shared_emergency_recipe_origins
        where contributor_user_id = 'a1000000-0000-4000-8000-0000000000a1'
      ) then
        raise exception 'origins.contributor_user_id should be SET NULL';
      end if;

      if not exists (
        select 1 from private.shared_emergency_recipe_origins
        where contributor_user_id is null
      ) then
        raise exception 'expected unlinked origin rows after delete';
      end if;
    end;
    $del$;
  $$,
  'auth delete cascades consent, unlinks origins, keeps pool body'
);

select * from finish();
rollback;
