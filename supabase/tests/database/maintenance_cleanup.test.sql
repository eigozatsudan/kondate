-- Plan 6 Task 8: 時間メンテナンス RPC / バッチ / 実行ロール / 30 日境界
\ir 000_helpers.sql
begin;
select plan(26);

-- ---------------------------------------------------------------------------
-- シグネチャ: バッチ 4 つ + run_kondate_maintenance、レガシ互換の存在
-- ---------------------------------------------------------------------------
select has_function(
  'public',
  'cleanup_stale_ai_generations_batch',
  array['timestamp with time zone', 'integer']
);
select has_function(
  'public',
  'cleanup_ai_generation_requests_batch',
  array['timestamp with time zone', 'integer']
);
select has_function(
  'private',
  'cleanup_shopping_mutations',
  array['timestamp with time zone', 'integer']
);
select has_function(
  'public',
  'cleanup_auth_continuations_batch',
  array['timestamp with time zone', 'integer']
);
select has_function(
  'public',
  'run_kondate_maintenance',
  array['timestamp with time zone', 'integer']
);

-- レガシ互換（曖昧オーバーロードなし）
select has_function(
  'public',
  'cleanup_stale_ai_generations',
  array['timestamp with time zone']
);
select has_function(
  'public',
  'cleanup_ai_generation_requests',
  array['timestamp with time zone', 'uuid']
);
select has_function(
  'public',
  'cleanup_auth_continuations',
  array['timestamp with time zone']
);
select has_function(
  'private',
  'cleanup_expired_shopping_mutations',
  array['uuid', 'integer']
);

-- (timestamptz,integer) オーバーロードが cleanup_ai_generation_requests に無いこと
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cleanup_ai_generation_requests'
      and pg_get_function_identity_arguments(p.oid)
        = 'p_before timestamp with time zone, p_limit integer'
  ),
  0,
  'cleanup_ai_generation_requests has no (timestamptz,integer) overload'
);

-- ---------------------------------------------------------------------------
-- 実行ロール属性と最小権限
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from pg_roles
    where rolname = 'kondate_maintenance_executor'
      and not rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
  ),
  'kondate_maintenance_executor is NOLOGIN NOINHERIT least-privilege'
);

select ok(
  has_schema_privilege('kondate_maintenance_executor', 'public', 'USAGE'),
  'executor has USAGE on public'
);

