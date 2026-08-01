-- Task 3: 共有プール schema / public definer RPC / 削除 / reaper / success cap
\ir 000_helpers.sql
begin;
select plan(33);

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

-- reaper 用（user success-cap / app success-cap で b2·b3 を消費するため別枠）
insert into public.menus (
  id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
  preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
  allergen_dictionary_version, food_safety_rule_version, output_schema_version,
  derivation_group_id, version
) values (
  'b1000000-0000-4000-8000-0000000000b4',
  'a1000000-0000-4000-8000-0000000000a1',
  'dinner', 'japanese', 2, 14,
  '{}', '{}', repeat('d', 64), 'household',
  'allergens-v1', 'food-v1', 'menu-v1',
  'b1000000-0000-4000-8000-0000000000c4', 1
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

-- 同一ユーザー同一日の 2 本目 publish: pool は増えない（attempt cap=2 > success cap=1）
select lives_ok(
  $$
    do $cap_user$
    declare
      v_job uuid;
      v_pub jsonb;
      v_pool integer;
    begin
      select id into v_job
      from private.share_generalization_jobs
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
        and status = 'pending';

      perform public.claim_share_generalization_jobs(10);

      select id into v_job
      from private.share_generalization_jobs
      where source_menu_id = 'b1000000-0000-4000-8000-0000000000b2'
        and status = 'running';

      if v_job is null then
        raise exception 'expected running job for b2 after claim';
      end if;

      v_pub := public.publish_shared_emergency_recipe(
        v_job,
        jsonb_build_object(
          'menuId', 'c1000000-0000-4000-8000-0000000000d2',
          'dishes', jsonb_build_array(
            jsonb_build_object('role', 'main', 'name', 'カレー', 'position', 1)
          )
        ),
        'lunch',
        10,
        array[]::text[],
        array['adult']::text[],
        1,
        'mock/pass1',
        null
      );

      if coalesce((v_pub ->> 'published')::boolean, true) is not false then
        raise exception 'second publish should not insert pool: %', v_pub;
      end if;
      if v_pub ->> 'reason' is distinct from 'daily_success_cap' then
        raise exception 'expected daily_success_cap, got %', v_pub;
      end if;

      select count(*)::integer into v_pool
      from private.shared_emergency_recipes where status = 'active';
      if v_pool is distinct from 1 then
        raise exception 'pool should stay 1 after user success cap, got %', v_pool;
      end if;

      if not exists (
        select 1 from private.share_generalization_jobs
        where id = v_job
          and status = 'skipped'
          and skip_reason = 'daily_success_cap'
      ) then
        raise exception 'job should be skipped with daily_success_cap';
      end if;
    end;
    $cap_user$;
  $$,
  'second same-user/day publish skips with daily_success_cap and does not insert pool'
);

-- app ledger success=200 のとき pool INSERT しない
select lives_ok(
  $$
    do $cap_app$
    declare
      v_job uuid;
      v_pub jsonb;
      v_pool integer;
      v_day date := private.ai_jst_day(clock_timestamp());
    begin
      -- user success を空けて app 上限だけを検証（attempt は既に 2 なので job は直 insert）
      update private.share_user_daily_usage
      set success_count = 0
      where contributor_user_id = 'a1000000-0000-4000-8000-0000000000a1'
        and usage_day = v_day;

      insert into private.share_app_daily_usage (usage_day, success_count, ai_call_count, updated_at)
      values (v_day, 200, 0, clock_timestamp())
      on conflict (usage_day) do update
        set success_count = 200, updated_at = excluded.updated_at;

      insert into private.share_generalization_jobs (
        source_menu_id,
        contributor_user_id,
        status,
        claimed_at,
        heartbeat_at,
        created_at
      ) values (
        'b1000000-0000-4000-8000-0000000000b3',
        'a1000000-0000-4000-8000-0000000000a1',
        'running',
        clock_timestamp(),
        clock_timestamp(),
        clock_timestamp()
      )
      returning id into v_job;

      v_pub := public.publish_shared_emergency_recipe(
        v_job,
        jsonb_build_object(
          'menuId', 'c1000000-0000-4000-8000-0000000000d3',
          'dishes', jsonb_build_array(
            jsonb_build_object('role', 'main', 'name', '味噌汁', 'position', 1)
          )
        ),
        'breakfast',
        12,
        array[]::text[],
        array['adult']::text[],
        0,
        null,
        null
      );

      if coalesce((v_pub ->> 'published')::boolean, true) is not false then
        raise exception 'app-cap publish should not insert pool: %', v_pub;
      end if;
      if v_pub ->> 'reason' is distinct from 'daily_success_cap' then
        raise exception 'expected daily_success_cap for app cap, got %', v_pub;
      end if;

      select count(*)::integer into v_pool
      from private.shared_emergency_recipes where status = 'active';
      if v_pool is distinct from 1 then
        raise exception 'pool should stay 1 after app success cap, got %', v_pool;
      end if;

      if (
        select success_count from private.share_app_daily_usage where usage_day = v_day
      ) is distinct from 200 then
        raise exception 'app success_count must remain 200 after cap skip';
      end if;
    end;
    $cap_app$;
  $$,
  'publish with app success_count=200 skips daily_success_cap and does not insert pool'
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
      v_reaped integer;
      v_enq jsonb;
    begin
      -- b2/b3 は success-cap で終端済み。b4 を running にして reaper を検証
      insert into private.share_generalization_jobs (
        source_menu_id,
        contributor_user_id,
        status,
        claimed_at,
        heartbeat_at,
        created_at
      ) values (
        'b1000000-0000-4000-8000-0000000000b4',
        'a1000000-0000-4000-8000-0000000000a1',
        'running',
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '20 minutes'
      )
      returning id into v_job;

      v_reaped := public.reap_stale_share_jobs(clock_timestamp(), 100);
      if v_reaped < 1 then
        raise exception 'reaper reaped 0 jobs';
      end if;

      if not exists (
        select 1 from private.share_generalization_jobs
        where id = v_job
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
      v_enq := public.try_enqueue_share_job('b1000000-0000-4000-8000-0000000000b4'::uuid);
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
-- Task 7a: claim single-winner / concurrent caps
-- ---------------------------------------------------------------------------

-- double claim: 同一 pending は 1 勝者のみ（2 回目は既に running のため再 claim しない）
select lives_ok(
  $$
    do $double$
    declare
      v_job uuid;
      v_first jsonb;
      v_second jsonb;
      v_id text;
      v_running integer;
    begin
      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status, created_at
      ) values (
        null,
        'a1000000-0000-4000-8000-0000000000a2',
        'pending',
        clock_timestamp()
      )
      returning id into v_job;

      v_first := public.claim_share_generalization_jobs(10);
      if jsonb_array_length(v_first -> 'jobs') is distinct from 1 then
        raise exception 'first claim should win exactly 1, got %', v_first;
      end if;
      v_id := v_first -> 'jobs' -> 0 ->> 'id';
      if v_id is distinct from v_job::text then
        raise exception 'first claim id mismatch: % vs %', v_id, v_job;
      end if;
      if v_first -> 'jobs' -> 0 ->> 'status' is distinct from 'running' then
        raise exception 'claimed status must be running';
      end if;

      v_second := public.claim_share_generalization_jobs(10);
      if exists (
        select 1
        from jsonb_array_elements(v_second -> 'jobs') j
        where j ->> 'id' = v_job::text
      ) then
        raise exception 'second claim must not re-claim same job: %', v_second;
      end if;

      select count(*)::integer into v_running
      from private.share_generalization_jobs
      where id = v_job and status = 'running';
      if v_running is distinct from 1 then
        raise exception 'job must remain single running row, count=%', v_running;
      end if;

      -- 後続 cap テストのため終端化
      update private.share_generalization_jobs
      set status = 'failed',
          failure_code = 'openrouter_failed',
          finished_at = clock_timestamp()
      where id = v_job;
    end;
    $double$;
  $$,
  'double claim yields single winner for one pending job'
);

-- maxGlobalRunning=4: 既に 4 running なら pending があっても claim 0
select lives_ok(
  $$
    do $gcap$
    declare
      v_claim jsonb;
      v_pending uuid;
      i integer;
    begin
      for i in 1..4 loop
        insert into private.share_generalization_jobs (
          source_menu_id, contributor_user_id, status,
          claimed_at, heartbeat_at, created_at
        ) values (
          null,
          null,
          'running',
          clock_timestamp(),
          clock_timestamp(),
          clock_timestamp() - (i || ' minutes')::interval
        );
      end loop;

      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status, created_at
      ) values (
        null,
        'a1000000-0000-4000-8000-0000000000a2',
        'pending',
        clock_timestamp()
      )
      returning id into v_pending;

      v_claim := public.claim_share_generalization_jobs(10);
      if jsonb_array_length(v_claim -> 'jobs') is distinct from 0 then
        raise exception 'global cap 4 should block claim, got %', v_claim;
      end if;

      if not exists (
        select 1 from private.share_generalization_jobs
        where id = v_pending and status = 'pending'
      ) then
        raise exception 'pending must stay pending under global cap';
      end if;

      -- cleanup running fillers + pending
      delete from private.share_generalization_jobs
      where status = 'running' and contributor_user_id is null;
      delete from private.share_generalization_jobs where id = v_pending;
    end;
    $gcap$;
  $$,
  'claim enforces maxGlobalRunning=4'
);

-- maxPerUserRunning=1: 同一 contributor の 2 本目 pending は claim しない
select lives_ok(
  $$
    do $ucap$
    declare
      v_running uuid;
      v_pending uuid;
      v_other uuid;
      v_claim jsonb;
      v_ids text[];
    begin
      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status,
        claimed_at, heartbeat_at, created_at
      ) values (
        null,
        'a1000000-0000-4000-8000-0000000000a2',
        'running',
        clock_timestamp(),
        clock_timestamp(),
        clock_timestamp() - interval '1 minute'
      )
      returning id into v_running;

      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status, created_at
      ) values (
        null,
        'a1000000-0000-4000-8000-0000000000a2',
        'pending',
        clock_timestamp()
      )
      returning id into v_pending;

      -- 別ユーザー pending は claim 可（per-user は a2 のみ塞ぐ）
      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status, created_at
      ) values (
        null,
        null,
        'pending',
        clock_timestamp()
      )
      returning id into v_other;

      v_claim := public.claim_share_generalization_jobs(10);
      select array_agg(j ->> 'id' order by j ->> 'id')
      into v_ids
      from jsonb_array_elements(v_claim -> 'jobs') j;

      if v_other::text <> all (coalesce(v_ids, array[]::text[])) then
        raise exception 'null-contributor pending should be claimable, got %', v_claim;
      end if;
      if v_pending::text = any (coalesce(v_ids, array[]::text[])) then
        raise exception 'same-user pending must not claim under maxPerUserRunning=1: %', v_claim;
      end if;
      if not exists (
        select 1 from private.share_generalization_jobs
        where id = v_pending and status = 'pending'
      ) then
        raise exception 'same-user pending must remain pending';
      end if;

      delete from private.share_generalization_jobs
      where id in (v_running, v_pending, v_other);
    end;
    $ucap$;
  $$,
  'claim enforces maxPerUserRunning=1'
);