select ok(
  has_function_privilege(
    'kondate_maintenance_executor',
    'public.run_kondate_maintenance(timestamptz,integer)',
    'EXECUTE'
  ),
  'executor can EXECUTE run_kondate_maintenance only among targets'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.run_kondate_maintenance(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.run_kondate_maintenance(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.run_kondate_maintenance(timestamptz,integer)',
    'EXECUTE'
  ),
  'anon/authenticated/service_role cannot EXECUTE run_kondate_maintenance'
);

select ok(
  not has_schema_privilege('kondate_maintenance_executor', 'private', 'USAGE')
  and not has_function_privilege(
    'kondate_maintenance_executor',
    'public.cleanup_stale_ai_generations_batch(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'kondate_maintenance_executor',
    'public.cleanup_ai_generation_requests_batch(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'kondate_maintenance_executor',
    'private.cleanup_shopping_mutations(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'kondate_maintenance_executor',
    'public.cleanup_auth_continuations_batch(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'kondate_maintenance_executor',
    'private.cleanup_expired_shopping_mutations(uuid,integer)',
    'EXECUTE'
  ),
  'executor has no private schema or helper EXECUTE'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.cleanup_stale_ai_generations(timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.cleanup_ai_generation_requests(timestamptz,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.cleanup_auth_continuations(timestamptz)',
    'EXECUTE'
  ),
  'legacy service_role cleanup grants remain'
);

-- ---------------------------------------------------------------------------
-- 機能: 30 日境界・4 カテゴリ・snapshot cascade・再入・バッチ分割
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_user uuid := 'f1000000-0000-4000-8000-000000000001';
  v_now timestamptz := '2026-07-24 12:00:00+00';
  v_exact timestamptz := v_now - interval '30 days';
  v_older timestamptz := v_now - interval '30 days' - interval '1 second';
  v_newer timestamptz := v_now - interval '29 days';
  v_old_req uuid := 'f2000000-0000-4000-8000-000000000001';
  v_exact_req uuid := 'f2000000-0000-4000-8000-000000000002';
  v_new_req uuid := 'f2000000-0000-4000-8000-000000000003';
  v_menu_req uuid := 'f2000000-0000-4000-8000-000000000004';
  v_menu uuid := 'f3000000-0000-4000-8000-000000000001';
  v_i integer;
begin
  -- 他スイート残骸が 4 カウントを汚染しないよう、検証対象テーブルを空にする
  delete from private.auth_continuations;
  delete from private.shopping_mutations;
  delete from private.generation_regeneration_snapshots;
  delete from private.ai_generation_requests;
  delete from private.ai_user_daily_usage;
  delete from private.ai_user_daily_external_attempts;
  delete from private.ai_global_daily_usage;

  insert into auth.users (id, instance_id, aud, role, email)
  values (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'maintenance-cleanup@example.test'
  )
  on conflict (id) do nothing;

  -- 終端台帳: ちょうど 30 日 / より古い / 29 日 / menu 参照
  insert into private.ai_generation_requests (
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    failure_code, started_at, completed_at
  ) values
    (v_old_req, v_user, 'f2100000-0000-4000-8000-000000000001', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('1', 64), date '2026-06-01',
     'generation_timeout', v_older, v_older),
    (v_exact_req, v_user, 'f2100000-0000-4000-8000-000000000002', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('2', 64), date '2026-06-24',
     'generation_timeout', v_exact, v_exact),
    (v_new_req, v_user, 'f2100000-0000-4000-8000-000000000003', 'regenerate_menu', 'failed',
     'generation-command.v2', repeat('3', 64), date '2026-06-25',
     'generation_timeout', v_newer, v_newer);

  insert into public.menus (
    id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
    preference_snapshot, safety_snapshot, safety_fingerprint, target_mode,
    allergen_dictionary_version, food_safety_rule_version, output_schema_version,
    derivation_group_id
  ) values (
    v_menu, v_user, 'dinner', 'japanese', 2, 15,
    '{}'::jsonb, '{}'::jsonb, repeat('a', 64), 'household',
    'dict', 'rule', 'schema', v_menu
  );

  insert into private.ai_generation_requests (
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    completed_menu_id, started_at, completed_at
  ) values (
    v_menu_req, v_user, 'f2100000-0000-4000-8000-000000000004', 'regenerate_menu', 'succeeded',
    'generation-command.v2', repeat('4', 64), date '2026-06-01',
    v_menu, v_older, v_older
  );

  -- snapshot: 古い終端台帳に付き cascade、境界台帳に付き残る
  insert into private.generation_regeneration_snapshots (
    request_id, user_id, kind, source_menu_id, source_menu_version,
    replace_dish_id, target_mode, servings, target_member_ids
  ) values
    (v_old_req, v_user, 'regenerate_menu',
     'f3000000-0000-4000-8000-000000000099', 1, null, 'idea', 2, '{}'::uuid[]),
    (v_exact_req, v_user, 'regenerate_menu',
     'f3000000-0000-4000-8000-000000000098', 1, null, 'idea', 2, '{}'::uuid[]);

  -- shopping mutations: exact / older / newer
  insert into private.shopping_mutations (
    user_id, idempotency_key, request_hash, response, created_at
  ) values
    (v_user, 'f4000000-0000-4000-8000-000000000001', repeat('a', 64),
     '{"ok":true}'::jsonb, v_older),
    (v_user, 'f4000000-0000-4000-8000-000000000002', repeat('b', 64),
     '{"ok":true}'::jsonb, v_exact),
    (v_user, 'f4000000-0000-4000-8000-000000000003', repeat('c', 64),
     '{"ok":true}'::jsonb, v_newer);

  -- バッチ分割用に古い mutation を追加（limit=2 で残りを次呼び出しへ）
  for v_i in 1..3 loop
    insert into private.shopping_mutations (
      user_id, idempotency_key, request_hash, response, created_at
    ) values (
      v_user,
      ('f4000000-0000-4000-8000-0000000010' || lpad(v_i::text, 2, '0'))::uuid,
      rpad(v_i::text, 64, v_i::text),
      '{"ok":true}'::jsonb,
      v_older - (v_i || ' seconds')::interval
    );
  end loop;

  -- continuations: expired / claimed-expired / live
  insert into private.auth_continuations (
    id, state_hash, secret_hash, origin, return_to, expires_at, claimed_at
  ) values
    ('f5000000-0000-4000-8000-000000000001',
     decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'),
     'http://127.0.0.1:5173', '/home', v_now - interval '1 second', null),
    ('f5000000-0000-4000-8000-000000000002',
     decode(repeat('33', 32), 'hex'), decode(repeat('44', 32), 'hex'),
     'http://127.0.0.1:5173', '/home', v_now - interval '1 second',
     v_now - interval '2 seconds'),
    ('f5000000-0000-4000-8000-000000000003',
     decode(repeat('55', 32), 'hex'), decode(repeat('66', 32), 'hex'),
     'http://127.0.0.1:5173', '/home', v_now + interval '5 minutes', null);

end;
$seed$;

-- one-processing-per-user 制約のため stale 用は user を分ける
do $stale_users$
declare
  v_user_a uuid := 'f1000000-0000-4000-8000-0000000000a1';
  v_user_b uuid := 'f1000000-0000-4000-8000-0000000000a2';
  v_user_c uuid := 'f1000000-0000-4000-8000-0000000000a3';
  v_now timestamptz := '2026-07-24 12:00:00+00';
begin
  insert into auth.users (id, instance_id, aud, role, email) values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'maint-stale-a@example.test'),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'maint-stale-b@example.test'),
    (v_user_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'maint-stale-c@example.test');

  insert into private.ai_user_daily_usage (user_id, usage_day, reserved_count, success_count) values
    (v_user_a, date '2026-07-24', 1, 0),
    (v_user_b, date '2026-07-24', 1, 0),
    (v_user_c, date '2026-07-24', 1, 0);
  insert into private.ai_user_daily_external_attempts (
    user_id, usage_day, reserved_count, sent_count
  ) values
    (v_user_a, date '2026-07-24', 1, 0),
    (v_user_b, date '2026-07-24', 0, 1);
  -- reserved は未送信 + live のみ。送信済みは mark 時に reserved→sent 済み
  insert into private.ai_global_daily_usage (usage_day, reserved_count, sent_count)
  values (date '2026-07-24', 2, 1)
  on conflict (usage_day) do update
    set reserved_count = excluded.reserved_count,
        sent_count = excluded.sent_count,
        updated_at = now();

  insert into private.ai_generation_requests (
    id, user_id, idempotency_key, request_kind, status,
    request_hmac_version, request_hmac, user_usage_day,
    user_quota_reserved, user_attempt_reserved, user_attempt_day,
    global_reserved_day, global_sent_calls,
    started_at, processing_expires_at
  ) values
    -- 未送信: success / attempt / global 予約を解放する
    ('f2000000-0000-4000-8000-000000000005', v_user_a,
     'f2100000-0000-4000-8000-000000000005', 'regenerate_menu', 'processing',
     'generation-command.v2', repeat('5', 64), date '2026-07-24',
     true, true, date '2026-07-24', date '2026-07-24', 0,
     v_now - interval '10 minutes', v_now - interval '1 second'),
    -- 送信済み: global_reserved_day は null。attempt も解放済み。success のみ解放
    ('f2000000-0000-4000-8000-000000000006', v_user_b,
     'f2100000-0000-4000-8000-000000000006', 'regenerate_menu', 'processing',
     'generation-command.v2', repeat('6', 64), date '2026-07-24',
     true, false, null, null, 1,
     v_now - interval '10 minutes', v_now - interval '1 second'),
    -- 期限内 live: 触らない
    ('f2000000-0000-4000-8000-000000000007', v_user_c,
     'f2100000-0000-4000-8000-000000000007', 'regenerate_menu', 'processing',
     'generation-command.v2', repeat('7', 64), date '2026-07-24',
     true, false, null, date '2026-07-24', 0,
     v_now - interval '1 minute', v_now + interval '5 minutes');
end;
$stale_users$;

select is(
  public.run_kondate_maintenance('2026-07-24 12:00:00+00'::timestamptz, 250),
  jsonb_build_object(
    'staleReservationsFinalized', 2,
    'generationLedgersDeleted', 1,
    'shoppingMutationsDeleted', 4,
    'authContinuationsDeleted', 2
  ),
  'first maintenance run finalizes stale, deletes older ledgers/mutations/continuations'
);

select ok(
  not exists (
    select 1 from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000002'
  )
  and exists (
    select 1 from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000003'
  )
  and exists (
    select 1 from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000004'
  ),
  'exact 30-day and newer and menu-linked terminal ledgers retained'
);

select ok(
  not exists (
    select 1 from private.generation_regeneration_snapshots
    where request_id = 'f2000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from private.generation_regeneration_snapshots
    where request_id = 'f2000000-0000-4000-8000-000000000002'
  ),
  'snapshot cascades with deleted terminal request and survives boundary request'
);

select ok(
  not exists (
    select 1 from private.shopping_mutations
    where idempotency_key = 'f4000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from private.shopping_mutations
    where idempotency_key = 'f4000000-0000-4000-8000-000000000002'
  )
  and exists (
    select 1 from private.shopping_mutations
    where idempotency_key = 'f4000000-0000-4000-8000-000000000003'
  ),
  'exact 30-day shopping mutation retained; older deleted'
);