-- maintenance JSON: staleShareJobsReaped が独立キーで reaper 件数を返す
select lives_ok(
  $$
    do $maint$
    declare
      v_job uuid;
      v_counts jsonb;
      v_reaped integer;
      v_stale integer;
    begin
      insert into private.share_generalization_jobs (
        source_menu_id, contributor_user_id, status,
        claimed_at, heartbeat_at, created_at
      ) values (
        null,
        'a1000000-0000-4000-8000-0000000000a2',
        'running',
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '20 minutes',
        clock_timestamp() - interval '20 minutes'
      )
      returning id into v_job;

      -- pgTAP は superuser から直接呼ぶ（executor grant は inventory 側で固定）
      v_counts := public.run_kondate_maintenance(clock_timestamp(), 100);

      if not (v_counts ? 'staleShareJobsReaped') then
        raise exception 'missing staleShareJobsReaped key: %', v_counts;
      end if;
      v_reaped := (v_counts ->> 'staleShareJobsReaped')::integer;
      if v_reaped < 1 then
        raise exception 'expected reaped >= 1, got % in %', v_reaped, v_counts;
      end if;

      -- reaper 件数は staleReservationsFinalized に混ぜない（独立キー）
      v_stale := (v_counts ->> 'staleReservationsFinalized')::integer;
      -- ここでは「キーが独立」であることだけ固定（stale が reaped を含む保証はしない）

      if not exists (
        select 1 from private.share_generalization_jobs
        where id = v_job
          and status = 'failed'
          and failure_code = 'lease_expired'
      ) then
        raise exception 'maintenance reaper did not mark lease_expired';
      end if;

      if (
        select count(*)::integer
        from jsonb_object_keys(v_counts)
      ) is distinct from 9 then
        raise exception 'expected 9 maintenance keys, got %', v_counts;
      end if;
    end;
    $maint$;
  $$,
  'run_kondate_maintenance exposes staleShareJobsReaped as dedicated count key'
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