select ok(
  not exists (
    select 1 from private.auth_continuations
    where id in (
      'f5000000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000002'
    )
  )
  and exists (
    select 1 from private.auth_continuations
    where id = 'f5000000-0000-4000-8000-000000000003'
  ),
  'expired and claimed-expired continuations deleted; live retained'
);

select ok(
  (select status from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000005') = 'failed'
  and (select status from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000006') = 'failed'
  and (select status from private.ai_generation_requests
    where id = 'f2000000-0000-4000-8000-000000000007') = 'processing'
  and (select reserved_count from private.ai_user_daily_usage
    where user_id = 'f1000000-0000-4000-8000-0000000000a1'
      and usage_day = date '2026-07-24') = 0
  and (select reserved_count from private.ai_user_daily_external_attempts
    where user_id = 'f1000000-0000-4000-8000-0000000000a1'
      and usage_day = date '2026-07-24') = 0
  and (select reserved_count from private.ai_global_daily_usage
    where usage_day = date '2026-07-24') = 1
  and (select sent_count from private.ai_global_daily_usage
    where usage_day = date '2026-07-24') = 1,
  'stale unsent releases success/attempt/global; sent slot kept; live processing remains'
);

select is(
  public.run_kondate_maintenance('2026-07-24 12:00:00+00'::timestamptz, 250),
  jsonb_build_object(
    'staleReservationsFinalized', 0,
    'generationLedgersDeleted', 0,
    'shoppingMutationsDeleted', 0,
    'authContinuationsDeleted', 0
  ),
  'second maintenance run is idempotent zero counts'
);

-- バッチ limit=2 が決定的に残りを残す
do $batch$
declare
  v_user uuid := 'f1000000-0000-4000-8000-0000000000b1';
  v_now timestamptz := '2026-07-24 12:00:00+00';
  v_older timestamptz := v_now - interval '30 days' - interval '1 second';
  v_first jsonb;
  v_second jsonb;
  v_i integer;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'maint-batch@example.test'
  );
  for v_i in 1..5 loop
    insert into private.ai_generation_requests (
      id, user_id, idempotency_key, request_kind, status,
      request_hmac_version, request_hmac, user_usage_day,
      failure_code, started_at, completed_at
    ) values (
      ('f2200000-0000-4000-8000-00000000000' || v_i::text)::uuid,
      v_user,
      ('f2300000-0000-4000-8000-00000000000' || v_i::text)::uuid,
      'regenerate_menu', 'failed', 'generation-command.v2',
      repeat(v_i::text, 64), date '2026-06-01',
      'generation_timeout',
      v_older - (v_i || ' seconds')::interval,
      v_older - (v_i || ' seconds')::interval
    );
  end loop;

  v_first := public.run_kondate_maintenance(v_now, 2);
  if (v_first->>'generationLedgersDeleted')::integer <> 2 then
    raise exception 'batch1 expected 2 ledgers, got %', v_first;
  end if;
  v_second := public.run_kondate_maintenance(v_now, 2);
  if (v_second->>'generationLedgersDeleted')::integer <> 2 then
    raise exception 'batch2 expected 2 ledgers, got %', v_second;
  end if;
  if (
    select count(*) from private.ai_generation_requests
    where user_id = v_user and status = 'failed'
  ) <> 1 then
    raise exception 'expected one leftover terminal ledger';
  end if;
end;
$batch$;
select pass('batch limit leaves deterministic work for next call');

-- per-user / account-wide とも exact 30 日境界を残す
do $shop_boundary$
declare
  v_user uuid := 'f1000000-0000-4000-8000-0000000000c1';
  v_before timestamptz := clock_timestamp() - interval '30 days';
  v_exact timestamptz := v_before;
  v_older timestamptz := v_before - interval '1 second';
  v_deleted bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'maint-shop@example.test'
  )
  on conflict (id) do nothing;
  insert into private.shopping_mutations (
    user_id, idempotency_key, request_hash, response, created_at
  ) values
    (v_user, 'f4500000-0000-4000-8000-000000000001', repeat('d', 64),
     '{"ok":true}'::jsonb, v_older),
    (v_user, 'f4500000-0000-4000-8000-000000000002', repeat('e', 64),
     '{"ok":true}'::jsonb, v_exact);

  -- per-user は now()-30d。account-wide は p_before で同じ境界を固定。
  v_deleted := private.cleanup_expired_shopping_mutations(v_user, 100);
  if v_deleted < 1 then
    raise exception 'per-user cleaner deleted nothing';
  end if;
  if exists (
    select 1 from private.shopping_mutations
    where idempotency_key = 'f4500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'older shopping mutation not deleted by per-user cleaner';
  end if;
  if not exists (
    select 1 from private.shopping_mutations
    where idempotency_key = 'f4500000-0000-4000-8000-000000000002'
  ) then
    raise exception 'exact boundary shopping mutation deleted by per-user cleaner';
  end if;

  if private.cleanup_shopping_mutations(v_exact, 250) <> 0 then
    raise exception 'account-wide cleaner deleted exact-boundary row';
  end if;
end;
$shop_boundary$;
select pass('per-user and account-wide shopping cleaners retain exact 30-day boundary');

-- 返却キーは厳密に 4 つ
select is(
  (
    select array_agg(key order by key)
    from jsonb_object_keys(
      public.run_kondate_maintenance('2026-07-24 12:00:00+00'::timestamptz, 1)
    ) as key
  ),
  array[
    'authContinuationsDeleted',
    'generationLedgersDeleted',
    'shoppingMutationsDeleted',
    'staleReservationsFinalized'
  ]::text[],
  'run_kondate_maintenance returns exactly four camelCase count keys'
);

select * from finish();
rollback;
